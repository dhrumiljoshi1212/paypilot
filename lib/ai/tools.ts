import "server-only";

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentAction, Invoice } from "@/lib/types";
import { AppError } from "@/lib/utils/errors";
import {
  calculateCashflowSummary,
  calculatePriorityScores,
  isEligibleForReminder,
  isOpenInvoice,
} from "@/lib/services/collection-service";
import { createDraftAction } from "@/lib/services/action-service";
import { getInvoiceById } from "@/lib/services/invoice-service";
import {
  daysUntil,
  parseDateOnly,
  todayUtc,
  toDateOnly,
} from "@/lib/utils/dates";
import { formatMoney, formatTotals } from "@/lib/utils/currency";

export type ToolContext = {
  invoices: Invoice[];
  pendingActions: AgentAction[];
};

export type ToolExecution = {
  summary: string;
  data: unknown;
  isError?: boolean;
};

type ToolInputSchema = Anthropic.Messages.Tool["input_schema"];

export const AGENT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_invoice_summary",
    description:
      "Read-only. List invoices from the current data source with optional filters. Use this for questions such as 'what is overdue', 'who owes me more than $500', or 'show invoices due this week'. Defaults to open (unpaid) invoices when no status is provided. Amounts are returned per invoice and grouped by currency; never add unlike currencies.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["OPEN", "OVERDUE", "PAID", "DRAFT", "CANCELLED", "ALL"],
          description:
            "OPEN = sent/unpaid. OVERDUE = open and past due. ALL = every invoice.",
        },
        min_amount: {
          type: "number",
          description: "Only invoices at or above this amount.",
        },
        overdue_days_min: {
          type: "integer",
          description: "Only invoices overdue by at least this many days.",
        },
        due_within_days: {
          type: "integer",
          description:
            "Only invoices due within this many days from today (open invoices, inclusive).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_invoice_details",
    description:
      "Read-only. Fetch one invoice by PayPal invoice ID (for example INV2-XXXX or DEMO-INV-1001). Returns factual fields only. Use after a summary when the owner asks about a specific invoice.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice ID." },
      },
      required: ["invoice_id"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_overdue_invoices",
    description:
      "Read-only. Rank overdue invoices using PayPilot's transparent heuristic (amount, days overdue, urgency, data confidence). Returns scores, component breakdowns, human-readable explanations, and totals by currency. Use this when the owner asks what to prioritize or who owes them the most.",
    input_schema: {
      type: "object",
      properties: {
        min_amount: {
          type: "number",
          description: "Only consider invoices at or above this amount.",
        },
        overdue_days_min: {
          type: "integer",
          description: "Only consider invoices overdue by at least this many days.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "calculate_cashflow_summary",
    description:
      "Read-only. Calculate outstanding, overdue, paid-this-month, and due-in-horizon totals grouped by currency. Due dates are not payment guarantees; do not present the horizon amount as a prediction.",
    input_schema: {
      type: "object",
      properties: {
        horizon_days: {
          type: "integer",
          description: "Forward-looking window in days (1-90). Default 7.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "draft_payment_reminder",
    description:
      "Write a draft only. Creates a PENDING_APPROVAL reminder for one eligible invoice and returns its action ID. Nothing is sent to the customer. The owner must review, edit, and approve it in the PayPilot UI. Draft the subject and message yourself using only facts returned by tools; keep it under 1,200 characters and mention the invoice number, amount, and due date.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice to follow up on." },
        tone: {
          type: "string",
          enum: ["friendly", "professional", "firm"],
          description: "Tone of the reminder.",
        },
        subject: { type: "string", description: "Reminder email subject." },
        message: {
          type: "string",
          description: "Full reminder message, addressed to the customer.",
        },
        rationale: {
          type: "string",
          description:
            "One or two sentences explaining why this invoice was chosen, referencing amount and days overdue.",
        },
      },
      required: ["invoice_id", "tone", "subject", "message", "rationale"],
      additionalProperties: false,
    },
  },
];

const summarySchema = z.object({
  status: z
    .enum(["OPEN", "OVERDUE", "PAID", "DRAFT", "CANCELLED", "ALL"])
    .optional(),
  min_amount: z.number().nonnegative().optional(),
  overdue_days_min: z.number().int().nonnegative().optional(),
  due_within_days: z.number().int().min(0).max(365).optional(),
});

const detailsSchema = z.object({ invoice_id: z.string().min(1).max(200) });

const analyzeSchema = z.object({
  min_amount: z.number().nonnegative().optional(),
  overdue_days_min: z.number().int().nonnegative().optional(),
});

const cashflowSchema = z.object({
  horizon_days: z.number().int().min(1).max(90).optional(),
});

const draftSchema = z.object({
  invoice_id: z.string().min(1).max(200),
  tone: z.enum(["friendly", "professional", "firm"]),
  subject: z.string().min(3).max(200),
  message: z.string().min(10).max(4000),
  rationale: z.string().min(3).max(1000),
});

export function invoiceFacts(invoice: Invoice): Record<string, unknown> {
  return {
    invoice_id: invoice.id,
    invoice_number: invoice.number ?? null,
    customer: invoice.customerName ?? "Unknown customer",
    amount: invoice.totalAmount,
    currency: invoice.currency,
    status: invoice.status,
    paypal_status: invoice.paypalStatus,
    source: invoice.source,
    due_date: invoice.dueDate ?? null,
    days_overdue: invoice.daysOverdue,
    invoice_date: invoice.invoiceDate ?? null,
  };
}

function totalsByCurrency(invoices: Invoice[]): Array<{
  currency: string;
  total: number;
  count: number;
  formatted: string;
}> {
  const map = new Map<string, { total: number; count: number }>();
  for (const invoice of invoices) {
    const entry = map.get(invoice.currency) ?? { total: 0, count: 0 };
    entry.total += invoice.totalAmount;
    entry.count += 1;
    map.set(invoice.currency, entry);
  }
  return [...map.entries()].map(([currency, entry]) => ({
    currency,
    total: Math.round(entry.total * 100) / 100,
    count: entry.count,
    formatted: formatMoney(entry.total, currency),
  }));
}

function applyFilters(
  invoices: Invoice[],
  filters: z.infer<typeof summarySchema>,
): Invoice[] {
  let result = invoices;

  switch (filters.status ?? "OPEN") {
    case "OPEN":
      result = result.filter(isOpenInvoice);
      break;
    case "OVERDUE":
      result = result.filter((invoice) => invoice.isOverdue);
      break;
    case "PAID":
      result = result.filter((invoice) => invoice.status === "PAID");
      break;
    case "DRAFT":
      result = result.filter((invoice) => invoice.status === "DRAFT");
      break;
    case "CANCELLED":
      result = result.filter((invoice) => invoice.status === "CANCELLED");
      break;
    case "ALL":
      break;
  }

  if (filters.min_amount !== undefined) {
    result = result.filter((invoice) => invoice.totalAmount >= filters.min_amount!);
  }
  if (filters.overdue_days_min !== undefined) {
    result = result.filter(
      (invoice) =>
        invoice.isOverdue && invoice.daysOverdue >= filters.overdue_days_min!,
    );
  }
  if (filters.due_within_days !== undefined) {
    const today = todayUtc();
    const end = toDateOnly(
      new Date(today.getTime() + filters.due_within_days * 86_400_000),
    );
    result = result.filter((invoice) => {
      const due = parseDateOnly(invoice.dueDate);
      if (!due || !isOpenInvoice(invoice)) return false;
      const key = toDateOnly(due);
      return key >= toDateOnly(today) && key <= end;
    });
  }

  return result.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return b.daysOverdue - a.daysOverdue || b.totalAmount - a.totalAmount;
  });
}

