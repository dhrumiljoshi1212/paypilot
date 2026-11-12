import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "@/lib/env";
import { AppError } from "@/lib/utils/errors";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  const config = getConfig();
  if (!config.anthropicApiKey) {
    throw new AppError(
      "AI_NOT_CONFIGURED",
      "The AI agent is not configured. Add ANTHROPIC_API_KEY to .env.local. You can still manage invoices and draft reminders manually.",
    );
  }
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  return client;
}

export function toAiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Anthropic.APIError) {
    return new AppError(
      "AI_ERROR",
      error.status === 429
        ? "The AI provider is rate-limiting requests. Wait a moment and try again."
        : `The AI provider returned an error (HTTP ${error.status ?? "unknown"}).`,
      { details: error.message },
    );
  }
  return new AppError(
    "AI_ERROR",
    "The AI agent could not complete this request. Your message was not lost; try again.",
    {
      details: error instanceof Error ? error.message : String(error),
    },
  );
}
