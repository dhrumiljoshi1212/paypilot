import { describe, expect, it } from "vitest";
import type { Invoice } from "@/lib/types";
import {
  buildBriefing,
  calculateCashflowSummary,
  calculatePriorityScores,
  isEligibleForReminder,
  normalizeInvoiceStatus,
} from "@/lib/services/collection-service";
import { daysOverdue, isOverdue } from "@/lib/utils/dates";

const NOW = new Date("2026-05-15T12:00:00.000Z");

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "INV",
    number: "INV-1",
    status: "SENT",
    paypalStatus: "SENT",
    currency: "USD",
    totalAmount: 1000,
    dueDate: "2026-05-01",
    invoiceDate: "2026-04-01",
    customerName: "Test Customer",
    source: "DEMO",
    lastSyncedAt: NOW.toISOString(),
    daysOverdue: 0,
    isOverdue: false,
    ...overrides,
  };
}

describe("invoice status normalization", () => {
  it("maps documented and unknown PayPal statuses without inventing new ones", () => {
    expect(normalizeInvoiceStatus("DRAFT")).toBe("DRAFT");
    expect(normalizeInvoiceStatus("UNPAID")).toBe("SENT");
    expect(normalizeInvoiceStatus("MARKED_AS_PAID")).toBe("PAID");
    expect(normalizeInvoiceStatus("partially_refunded")).toBe("REFUNDED_OR_OTHER");
    expect(normalizeInvoiceStatus("SOMETHING_NEW")).toBe("UNKNOWN");
    expect(normalizeInvoiceStatus("")).toBe("UNKNOWN");
  });
});

describe("overdue calculation", () => {
  it("treats a due date today as not overdue", () => {
    expect(daysOverdue("2026-05-15", NOW)).toBe(0);
    expect(isOverdue("SENT", "2026-05-15", NOW)).toBe(false);
  });

  it("counts whole UTC days past the due date", () => {
    expect(daysOverdue("2026-05-14", NOW)).toBe(1);
    expect(daysOverdue("2026-05-01", NOW)).toBe(14);
    expect(isOverdue("SENT", "2026-05-01", NOW)).toBe(true);
  });

  it("never marks paid, cancelled, or missing-due invoices overdue", () => {
    expect(isOverdue("PAID", "2026-05-01", NOW)).toBe(false);
    expect(isOverdue("CANCELLED", "2026-05-01", NOW)).toBe(false);
    expect(isOverdue("SENT", undefined, NOW)).toBe(false);
    expect(daysOverdue(undefined, NOW)).toBe(0);
  });
});

describe("reminder eligibility", () => {
  it("allows sent and overdue invoices", () => {
    expect(isEligibleForReminder(invoice()).eligible).toBe(true);
    expect(
      isEligibleForReminder(
        invoice({ status: "OVERDUE", isOverdue: true, daysOverdue: 5 }),
      ).eligible,
    ).toBe(true);
  });

  it("blocks paid, draft, cancelled, refunded, and unknown statuses", () => {
    for (const status of [
      "PAID",
      "DRAFT",
      "CANCELLED",
      "REFUNDED_OR_OTHER",
      "UNKNOWN",
    ] as const) {
      const result = isEligibleForReminder(invoice({ status }));
      expect(result.eligible).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });
});

describe("collection priority heuristic", () => {
  it("ranks larger, older invoices higher and stays within 0-100", () => {
    const ranked = calculatePriorityScores(
      [
        invoice({ id: "small-new", totalAmount: 100, dueDate: "2026-05-20" }),
        invoice({
          id: "large-old",
          totalAmount: 2400,
          dueDate: "2026-04-03",
          daysOverdue: 42,
        }),
      ],
      NOW,
    );

    expect(ranked[0].invoice.id).toBe("large-old");
    for (const item of ranked) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
      expect(item.explanation).toMatch(/priority/i);
    }
  });

  it("excludes paid and cancelled invoices", () => {
    const ranked = calculatePriorityScores(
      [
        invoice({ id: "paid", status: "PAID" }),
        invoice({ id: "cancelled", status: "CANCELLED" }),
      ],
      NOW,
    );
    expect(ranked).toHaveLength(0);
  });
});

describe("currency-safe cash-flow summary", () => {
  it("never adds unlike currencies and excludes draft invoices", () => {
    const summary = calculateCashflowSummary(
      [
        invoice({ id: "usd", totalAmount: 1000, currency: "USD", dueDate: "2026-05-18" }),
        invoice({ id: "eur", totalAmount: 500, currency: "EUR", dueDate: "2026-05-19" }),
        invoice({ id: "draft", status: "DRAFT", totalAmount: 999 }),
        invoice({
          id: "paid",
          status: "PAID",
          totalAmount: 600,
          invoiceDate: "2026-05-02",
        }),
      ],
      { now: NOW, horizonDays: 7 },
    );

    expect(summary.outstanding).toEqual({ USD: 1000, EUR: 500 });
    expect(summary.invoiceCounts.total).toBe(4);
    expect(summary.invoiceCounts.open).toBe(2);
    expect(summary.paidThisMonth).toEqual({ USD: 600 });
    expect(summary.dueInHorizon).toEqual({ USD: 1000, EUR: 500 });
  });

  it("separates overdue from due-in-window", () => {
    const summary = calculateCashflowSummary(
      [
        invoice({ id: "overdue", totalAmount: 1200, dueDate: "2026-05-01" }),
        invoice({ id: "soon", totalAmount: 800, dueDate: "2026-05-18" }),
      ],
      { now: NOW, horizonDays: 7 },
    );

    expect(summary.overdue).toEqual({ USD: 1200 });
    expect(summary.dueInHorizon).toEqual({ USD: 800 });
  });
});

describe("briefing", () => {
  it("returns an honest empty state", () => {
    const briefing = buildBriefing([]);
    expect(briefing.headline).toMatch(/No invoices/i);
  });

  it("mentions overdue count and explanations", () => {
    const briefing = buildBriefing([
      invoice({ id: "1", dueDate: "2026-05-01" }),
      invoice({ id: "2", totalAmount: 300, dueDate: "2026-05-09" }),
    ]);
    expect(briefing.headline).toMatch(/2 overdue/i);
    expect(briefing.bullets.length).toBeGreaterThan(0);
  });
});
