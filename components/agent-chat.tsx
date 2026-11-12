"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  CheckCircle2,
  CircleDashed,
  RotateCcw,
  Sparkles,
  User,
} from "lucide-react";
import type {
  AgentAction,
  AgentResponse,
  ToolActivity,
} from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { ActionStatusBadge } from "./badges";
import { formatMoney } from "@/lib/utils/currency";
import { relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Show invoices overdue by 7 days.",
  "Who owes me the most?",
  "Draft reminders for overdue invoices.",
  "Summarize my cash flow for the next 7 days.",
  "What should I do today?",
];

type ApiErr = { error?: { message?: string } };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErr;
    return body.error?.message ?? `Request failed (HTTP ${response.status}).`;
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
}

export function AgentChat({
  aiConfigured,
  initialActions,
  mode,
}: {
  aiConfigured: boolean;
  initialActions: AgentAction[];
  mode: "DEMO" | "PAYPAL";
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `Hi — I'm PayPilot. I can inspect ${mode === "DEMO" ? "the clearly-labelled demo invoices" : "your PayPal Sandbox invoices"}, explain priorities, and draft reminders. I cannot send anything without your approval.\n\nTry one of the suggestions below, or ask your own question.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<AgentAction[]>(initialActions);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);

  const review = actions.find((action) => action.id === reviewId) ?? null;

  function mergeActions(incoming: AgentAction[]) {
    setActions((current) => {
      const map = new Map(current.map((action) => [action.id, action]));
      for (const action of incoming) map.set(action.id, action);
      return [...map.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;

    const history = messages
      .filter((item) => item.content.trim().length > 0)
      .map((item) => ({ role: item.role, content: item.content }));

    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setActivities([]);
    setLoading(true);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          conversationId,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));

      const body = (await response.json()) as AgentResponse;
      setConversationId(body.conversationId);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: body.message,
        },
      ]);
      setActivities(body.toolActivities ?? []);
      mergeActions(body.pendingActions ?? []);
      if ((body.pendingActions ?? []).length > 0) {
        setReviewId(body.pendingActions[0].id);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The agent could not answer. Your message is still here; try again.",
      );
    } finally {
      setLoading(false);
      window.setTimeout(
        () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    }
  }

  function reset() {
    setMessages([
      {
        role: "assistant",
        content:
          "New conversation. Ask me about overdue invoices, priorities, cash flow, or reminder drafts.",
      },
    ]);
    setConversationId(undefined);
    setActivities([]);
    setError(null);
    setInput("");
  }

  const pending = actions.filter(
    (action) =>
      action.status === "PENDING_APPROVAL" || action.status === "APPROVED",
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card flex min-h-[620px] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">PayPilot agent</p>
              <p className="text-[11px] text-muted">
                Typed tools · {aiConfigured ? "AI connected" : "AI key missing"}
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={reset}>
            <RotateCcw className="size-3.5" />
            New chat
          </button>
        </div>

        {!aiConfigured ? (
          <div className="flex items-start gap-2 border-b border-warning/20 bg-warning-soft px-4 py-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">AI agent is not configured</p>
              <p className="mt-0.5 leading-relaxed">
                Add <span className="mono">ANTHROPIC_API_KEY</span> to{" "}
                <span className="mono">.env.local</span> and restart. Invoice
                management and manual reminder drafts still work.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={cn(
                "flex gap-2.5",
                message.role === "user" && "justify-end",
              )}
            >
              {message.role === "assistant" ? (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <Bot className="size-4" />
                </span>
              ) : null}
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                  message.role === "assistant"
                    ? "border border-line bg-canvas/70 text-ink"
                    : "bg-brand text-white",
                )}
              >
                {message.content}
              </div>
              {message.role === "user" ? (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-canvas text-muted">
                  <User className="size-4" />
                </span>
              ) : null}
            </div>
          ))}

          {loading ? (
            <div className="flex gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                <Bot className="size-4" />
              </span>
              <div className="rounded-xl border border-line bg-canvas/70 px-3.5 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="thinking-dot size-1.5 rounded-full bg-brand" />
                  <span className="thinking-dot size-1.5 rounded-full bg-brand" />
                  <span className="thinking-dot size-1.5 rounded-full bg-brand" />
                  <span className="ml-1 text-xs text-muted">
                    Checking invoice facts...
                  </span>
                </div>
                {activities.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {activities.map((activity, index) => (
                      <li
                        key={`${activity.tool}-${index}`}
                        className="flex items-center gap-1.5 text-[11px] text-muted"
                      >
                        <CircleDashed className="size-3 animate-spin" />
                        {activity.summary}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {!loading && activities.length > 0 ? (
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Tool activity
              </p>
              <ul className="mt-1 space-y-1">
                {activities.map((activity, index) => (
                  <li
                    key={`${activity.tool}-${index}`}
                    className="flex items-center gap-1.5 text-[11px] text-muted"
                  >
                    {activity.status === "failed" ? (
                      <AlertTriangle className="size-3 text-danger" />
                    ) : (
                      <CheckCircle2 className="size-3 text-success" />
                    )}
                    <span className="mono">{activity.tool}</span>
                    <span className="text-line">·</span>
                    <span>{activity.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-xs text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-brand/30 hover:bg-brand-soft hover:text-brand disabled:opacity-50"
                onClick={() => send(suggestion)}
                disabled={loading || !aiConfigured}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <textarea
              className="input max-h-32 min-h-[44px] resize-none py-2.5"
              rows={1}
              placeholder={
                aiConfigured
                  ? "Ask PayPilot about your invoices..."
                  : "Add ANTHROPIC_API_KEY to enable the agent"
              }
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              disabled={loading || !aiConfigured}
              maxLength={2000}
            />
            <button
              type="submit"
              className="btn-primary size-11 shrink-0 rounded-lg p-0"
              disabled={loading || !aiConfigured || input.trim().length === 0}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </button>
          </form>
          <p className="mt-1.5 text-[10px] text-muted">
            AI can make mistakes. Invoice facts come from tools; every customer
            action needs your approval. Never share secrets in chat.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Approval queue</p>
              <p className="text-[11px] text-muted">
                {pending.length} waiting · nothing sent
              </p>
            </div>
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              {pending.length}
            </span>
          </div>

          {pending.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted">
              Drafts created by the agent or from an invoice will appear here for
              review.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((action) => (
                <li key={action.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {action.invoice?.customerName ?? action.invoiceId}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {action.invoice
                          ? formatMoney(
                              action.invoice.totalAmount,
                              action.invoice.currency,
                            )
                          : "Invoice unavailable"}{" "}
                        · {relativeTime(action.createdAt)}
                      </p>
                    </div>
                    <ActionStatusBadge status={action.status} />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
                    {action.draftMessage}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-[11px]"
                      onClick={() => setReviewId(action.id)}
                    >
                      Review
                    </button>
                    <span className="text-[10px] text-muted">
                      {action.mode === "DEMO" ? "Demo mode" : "PayPal Sandbox"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card bg-gradient-to-br from-brand-soft to-surface px-4 py-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-brand">
            <Sparkles className="size-4" />
            What the agent can do
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted">
            <li>Read invoice status, amounts, and due dates through typed tools.</li>
            <li>Rank overdue invoices with an explainable heuristic.</li>
            <li>Draft a contextual reminder for one invoice at a time.</li>
            <li>Never execute a PayPal send or reminder by itself.</li>
          </ul>
        </div>
      </div>

      {review ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close review"
            className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
            onClick={() => setReviewId(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Review reminder draft"
            className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto p-3 sm:inset-0 sm:m-auto sm:h-fit sm:max-w-2xl sm:p-6"
          >
            <ApprovalCard
              action={review}
              onDismiss={() => setReviewId(null)}
              onChanged={(updated) => {
                mergeActions([updated]);
                router.refresh();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
