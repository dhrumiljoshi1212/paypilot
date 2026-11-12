import { z } from "zod";
import {
  getDataSource,
  rowToInvoice,
  resetDemoData,
} from "@/lib/services/invoice-service";
import { simulatePaidEvent } from "@/lib/services/webhook-service";
import { getDb } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/utils/errors";
import type { InvoiceRow } from "@/lib/services/invoice-service";

export const dynamic = "force-dynamic";

const schema = z.object({ invoiceId: z.string().min(1).max(200) });

/**
 * Demo-only lifecycle helper. It records a LOCAL TEST event, not a PayPal
 * webhook, and refuses to run against PayPal-sourced data.
 */
export async function POST(request: Request) {
  try {
    if (getDataSource() !== "DEMO") {
      throw new AppError(
        "DEMO_MODE_RESTRICTED",
        "Local payment simulation is only available in Demo data mode. Real payments arrive through verified PayPal webhooks.",
      );
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Provide a valid invoiceId.");
    }

    const row = getDb()
      .prepare("SELECT * FROM invoices_cache WHERE id = ?")
      .get(parsed.data.invoiceId) as InvoiceRow | undefined;
    if (!row) {
      throw new AppError("NOT_FOUND", "That demo invoice does not exist.");
    }
    if (row.source !== "DEMO") {
      throw new AppError(
        "DEMO_MODE_RESTRICTED",
        "Only demo invoices can be simulated.",
      );
    }

    const result = simulatePaidEvent(row.id);
    const updated = getDb()
      .prepare("SELECT * FROM invoices_cache WHERE id = ?")
      .get(row.id) as InvoiceRow;

    return Response.json({
      ok: true,
      alreadyPaid: result.alreadyPaid,
      invoice: rowToInvoice(updated),
      note: "LOCAL TEST FIXTURE — no PayPal webhook was received.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    if (getDataSource() !== "DEMO") {
      throw new AppError(
        "DEMO_MODE_RESTRICTED",
        "Switch to Demo data before resetting demo records.",
      );
    }
    resetDemoData();
    return Response.json({ ok: true, note: "Demo data reset." });
  } catch (error) {
    return errorResponse(error);
  }
}
