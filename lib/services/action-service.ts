import "server-only";

import { getDb, logActivity, nowIso, uuid } from "@/lib/db";
import { getConfig } from "@/lib/env";
import type {
  ActionResultMode,
  AgentAction,
  Invoice,
} from "@/lib/types";
import { formatDate } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/currency";
import { AppError, redact } from "@/lib/utils/errors";
import { sendPayPalReminder } from "@/lib/paypal/invoices";
import { isEligibleForReminder } from "./collection-service";
import {
  refreshInvoiceFromPayPal,
  rowToInvoice,
  type InvoiceRow,
} from "./invoice-service";

type ActionRow = {
  id: string;
  invoice_id: string;
  action_type: "SEND_INVOICE" | "SEND_REMINDER";
  status: AgentAction["status"];
  draft_subject: string;
  draft_message: string;
  rationale: string;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  paypal_response: string | null;
  idempotency_key: string;
  mode: ActionResultMode;
  execution_error: string | null;
  invoice_snapshot: string | null;
  origin: string;
};

function hydrate(row: ActionRow): AgentAction {
  const db = getDb();
  const invoiceRow = db
    .prepare("SELECT * FROM invoices_cache WHERE id = ?")
    .get(row.invoice_id) as InvoiceRow | undefined;

  let invoice: Invoice | undefined;
  if (invoiceRow) {
    invoice = rowToInvoice(invoiceRow);
  } else if (row.invoice_snapshot) {
    invoice = JSON.parse(row.invoice_snapshot) as Invoice;
  }

  return {
    id: row.id,
    invoiceId: row.invoice_id,
    actionType: row.action_type,
    status: row.status,
    draftSubject: row.draft_subject,
    draftMessage: row.draft_message,
    rationale: row.rationale,
    createdAt: row.created_at,
    approvedAt: row.approved_at ?? undefined,
    executedAt: row.executed_at ?? undefined,
    idempotencyKey: row.idempotency_key,
    mode: row.mode,
    invoice,
    paypalResponse: row.paypal_response
      ? (JSON.parse(row.paypal_response) as Record<string, unknown>)
      : undefined,
    executionError: row.execution_error ?? undefined,
  };
}

export function getAction(actionId: string): AgentAction {
  const row = getDb()
    .prepare("SELECT * FROM agent_actions WHERE id = ?")
    .get(actionId) as ActionRow | undefined;
  if (!row) throw new AppError("NOT_FOUND", "That action does not exist.");
  return hydrate(row);
}

