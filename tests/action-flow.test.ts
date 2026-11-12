import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import {
  approveAction,
  cancelAction,
  createDraftAction,
  executeAction,
  getAction,
} from "@/lib/services/action-service";
import {
  getAllInvoices,
  upsertInvoice,
} from "@/lib/services/invoice-service";
import type { Invoice } from "@/lib/types";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "TEST-INV-1",
    number: "INV-9001",
    status: "SENT",
    paypalStatus: "SENT",
    currency: "USD",
    totalAmount: 850,
    dueDate: "2026-05-01",
    invoiceDate: "2026-04-01",
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    source: "DEMO",
    lastSyncedAt: new Date().toISOString(),
    daysOverdue: 8,
    isOverdue: true,
    ...overrides,
  };
}

function reset(): void {
  const db = getDb();
  db.exec("DELETE FROM agent_actions");
  db.exec("DELETE FROM webhook_events");
  db.exec("DELETE FROM activity_events");
  db.exec("DELETE FROM invoices_cache");
}

beforeEach(reset);
afterAll(closeDb);

describe("human approval state machine", () => {
  it("creates a pending draft, requires approval, and executes once", async () => {
    const inv = invoice();
    upsertInvoice(inv);

    const draft = createDraftAction({
      invoice: inv,
      subject: "Payment reminder for INV-9001",
      message: "Hello, this is a reminder that invoice INV-9001 is past due.",
      rationale: "It is 8 days overdue.",
      origin: "AI",
    });

    expect(draft.status).toBe("PENDING_APPROVAL");
    expect(draft.paypalResponse).toBeUndefined();

    await expect(executeAction(draft.id)).rejects.toThrow(/approved/i);

    const approved = approveAction(draft.id, {
      subject: "Updated subject",
      message: "Edited message that the owner approved before sending.",
    });
    expect(approved.status).toBe("APPROVED");
    expect(approved.draftSubject).toBe("Updated subject");
    expect(approved.approvedAt).toBeTruthy();

    const executed = await executeAction(draft.id);
    expect(executed.status).toBe("EXECUTED");
    expect(executed.executionError).toBeUndefined();
    expect(executed.paypalResponse?.demo).toBe(true);

    const again = await executeAction(draft.id);
    expect(again.status).toBe("EXECUTED");

    const executedEvents = getDb()
      .prepare("SELECT COUNT(*) AS count FROM activity_events WHERE kind = 'ACTION_EXECUTED'")
      .get() as { count: number };
    expect(executedEvents.count).toBe(1);
  });

  it("refuses a second approval", () => {
    const inv = invoice();
    upsertInvoice(inv);
    const draft = createDraftAction({
      invoice: inv,
      subject: "Reminder",
      message: "A valid reminder message for testing.",
      rationale: "Testing the state machine.",
      origin: "MANUAL",
    });

    approveAction(draft.id, {});
    expect(() => approveAction(draft.id, {})).toThrow(/pending/i);
  });

  it("cannot execute a cancelled action", async () => {
    const inv = invoice();
    upsertInvoice(inv);
    const draft = createDraftAction({
      invoice: inv,
      subject: "Reminder",
      message: "A valid reminder message for testing.",
      rationale: "Testing the state machine.",
      origin: "MANUAL",
    });

    cancelAction(draft.id);
    await expect(executeAction(draft.id)).rejects.toThrow(/cancelled/i);
    expect(getAction(draft.id).status).toBe("CANCELLED");
  });

  it("never mixes demo and PayPal records in one workspace view", async () => {
    upsertInvoice(invoice());
    upsertInvoice(invoice({ id: "PAYPAL-INV-1", source: "PAYPAL" }));

    const visible = await getAllInvoices({ autoSync: false });
    expect(visible).toHaveLength(1);
    expect(visible[0].source).toBe("DEMO");
  });

  it("refuses drafts for invoices that are not eligible", () => {
    const inv = invoice({ status: "PAID", isOverdue: false, daysOverdue: 0 });
    upsertInvoice(inv);

    expect(() =>
      createDraftAction({
        invoice: inv,
        subject: "Reminder",
        message: "A valid reminder message for testing.",
        rationale: "Testing eligibility.",
        origin: "MANUAL",
      }),
    ).toThrow(/already paid/i);
  });
});
