import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "@/lib/env";
import { getDataSource } from "@/lib/services/invoice-service";
import { getAllInvoices } from "@/lib/services/invoice-service";
import { buildSystemPrompt } from "./system-prompt";
import { getAnthropicClient, toAiError } from "./client";
import {
  AGENT_TOOLS,
  executeAgentTool,
  toolActivityLabel,
  type ToolContext,
} from "./tools";
import type { AgentResponse, ToolActivity } from "@/lib/types";
import { AppError } from "@/lib/utils/errors";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TOOL_RESULT_CHARS = 14_000;

export async function runAgent(input: {
  message: string;
  history?: ChatTurn[];
  conversationId?: string;
}): Promise<AgentResponse> {
  const config = getConfig();
  if (!config.aiConfigured) {
    throw new AppError(
      "AI_NOT_CONFIGURED",
      "The AI agent is not configured. Add ANTHROPIC_API_KEY to .env.local, then restart the app. Invoice management and manual reminder drafts still work without AI.",
    );
  }

  const invoices = await getAllInvoices();
  const dataSource = getDataSource();
  const context: ToolContext = { invoices, pendingActions: [] };
  const toolActivities: ToolActivity[] = [];

  const system = buildSystemPrompt({
    today: new Date().toISOString().slice(0, 10),
    dataSource,
    paypalConfigured: config.paypalConfigured,
    aiConfigured: true,
  });

  const history = (input.history ?? [])
    .filter((turn) => turn.content.trim().length > 0)
    .slice(-12)
    .map<Anthropic.Messages.MessageParam>((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 6000),
    }));

  // The UI greeting is an assistant message; Claude conversations must begin
  // with a user turn. Drop leading assistant turns before adding the prompt.
  while (history[0]?.role === "assistant") history.shift();

  const messages: Anthropic.Messages.MessageParam[] = [
    ...history,
    { role: "user", content: input.message },
  ];

  let finalText = "";
  const client = getAnthropicClient();

  try {
    for (let round = 0; round < config.maxAgentRounds; round += 1) {
      const response = await client.messages.create({
        model: config.anthropicModel,
        max_tokens: 4096,
        system,
        tools: AGENT_TOOLS,
        messages,
      });

      const text = response.content
        .filter(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (text) finalText = text;

      const toolUses = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === "tool_use",
      );

      if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
        break;
      }

      messages.push({
        role: "assistant",
        content: response.content as Anthropic.Messages.ContentBlockParam[],
      });

      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        toolActivities.push({
          tool: toolUse.name,
          status: "started",
          summary: toolActivityLabel(toolUse.name),
        });

        const execution = await executeAgentTool(
          toolUse.name,
          toolUse.input,
          context,
        );

        const last = toolActivities[toolActivities.length - 1];
        last.status = execution.isError ? "failed" : "completed";
        last.summary = execution.summary;

        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(execution.data).slice(
            0,
            MAX_TOOL_RESULT_CHARS,
          ),
          is_error: execution.isError,
        });
      }

      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    throw toAiError(error);
  }

  return {
    conversationId: input.conversationId ?? crypto.randomUUID(),
    message:
      finalText ||
      "I reached the tool-call limit before producing a final answer. Please narrow the request, for example by asking about one invoice or one date range.",
    toolActivities,
    pendingActions: context.pendingActions,
    aiConfigured: true,
  };
}
