import type {
  CashflowSummary,
  CurrencyTotals,
  Invoice,
  NormalizedInvoiceStatus,
  PriorityResult,
} from "@/lib/types";
import { addToTotals } from "@/lib/utils/currency";
import {
  addDays,
  daysOverdue,
  isInCurrentUtcMonth,
  isOverdue,
  parseDateOnly,
  todayUtc,
  toDateOnly,
} from "@/lib/utils/dates";

const STATUS_MAP: Record<string, NormalizedInvoiceStatus> = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  UNPAID: "SENT",
  SCHEDULED: "SENT",
  PAYMENT_PENDING: "SENT",
  PARTIALLY_PAID: "SENT",
  OVERDUE: "OVERDUE",
  PAID: "PAID",
  MARKED_AS_PAID: "PAID",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  REFUNDED: "REFUNDED_OR_OTHER",
  PARTIALLY_REFUNDED: "REFUNDED_OR_OTHER",
  MARKED_AS_REFUNDED: "REFUNDED_OR_OTHER",
  CHARGEBACK: "REFUNDED_OR_OTHER",
};

export function normalizeInvoiceStatus(raw: string): NormalizedInvoiceStatus {
  return STATUS_MAP[(raw ?? "").toUpperCase()] ?? "UNKNOWN";
}

export function isOpenInvoice(invoice: Invoice): boolean {
  return invoice.status === "SENT" || invoice.status === "OVERDUE";
}

export function isClosedInvoice(invoice: Invoice): boolean {
  return (
    invoice.status === "PAID" ||
    invoice.status === "CANCELLED" ||
    invoice.status === "REFUNDED_OR_OTHER"
  );
}

export function isEligibleForReminder(invoice: Invoice): {
  eligible: boolean;
  reason?: string;
} {
  if (invoice.status === "PAID") {
    return { eligible: false, reason: "This invoice is already paid." };
  }
  if (invoice.status === "CANCELLED") {
    return { eligible: false, reason: "This invoice is cancelled." };
  }
  if (invoice.status === "REFUNDED_OR_OTHER") {
    return {
      eligible: false,
      reason: "PayPal reports this invoice as refunded or otherwise settled.",
    };
  }
  if (invoice.status === "DRAFT") {
    return {
      eligible: false,
      reason: "Draft invoices have not been sent yet. Send the invoice first.",
    };
  }
  if (invoice.status === "UNKNOWN") {
    return {
      eligible: false,
      reason:
        "The PayPal status for this invoice is not recognized, so a reminder cannot be sent safely.",
    };
  }
  return { eligible: true };
}

/**
 * Transparent, explainable heuristic. Never presented as an ML prediction.
 * amount (0-40) + overdue (0-35) + urgency (0-15) + confidence (0-10).
 */