function fail(message: string): ToolExecution {
  return { summary: message, data: { ok: false, error: message }, isError: true };
}

export async function executeAgentTool(
  name: string,
  rawInput: unknown,
  context: ToolContext,
): Promise<ToolExecution> {
  try {
    switch (name) {
      case "get_invoice_summary": {
        const filters = summarySchema.parse(rawInput ?? {});
        const matched = applyFilters(context.invoices, filters);
        const totals = totalsByCurrency(matched);

        return {
          summary: `Retrieved ${matched.length} matching invoice${matched.length === 1 ? "" : "s"} (${totals.map((entry) => entry.formatted).join(", ") || "no amount"}).`,
          data: {
            ok: true,
            filters: filters,
            matched_count: matched.length,
            totals_by_currency: totals,
            invoices: matched.slice(0, 50).map(invoiceFacts),
            truncated: matched.length > 50,
            data_source: context.invoices[0]?.source ?? "UNKNOWN",
            note:
              "Amounts are never summed across currencies. days_overdue is computed from the due date.",
          },
        };
      }

      case "get_invoice_details": {
        const input = detailsSchema.parse(rawInput);
        let invoice = context.invoices.find(
          (item) => item.id === input.invoice_id,
        );
        if (!invoice) {
          try {
            invoice = await getInvoiceById(input.invoice_id);
          } catch (error) {
            if (!(error instanceof AppError && error.code === "NOT_FOUND")) {
              throw error;
            }
            invoice = context.invoices.find(
              (item) =>
                item.number?.toLowerCase() === input.invoice_id.toLowerCase(),
            );
          }
        }
        if (!invoice) {
          return fail(
            `No invoice found with ID ${input.invoice_id}. Use get_invoice_summary to list valid invoice IDs.`,
          );
        }

        return {
          summary: `Retrieved invoice ${invoice.number ?? invoice.id}.`,
          data: {
            ok: true,
            invoice: {
              ...invoiceFacts(invoice),
              hosted_invoice_url: invoice.hostedInvoiceUrl ?? null,
              eligible_for_reminder: isEligibleForReminder(invoice),
            },
          },
        };
      }

      case "analyze_overdue_invoices": {
        const input = analyzeSchema.parse(rawInput ?? {});
        let overdue = context.invoices.filter((invoice) => invoice.isOverdue);
        if (input.min_amount !== undefined) {
          overdue = overdue.filter(
            (invoice) => invoice.totalAmount >= input.min_amount!,
          );
        }
        if (input.overdue_days_min !== undefined) {
          overdue = overdue.filter(
            (invoice) => invoice.daysOverdue >= input.overdue_days_min!,
          );
        }

        // Score against the full open book so an agent answer matches the
        // dashboard, then apply the requested overdue filters.
        const ranked = calculatePriorityScores(context.invoices)
          .filter((item) => item.invoice.isOverdue)
          .filter((item) =>
            input.min_amount === undefined
              ? true
              : item.invoice.totalAmount >= input.min_amount,
          )
          .filter((item) =>
            input.overdue_days_min === undefined
              ? true
              : item.invoice.daysOverdue >= input.overdue_days_min,
          )
          .slice(0, 15);
        const totals = totalsByCurrency(overdue);

        return {
          summary:
            overdue.length === 0
              ? "No overdue invoices matched those filters."
              : `Ranked ${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}; top priority is ${ranked[0]?.invoice.customerName ?? "unknown"} at ${ranked[0]?.score ?? 0}/100.`,
          data: {
            ok: true,
            overdue_count: overdue.length,
            totals_by_currency: totals,
            ranked: ranked.map((item) => ({
              ...invoiceFacts(item.invoice),
              priority_score: item.score,
              score_components: item.components,
              explanation: item.explanation,
            })),
            method:
              "Explainable heuristic: amount 0-40, days overdue 0-35, urgency 0-15, data confidence 0-10. Not machine learning.",
            data_source: context.invoices[0]?.source ?? "UNKNOWN",
          },
        };
      }

      case "calculate_cashflow_summary": {
        const input = cashflowSchema.parse(rawInput ?? {});
        const horizon = input.horizon_days ?? 7;
        const summary = calculateCashflowSummary(context.invoices, {
          horizonDays: horizon,
        });

        return {
          summary: `Outstanding ${formatTotals(summary.outstanding) ?? "0"}; overdue ${formatTotals(summary.overdue) ?? "0"}; due in ${horizon} days ${formatTotals(summary.dueInHorizon) ?? "0"}.`,
          data: {
            ok: true,
            ...summary,
            formatted: {
              outstanding: formatTotals(summary.outstanding),
              overdue: formatTotals(summary.overdue),
              paid_this_month: formatTotals(summary.paidThisMonth),
              due_next_7_days: formatTotals(summary.dueNext7Days),
              due_in_horizon: formatTotals(summary.dueInHorizon),
            },
            data_source: context.invoices[0]?.source ?? "UNKNOWN",
          },
        };
      }

      case "draft_payment_reminder": {
        const input = draftSchema.parse(rawInput);
        const invoice = context.invoices.find(
          (item) => item.id === input.invoice_id,
        );
        if (!invoice) {
          return fail(
            `No invoice found with ID ${input.invoice_id}. Use get_invoice_summary first; do not invent an invoice ID.`,
          );
        }

        const eligibility = isEligibleForReminder(invoice);
        if (!eligibility.eligible) {
          return fail(
            eligibility.reason ??
              "This invoice is not eligible for a reminder draft.",
          );
        }

        const action = createDraftAction({
          invoice,
          subject: input.subject,
          message: input.message,
          rationale: input.rationale,
          origin: "AI",
        });
        context.pendingActions.push(action);

        return {
          summary: `Created PENDING_APPROVAL draft ${action.id} for ${invoice.customerName ?? invoice.id}. Nothing has been sent.`,
          data: {
            ok: true,
            action_id: action.id,
            status: action.status,
            invoice_id: action.invoiceId,
            mode: action.mode,
            delivery_note:
              action.mode === "DEMO"
                ? "Demo invoice: approval can record a labelled demo action, but no PayPal request is possible unless the app is switched to Sandbox mode."
                : "Approval is required in the PayPilot UI before any PayPal reminder request is made.",
            next_step:
              "Ask the owner to review and approve the pending action card. Never claim it was sent.",
          },
        };
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(
        `Invalid arguments for ${name}: ${error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
      );
    }
    if (error instanceof AppError) {
      return fail(error.message);
    }
    return fail(
      error instanceof Error
        ? error.message
        : "The tool failed unexpectedly.",
    );
  }
}

export function toolActivityLabel(name: string): string {
  switch (name) {
    case "get_invoice_summary":
      return "Checking invoices...";
    case "get_invoice_details":
      return "Reading invoice details...";
    case "analyze_overdue_invoices":
      return "Calculating overdue priorities...";
    case "calculate_cashflow_summary":
      return "Calculating cash-flow summary...";
    case "draft_payment_reminder":
      return "Drafting a reminder for approval...";
    default:
      return "Using a tool...";
  }
}

export function daysUntilDue(invoice: Invoice): number | null {
  return daysUntil(invoice.dueDate);
}

export type { ToolInputSchema };
