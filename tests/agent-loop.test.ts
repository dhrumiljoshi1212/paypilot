import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  responses: [] as Array<Record<string, unknown>>,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (input: Record<string, unknown>) => {
        state.calls.push(input);
        const next = state.responses.shift();
        if (!next) throw new Error("No mocked Anthropic response left");
        return next;
      },
    };
    constructor() {}
  }
  class APIError extends Error {
    status = 500;
  }
  return { default: FakeAnthropic, APIError };
});

import { closeDb, getDb } from "@/lib/db";
import { upsertInvoice } from "@/lib/services/invoice-service";
import { runAgent } from "@/lib/ai/agent";
import type { Invoice } from "@/lib/types";

const invoice: Invoice = {
  id: "AGENT-INV-1",
  number: "INV-5001",
  status: "SENT",
  paypalStatus: "SENT",
  currency: "USD",
  totalAmount: 1200,
  dueDate: "2026-05-01",
  invoiceDate: "2026-04-01",
  customerName: "Agent Customer",
  source: "DEMO",
  lastSyncedAt: new Date().toISOString(),
  daysOverdue: 9,
  isOverdue: true,
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const db = getDb();
  db.exec("DELETE FROM agent_actions");
  db.exec("DELETE FROM activity_events");
  db.exec("DELETE FROM invoices_cache");
  upsertInvoice(invoice);
  state.responses = [];
  state.calls = [];
});

afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  closeDb();
});

describe("agent tool-calling loop", () => {
  it("executes a read tool, feeds the result back, and returns a final answer", async () => {
    state.responses.push(
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "get_invoice_summary",
            input: { status: "OPEN" },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: "You have one open invoice for $1,200.00, which is 9 days overdue.",
          },
        ],
      },
    );

    const response = await runAgent({ message: "What is overdue?" });

    expect(response.message).toContain("9 days overdue");
    expect(response.toolActivities).toHaveLength(1);
    expect(response.toolActivities[0].status).toBe("completed");
    expect(response.pendingActions).toHaveLength(0);
    expect(state.calls).toHaveLength(2);

    // The second call must include the tool result, not just the user prompt.
    const secondMessages = state.calls[1].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const serialized = JSON.stringify(secondMessages);
    expect(serialized).toContain("tool_result");
    expect(serialized).toContain("INV-5001");
  });

  it("stores a pending approval action for the draft tool and never executes it", async () => {
    state.responses.push(
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-draft",
            name: "draft_payment_reminder",
            input: {
              invoice_id: "AGENT-INV-1",
              tone: "friendly",
              subject: "Quick reminder about INV-5001",
              message:
                "Hi Agent Customer, invoice INV-5001 for $1,200.00 was due on May 1. Could you take a look?",
              rationale: "It is 9 days overdue and is a sizeable invoice.",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: "I created a draft. Nothing has been sent — please review and approve it.",
          },
        ],
      },
    );

    const response = await runAgent({
      message: "Draft a friendly reminder for the overdue invoice.",
    });

    expect(response.pendingActions).toHaveLength(1);
    expect(response.pendingActions[0].status).toBe("PENDING_APPROVAL");
    expect(response.pendingActions[0].actionType).toBe("SEND_REMINDER");

    const row = getDb()
      .prepare("SELECT status, mode, paypal_response FROM agent_actions")
      .get() as { status: string; mode: string; paypal_response: string | null };
    expect(row.status).toBe("PENDING_APPROVAL");
    expect(row.mode).toBe("DEMO");
    expect(row.paypal_response).toBeNull();

    // No execution event is written by drafting.
    const executed = getDb()
      .prepare("SELECT COUNT(*) AS count FROM activity_events WHERE kind = 'ACTION_EXECUTED'")
      .get() as { count: number };
    expect(executed.count).toBe(0);
  });
});