export function listActions(options?: {
  status?: AgentAction["status"];
  limit?: number;
}): AgentAction[] {
  const db = getDb();
  const rows = options?.status
    ? (db
        .prepare(
          "SELECT * FROM agent_actions WHERE status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(options.status, options.limit ?? 100) as ActionRow[])
    : (db
        .prepare(
          "SELECT * FROM agent_actions ORDER BY created_at DESC LIMIT ?",
        )
        .all(options?.limit ?? 100) as ActionRow[]);

  return rows.map(hydrate);
}

export function getPendingActions(limit = 20): AgentAction[] {
  return listActions({ status: "PENDING_APPROVAL", limit });
}

export function buildManualDraft(
  invoice: Invoice,
  tone: "friendly" | "professional" | "firm" = "professional",
): { subject: string; message: string } {
  const amount = formatMoney(invoice.totalAmount, invoice.currency);
  const number = invoice.number ?? invoice.id;
  const due = invoice.dueDate ? formatDate(invoice.dueDate) : "the due date";
  const overdue =
    invoice.daysOverdue > 0
      ? ` It is now ${invoice.daysOverdue} day${invoice.daysOverdue === 1 ? "" : "s"} past due.`
      : "";
  const firstName = (invoice.customerName ?? "there").split(" ")[0];
  const link = invoice.hostedInvoiceUrl
    ? `\n\nYou can review and pay the invoice here: ${invoice.hostedInvoiceUrl}`
    : "";

  const greeting =
    tone === "friendly" ? "Hi" : tone === "firm" ? "Hello" : "Hello";
  const closing =
    tone === "firm"
      ? "Please arrange payment as soon as possible. If there is an issue with this invoice, reply so we can resolve it."
      : tone === "friendly"
        ? "If you have any questions or need a little more time, just reply and let me know."
        : "If you have already paid, please disregard this note. Otherwise, let me know if you need a copy of the invoice.";

  return {
    subject: `Payment reminder: Invoice ${number} — ${amount} due ${due}`,
    message: `${greeting} ${firstName},

This is a ${tone} reminder that invoice ${number} for ${amount} was due on ${due}.${overdue}

${closing}${link}

Thank you,
PayPilot user`,
  };
}

export function createDraftAction(input: {
  invoice: Invoice;
  subject: string;
  message: string;
  rationale: string;
  origin: "AI" | "MANUAL";
}): AgentAction {
  const eligibility = isEligibleForReminder(input.invoice);
  if (!eligibility.eligible) {
    throw new AppError(
      "PAYPAL_INELIGIBLE_INVOICE",
      eligibility.reason ?? "This invoice is not eligible for a reminder.",
    );
  }

  if (input.message.trim().length < 10) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The reminder message is too short to review.",
    );
  }

  const mode: ActionResultMode =
    input.invoice.source === "PAYPAL" ? "SANDBOX" : "DEMO";
  const id = uuid();
  const createdAt = nowIso();
  const idempotencyKey = uuid();

  getDb()
    .prepare(
      `INSERT INTO agent_actions
        (id, invoice_id, action_type, status, draft_subject, draft_message,
         rationale, created_at, idempotency_key, mode, invoice_snapshot, origin)
       VALUES (?, ?, 'SEND_REMINDER', 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.invoice.id,
      input.subject.trim(),
      input.message.trim(),
      input.rationale.trim(),
      createdAt,
      idempotencyKey,
      mode,
      JSON.stringify(input.invoice),
      input.origin,
    );

  logActivity({
    kind: input.origin === "AI" ? "RECOMMENDATION" : "DRAFT_CREATED",
    title: `${input.origin === "AI" ? "AI drafted" : "Draft created"}: reminder for ${input.invoice.customerName ?? input.invoice.id}`,
    detail: `Invoice ${input.invoice.number ?? input.invoice.id} · ${formatMoney(input.invoice.totalAmount, input.invoice.currency)} · nothing has been sent.`,
    invoiceId: input.invoice.id,
    actionId: id,
    source: input.invoice.source,
    metadata: { status: "PENDING_APPROVAL", origin: input.origin },
  });

  return getAction(id);
}

export function approveAction(
  actionId: string,
  input: { subject?: string; message?: string },
): AgentAction {
  const action = getAction(actionId);
  if (action.status !== "PENDING_APPROVAL") {
    throw new AppError(
      "CONFLICT",
      `Only pending actions can be approved. This action is ${action.status}.`,
    );
  }

  const subject = (input.subject ?? action.draftSubject).trim();
  const message = (input.message ?? action.draftMessage).trim();
  if (subject.length < 3 || subject.length > 200) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The reminder subject must be between 3 and 200 characters.",
    );
  }
  if (message.length < 10 || message.length > 4000) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The reminder message must be between 10 and 4,000 characters.",
    );
  }

  const result = getDb()
    .prepare(
      `UPDATE agent_actions
       SET status = 'APPROVED', approved_at = ?, draft_subject = ?, draft_message = ?
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
    )
    .run(nowIso(), subject, message, actionId);

  if (result.changes !== 1) {
    throw new AppError(
      "CONFLICT",
      "This action changed while you were reviewing it. Reload and try again.",
    );
  }

  logActivity({
    kind: "ACTION_APPROVED",
    title: `Approved reminder for ${action.invoice?.customerName ?? action.invoiceId}`,
    detail: "Approval recorded. The reminder has not been sent yet.",
    invoiceId: action.invoiceId,
    actionId,
    source: "APP",
    level: "INFO",
    metadata: { edited: Boolean(input.message) },
  });

  return getAction(actionId);
}

export function cancelAction(actionId: string): AgentAction {
  const action = getAction(actionId);
  if (action.status !== "PENDING_APPROVAL" && action.status !== "APPROVED") {
    throw new AppError(
      "CONFLICT",
      `This action cannot be cancelled while it is ${action.status}.`,
    );
  }

  const result = getDb()
    .prepare(
      `UPDATE agent_actions SET status = 'CANCELLED'
       WHERE id = ? AND status IN ('PENDING_APPROVAL', 'APPROVED')`,
    )
    .run(actionId);

  if (result.changes !== 1) {
    throw new AppError("CONFLICT", "This action could not be cancelled.");
  }

  logActivity({
    kind: "ACTION_CANCELLED",
    title: `Cancelled reminder for ${action.invoice?.customerName ?? action.invoiceId}`,
    invoiceId: action.invoiceId,
    actionId,
    source: "APP",
    level: "WARNING",
  });

  return getAction(actionId);
}

const executing = new Set<string>();