export function calculatePriorityScores(
  invoices: Invoice[],
  now: Date = new Date(),
): PriorityResult[] {
  const candidates = invoices.filter(
    (invoice) => isOpenInvoice(invoice) && invoice.totalAmount > 0,
  );
  if (candidates.length === 0) return [];

  const maxAmount = Math.max(...candidates.map((invoice) => invoice.totalAmount));

  return candidates
    .map((invoice) => {
      const days = daysOverdue(invoice.dueDate, now);
      const amountRatio = maxAmount > 0 ? invoice.totalAmount / maxAmount : 0;
      const amountComponent = Math.round(40 * amountRatio);

      const overdueComponent =
        days > 0 ? Math.min(35, Math.round(days * 2.5)) : 0;

      const due = parseDateOnly(invoice.dueDate);
      const daysToDue = due
        ? Math.round(
            (due.getTime() - todayUtc(now).getTime()) / 86_400_000,
          )
        : null;
      let urgencyComponent = 0;
      if (days > 0 || daysToDue === 0) urgencyComponent = 15;
      else if (daysToDue !== null && daysToDue <= 3) urgencyComponent = 10;
      else if (daysToDue !== null && daysToDue <= 7) urgencyComponent = 5;

      let confidenceComponent = 10;
      if (!invoice.dueDate) confidenceComponent -= 5;
      if (invoice.status === "UNKNOWN") confidenceComponent -= 5;
      if (!invoice.customerName || invoice.customerName === "Unknown customer") {
        confidenceComponent -= 2;
      }
      confidenceComponent = Math.max(0, confidenceComponent);

      const score = Math.min(
        100,
        amountComponent + overdueComponent + urgencyComponent + confidenceComponent,
      );

      const factors: string[] = [];
      if (amountRatio >= 0.66) factors.push("this is one of your largest open invoices");
      else if (amountRatio >= 0.33) factors.push("this is a sizeable open invoice");
      else if (maxAmount === 0) factors.push("no invoice amount available");

      if (days > 0) factors.push(`it is ${days} day${days === 1 ? "" : "s"} overdue`);
      else if (daysToDue === 0) factors.push("it is due today");
      else if (daysToDue !== null && daysToDue > 0)
        factors.push(`it is due in ${daysToDue} day${daysToDue === 1 ? "" : "s"}`);
      else if (!invoice.dueDate) factors.push("it has no due date");

      if (invoice.status === "UNKNOWN")
        factors.push("its PayPal status is not recognized");

      const explanation =
        factors.length > 0
          ? `${score >= 70 ? "High" : score >= 45 ? "Medium" : "Low"} priority because ${factors.join(" and ")}.`
          : `Priority score ${score} based on amount, timing, and data confidence.`;

      return {
        invoice,
        score,
        components: {
          amount: amountComponent,
          overdue: overdueComponent,
          urgency: urgencyComponent,
          confidence: confidenceComponent,
        },
        explanation,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.invoice.daysOverdue - a.invoice.daysOverdue ||
        b.invoice.totalAmount - a.invoice.totalAmount,
    );
}

export function calculateCashflowSummary(
  invoices: Invoice[],
  options?: { now?: Date; horizonDays?: number },
): CashflowSummary {
  const now = options?.now ?? new Date();
  const horizonDays = Math.max(1, Math.min(365, options?.horizonDays ?? 7));
  const today = todayUtc(now);
  const horizonEnd = addDays(today, horizonDays);
  const horizonEndKey = toDateOnly(horizonEnd);

  const outstanding: CurrencyTotals = {};
  const overdue: CurrencyTotals = {};
  const paidThisMonth: CurrencyTotals = {};
  const dueNext7Days: CurrencyTotals = {};
  const dueInHorizon: CurrencyTotals = {};

  let open = 0;
  let overdueCount = 0;
  let paidCount = 0;
  let dueInHorizonCount = 0;

  for (const invoice of invoices) {
    if (invoice.status === "PAID") {
      if (isInCurrentUtcMonth(invoice.invoiceDate, now)) {
        addToTotals(paidThisMonth, invoice.currency, invoice.totalAmount);
        paidCount += 1;
      }
      continue;
    }

    if (!isOpenInvoice(invoice)) continue;

    open += 1;
    addToTotals(outstanding, invoice.currency, invoice.totalAmount);

    const overdueFlag =
      invoice.isOverdue ||
      isOverdue(invoice.status, invoice.dueDate, now);

    if (overdueFlag) {
      addToTotals(overdue, invoice.currency, invoice.totalAmount);
      overdueCount += 1;
    }

    const due = parseDateOnly(invoice.dueDate);
    if (due && invoice.dueDate) {
      const dueKey = toDateOnly(due);
      if (dueKey >= toDateOnly(today) && dueKey <= horizonEndKey) {
        addToTotals(dueInHorizon, invoice.currency, invoice.totalAmount);
        dueInHorizonCount += 1;
        if (dueKey <= toDateOnly(addDays(today, 7))) {
          addToTotals(dueNext7Days, invoice.currency, invoice.totalAmount);
        }
      }
    }
  }

  return {
    outstanding,
    overdue,
    paidThisMonth,
    dueNext7Days,
    dueInHorizon,
    horizonDays,
    invoiceCounts: {
      total: invoices.length,
      open,
      overdue: overdueCount,
      paidThisMonth: paidCount,
      dueInHorizon: dueInHorizonCount,
    },
    paidThisMonthBasis:
      "Paid this month uses PayPal's invoice_date for invoices currently marked PAID; partial payments and payment timestamps are not modelled.",
    notes: [
      "Amounts are grouped by currency and are never summed across currencies.",
      "Overdue means an open invoice with a due date in the past.",
      "Invoices due in a window are scheduled amounts, not guaranteed cash.",
      "Draft invoices are excluded from outstanding totals until they are sent.",
    ],
  };
}

export function buildBriefing(invoices: Invoice[]): {
  headline: string;
  bullets: string[];
} {
  const summary = calculateCashflowSummary(invoices);
  const priorities = calculatePriorityScores(invoices).slice(0, 3);
  const overdueCount = summary.invoiceCounts.overdue;

  if (invoices.length === 0) {
    return {
      headline: "No invoices to review yet",
      bullets: [
        "Connect PayPal Sandbox or switch to demo data to populate the workspace.",
      ],
    };
  }

  if (overdueCount === 0 && summary.invoiceCounts.open === 0) {
    return {
      headline: "Nothing outstanding right now",
      bullets: [
        "There are no open invoices. Paid invoices remain available in the invoice list.",
        "New PayPal invoice events will appear in the activity timeline.",
      ],
    };
  }

  const bullets = priorities.map((priority) => priority.explanation);
  if (summary.invoiceCounts.dueInHorizon > 0) {
    bullets.push(
      `${summary.invoiceCounts.dueInHorizon} open invoice${summary.invoiceCounts.dueInHorizon === 1 ? " becomes" : "s become"} due in the next ${summary.horizonDays} days.`,
    );
  }

  return {
    headline:
      overdueCount > 0
        ? `${overdueCount} overdue invoice${overdueCount === 1 ? " needs attention" : "s need attention"}`
        : `${summary.invoiceCounts.open} open invoice${summary.invoiceCounts.open === 1 ? " is" : "s are"} being tracked`,
    bullets: bullets.slice(0, 3),
  };
}
