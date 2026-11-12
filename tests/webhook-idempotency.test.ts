import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { upsertInvoice } from "@/lib/services/invoice-service";
import { processWebhookEvent } from "@/lib/services/webhook-service";
import type { Invoice } from "@/lib/types";
import type { PayPalWebhookEvent } from "@/lib/paypal/types";

const invoice: Invoice = {
  id: "WEBHOOK-INV-1",
  number: "INV-7001",
  status: "SENT",
  paypalStatus: "SENT",
  currency: "USD",
  totalAmount: 600,
  dueDate: "2026-05-01",
  invoiceDate: "2026-04-01",
  customerName: "Webhook Customer",
  source: "DEMO",
  lastSyncedAt: new Date().toISOString(),
  daysOverdue: 8,
  isOverdue: true,
};

function event(id: string): PayPalWebhookEvent {
  return {
    id,
    event_type: "INVOICING.INVOICE.PAID",
    resource: { id: invoice.id, invoice_id: invoice.id, status: "PAID" },
  };
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM webhook_events");
  db.exec("DELETE FROM activity_events");
  db.exec("DELETE FROM invoices_cache");
  upsertInvoice(invoice);
});

afterAll(closeDb);

describe("webhook idempotency", () => {
  it("processes an event once and acknowledges duplicates", async () => {
    const first = await processWebhookEvent({
      event: event("WH-EVT-1"),
      verified: false,
      source: "LOCAL_TEST",
    });
    expect(first.duplicate).toBe(false);
    expect(first.processed).toBe(true);

    const second = await processWebhookEvent({
      event: event("WH-EVT-1"),
      verified: false,
      source: "LOCAL_TEST",
    });
    expect(second.duplicate).toBe(true);

    const events = getDb()
      .prepare("SELECT COUNT(*) AS count FROM webhook_events")
      .get() as { count: number };
    expect(events.count).toBe(1);

    const activity = getDb()
      .prepare("SELECT COUNT(*) AS count FROM activity_events")
      .get() as { count: number };
    expect(activity.count).toBe(1);

    const row = getDb()
      .prepare("SELECT status FROM invoices_cache WHERE id = ?")
      .get(invoice.id) as { status: string };
    expect(row.status).toBe("PAID");
  });

  it("extracts the invoice ID from PayPal's nested invoice resource", async () => {
    upsertInvoice({ ...invoice, id: "NESTED-INV-1", status: "SENT", paypalStatus: "SENT" });
    const nested: PayPalWebhookEvent = {
      id: "WH-NESTED-1",
      event_type: "INVOICING.INVOICE.PAID",
      resource: { invoice: { id: "NESTED-INV-1", status: "PAID" } },
    };
    const result = await processWebhookEvent({
      event: nested,
      verified: false,
      source: "LOCAL_TEST",
    });
    expect(result.duplicate).toBe(false);

    const row = getDb()
      .prepare("SELECT resource_id FROM webhook_events WHERE paypal_event_id = ?")
      .get("WH-NESTED-1") as { resource_id: string };
    expect(row.resource_id).toBe("NESTED-INV-1");
  });

  it("rejects a second event with the same ID even if it is a different type", async () => {
    await processWebhookEvent({
      event: event("WH-EVT-2"),
      verified: false,
      source: "LOCAL_TEST",
    });
    const duplicate = await processWebhookEvent({
      event: { ...event("WH-EVT-2"), event_type: "INVOICING.INVOICE.CANCELLED" },
      verified: false,
      source: "LOCAL_TEST",
    });
    expect(duplicate.duplicate).toBe(true);
  });
});
