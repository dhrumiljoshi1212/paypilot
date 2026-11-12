"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Mail,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import type { AgentAction } from "@/lib/types";
import { ActionStatusBadge, SourceBadge } from "./badges";
import { formatDate } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/currency";
import { cn } from "@/lib/utils/cn";

type ApiOk = { action: AgentAction };
type ApiErr = { error?: { message?: string } };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErr;
    return body.error?.message ?? `Request failed (HTTP ${response.status}).`;
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
}

export function ApprovalCard({
  action: initialAction,
  onChanged,
  onDismiss,
}: {
  action: AgentAction;
  onChanged?: (action: AgentAction) => void;
  onDismiss?: () => void;
}) {
  const [action, setAction] = useState(initialAction);
  const [subject, setSubject] = useState(
    initialAction.draftSubject || initialAction.draftMessage.slice(0, 80),
  );
  const [message, setMessage] = useState(initialAction.draftMessage);
  const [busy, setBusy] = useState<"approve" | "send" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const invoice = action.invoice;
  const isPending = action.status === "PENDING_APPROVAL";
  const isApproved = action.status === "APPROVED";
  const isExecuted = action.status === "EXECUTED";
  const isFailed = action.status === "FAILED";
  const isDemo = action.mode === "DEMO";
  const result = action.paypalResponse;

  function update(next: AgentAction) {
    setAction(next);
    onChanged?.(next);
  }

  async function approveOnly() {
    setBusy("approve");
    setError(null);
    try {
      const response = await fetch(`/api/actions/${action.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as ApiOk;
      update(body.action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  }

  async function executeCurrent() {
    setBusy("send");
    setError(null);
    try {
      const response = await fetch(`/api/actions/${action.id}/execute`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as ApiOk;
      update(body.action);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Execution failed.");
      try {
        const response = await fetch(`/api/actions/${action.id}`);
        if (response.ok) {
          const body = (await response.json()) as ApiOk;
          update(body.action);
        }
      } catch {
        // keep the error message above
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function approveAndExecute() {
    setError(null);
    if (isPending) {
      setBusy("approve");
      try {
        const response = await fetch(`/api/actions/${action.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, message }),
        });
        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as ApiOk;
        update(body.action);
        setBusy(null);
        if (body.action.status === "APPROVED") {
          await executeCurrent();
        }
        return;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Approval failed.");
        setBusy(null);
        return;
      }
    }
    await executeCurrent();
  }

  async function cancel() {
    if (!window.confirm("Cancel this reminder draft? Nothing has been sent.")) {
      return;
    }
    setBusy("cancel");
    setError(null);
    try {
      const response = await fetch(`/api/actions/${action.id}/cancel`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as ApiOk;
      update(body.action);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancel failed.");
    } finally {
      setBusy(null);
    }
  }

  const primaryLabel = isDemo
    ? isApproved
      ? "Record demo action"
      : "Approve & record demo action"
    : isApproved
      ? "Send reminder through PayPal"
      : "Approve & send reminder";

  return (
    <div
      className={cn(
        "card overflow-hidden",
        isPending && "border-warning/30",
        isExecuted && "border-success/30",
        isFailed && "border-danger/30",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface text-brand ring-1 ring-line">
            <Mail className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Payment reminder</p>
            <p className="text-[11px] text-muted">
              {action.actionType === "SEND_REMINDER"
                ? "Invoice follow-up"
                : "Invoice delivery"}{" "}
              · action {action.id.slice(0, 8)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ActionStatusBadge status={action.status} />
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {invoice ? (
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <Fact label="Recipient" value={invoice.customerName ?? "Unknown customer"} />
            <Fact
              label="Amount"
              value={formatMoney(invoice.totalAmount, invoice.currency)}
            />
            <Fact
              label="Invoice"
              value={`${invoice.number ?? invoice.id}`}
              mono
            />
            <Fact
              label="Due date"
              value={`${formatDate(invoice.dueDate)}${invoice.daysOverdue > 0 ? ` · ${invoice.daysOverdue}d overdue` : ""}`}
            />
            <div className="flex items-center gap-2">
              <span className="label">Source</span>
              <SourceBadge source={invoice.source} />
            </div>
            <Fact label="Mode" value={isDemo ? "Demo (no PayPal send)" : "PayPal Sandbox"} />
          </div>
        ) : null}

        <div className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-xs leading-relaxed">
          <p className="font-medium text-ink">Why PayPilot suggests this</p>
          <p className="mt-0.5 text-muted">{action.rationale}</p>
        </div>

        {isExecuted ? (
          isDemo ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-soft px-3 py-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">Demo action recorded — nothing was sent.</p>
                <p className="mt-0.5 leading-relaxed">
                  {String(
                    result?.message ??
                      "No PayPal request was made and no customer was contacted. Switch to PayPal Sandbox mode to exercise the real reminder API.",
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success-soft px-3 py-3 text-xs text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">PayPal accepted the reminder request.</p>
                <p className="mt-0.5 leading-relaxed">
                  HTTP {String(result?.httpStatus ?? "204")} · request ID{" "}
                  <span className="mono">{action.idempotencyKey.slice(0, 8)}</span>
                </p>
                <p className="mt-1 leading-relaxed">
                  PayPal sends its own system reminder email. PayPal currently
                  ignores custom subject and note text, so your personalized draft
                  is preserved here for the audit trail.
                </p>
              </div>
            </div>
          )
        ) : isFailed ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-3 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">PayPal did not accept this reminder.</p>
              <p className="mt-0.5 leading-relaxed">
                {action.executionError ?? "The request failed."}
              </p>
              <p className="mt-1 leading-relaxed">
                This action is terminal. Create a new draft after resolving the
                issue; PayPilot will not fake a successful send.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-medium text-muted">
            <ShieldCheck className="size-4 text-success" />
            {isPending
              ? "Nothing has been sent. Review or edit the message, then approve."
              : "Approved, but not sent. Click send to call PayPal now."}
          </div>
        )}

        <div>
          <label htmlFor={`subject-${action.id}`} className="label">
            Subject
          </label>
          <input
            id={`subject-${action.id}`}
            className="input mt-1.5"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={!isPending}
            maxLength={200}
          />
        </div>

        <div>
          <label htmlFor={`message-${action.id}`} className="label">
            Reminder draft
          </label>
          <textarea
            id={`message-${action.id}`}
            className="input mt-1.5 min-h-40 resize-y leading-relaxed"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={!isPending}
            maxLength={4000}
          />
          <p className="mt-1 text-[11px] text-muted">
            {message.length.toLocaleString()} / 4,000 characters
          </p>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {isPending || isApproved ? (
            <button
              type="button"
              className="btn-primary"
              onClick={approveAndExecute}
              disabled={busy !== null}
            >
              {busy === "approve" || busy === "send" ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {busy === "approve" ? "Approving..." : "Sending..."}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  {primaryLabel}
                </>
              )}
            </button>
          ) : null}

          {isPending ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={approveOnly}
              disabled={busy !== null}
            >
              <BadgeCheck className="size-4" />
              Approve only
            </button>
          ) : null}

          {isPending || isApproved ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={cancel}
              disabled={busy !== null}
            >
              Cancel
            </button>
          ) : null}

          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted">
            <Clock3 className="size-3.5" />
            {isExecuted
              ? `Executed ${action.executedAt ? new Date(action.executedAt).toLocaleString() : ""}`
              : isApproved
                ? "Approved — awaiting send"
                : "Awaiting your approval"}
          </span>
        </div>

        {isDemo && !isExecuted ? (
          <p className="text-[11px] leading-relaxed text-warning">
            Demo invoice: execution records a clearly-labelled local action. It
            cannot call PayPal. Switch to PayPal Sandbox mode for a real reminder.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="label shrink-0">{label}</span>
      <span className={cn("truncate text-ink", mono && "mono")}>{value}</span>
    </div>
  );
}
