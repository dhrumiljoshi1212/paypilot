import { describe, expect, it } from "vitest";
import { executeAgentTool } from "@/lib/ai/tools";
import type { Invoice } from "@/lib/types";

const invoice: Invoice = {
  id: "TOOL-INV-1",
  number: "INV-3001",
  status: "SENT",
  paypalStatus: "SENT",
  currency: "USD",
  totalAmount: 1200,
  dueDate: "2026-05-01",
  invoiceDate: "2026-04-01",
  customerName: "Tool Customer",
  source: "DEMO",
  lastSyncedAt: new Date().toISOString(),
  daysOverdue: 10,
  isOverdue: true,
};

describe("agent tool validation", () => {
  it("rejects negative amounts instead of executing a tool", async () => {
    const result = await executeAgentTool(
      "get_invoice_summary",
      { min_amount: -5 },
      { invoices: [invoice], pendingActions: [] },
    );
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/Invalid arguments/i);
  });

  it("rejects unknown tool names", async () => {
    const result = await executeAgentTool(
      "execute_paypal_payment",
      {},
      { invoices: [invoice], pendingActions: [] },
    );
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/Unknown tool/i);
  });

  it("filters invoices and groups totals by currency", async () => {
    const result = await executeAgentTool(
      "get_invoice_summary",
      { status: "OPEN", min_amount: 500 },
      { invoices: [invoice], pendingActions: [] },
    );
    expect(result.isError).toBeFalsy();
    const data = result.data as {
      matched_count: number;
      totals_by_currency: Array<{ currency: string; total: number }>;
    };
    expect(data.matched_count).toBe(1);
    expect(data.totals_by_currency).toEqual([
      { currency: "USD", total: 1200, count: 1, formatted: "$1,200.00" },
    ]);
  });

  it("refuses to draft a reminder for an unknown invoice", async () => {
    const result = await executeAgentTool(
      "draft_payment_reminder",
      {
        invoice_id: "INVENTED-ID",
        tone: "friendly",
        subject: "Reminder",
        message: "This is a valid reminder message with enough characters.",
        rationale: "Test",
      },
      { invoices: [invoice], pendingActions: [] },
    );
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/No invoice found/i);
  });
});