export async function executeAction(actionId: string): Promise<AgentAction> {
  const action = getAction(actionId);

  if (action.status === "EXECUTED") return action;
  if (action.status === "CANCELLED") {
    throw new AppError("CONFLICT", "This action was cancelled.");
  }
  if (action.status === "FAILED") {
    throw new AppError(
      "CONFLICT",
      "This action already failed. Create a new draft instead of retrying it.",
    );
  }
  if (action.status === "PENDING_APPROVAL") {
    throw new AppError(
      "CONFLICT",
      "This reminder must be approved before it can be executed.",
    );
  }
  if (action.status !== "APPROVED") {
    throw new AppError("CONFLICT", "This action cannot be executed.");
  }
  if (executing.has(actionId)) {
    throw new AppError(
      "CONFLICT",
      "This reminder is already being executed. Wait for the result.",
    );
  }

  executing.add(actionId);
  try {
    if (action.mode === "DEMO") {
      const response = {
        demo: true,
        delivered: false,
        message:
          "Demo action recorded locally. No request was sent to PayPal and no customer received an email.",
      };
      const executedAt = nowIso();
      getDb()
        .prepare(
          `UPDATE agent_actions
           SET status = 'EXECUTED', executed_at = ?, paypal_response = ?
           WHERE id = ? AND status = 'APPROVED'`,
        )
        .run(executedAt, JSON.stringify(response), actionId);

      logActivity({
        kind: "ACTION_EXECUTED",
        title: `Demo reminder recorded for ${action.invoice?.customerName ?? action.invoiceId}`,
        detail:
          "DEMO ONLY — nothing was sent to PayPal and no customer was contacted.",
        invoiceId: action.invoiceId,
        actionId,
        source: "DEMO",
        level: "SUCCESS",
        metadata: { demo: true },
      });

      return getAction(actionId);
    }

    if (!getConfig().paypalConfigured) {
      throw new AppError(
        "PAYPAL_NOT_CONFIGURED",
        "PayPal Sandbox credentials are no longer configured.",
      );
    }

    let invoice: Invoice;
    try {
      invoice = await refreshInvoiceFromPayPal(action.invoiceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not refresh invoice.";
      markFailed(actionId, message);
      throw error;
    }

    const eligibility = isEligibleForReminder(invoice);
    if (!eligibility.eligible) {
      const message =
        eligibility.reason ?? "This invoice is no longer eligible for a reminder.";
      markFailed(actionId, message);
      throw new AppError("PAYPAL_INELIGIBLE_INVOICE", message);
    }

    try {
      await sendPayPalReminder(invoice.id, {
        requestId: action.idempotencyKey,
        subject: action.draftSubject,
        note: action.draftMessage,
      });

      const response = {
        httpStatus: 204,
        delivered: true,
        note: "PayPal accepted the reminder request and sends its own system reminder email. PayPal currently ignores custom subject/note text; your draft is preserved in PayPilot for the audit trail.",
        requestId: action.idempotencyKey,
      };

      getDb()
        .prepare(
          `UPDATE agent_actions
           SET status = 'EXECUTED', executed_at = ?, paypal_response = ?
           WHERE id = ? AND status = 'APPROVED'`,
        )
        .run(nowIso(), JSON.stringify(response), actionId);

      logActivity({
        kind: "ACTION_EXECUTED",
        title: `PayPal reminder sent for invoice ${invoice.number ?? invoice.id}`,
        detail: `PayPal accepted the reminder request (HTTP 204). Recipient: ${invoice.customerName ?? "unknown"}.`,
        invoiceId: invoice.id,
        actionId,
        source: "PAYPAL",
        level: "SUCCESS",
        metadata: { requestId: action.idempotencyKey },
      });

      void refreshInvoiceFromPayPal(invoice.id).catch(() => undefined);

      return getAction(actionId);
    } catch (error) {
      const appError = error instanceof AppError ? error : undefined;
      const message = appError?.message ?? "PayPal could not send the reminder.";
      markFailed(actionId, message);
      logActivity({
        kind: "ACTION_FAILED",
        title: `PayPal reminder failed for invoice ${invoice.number ?? invoice.id}`,
        detail: redact(message),
        invoiceId: invoice.id,
        actionId,
        source: "PAYPAL",
        level: "ERROR",
        metadata: { requestId: appError?.requestId },
      });
      throw error;
    }
  } finally {
    executing.delete(actionId);
  }
}

function markFailed(actionId: string, message: string): void {
  getDb()
    .prepare(
      `UPDATE agent_actions
       SET status = 'FAILED', execution_error = ?, executed_at = ?
       WHERE id = ? AND status = 'APPROVED'`,
    )
    .run(redact(message), nowIso(), actionId);
}
