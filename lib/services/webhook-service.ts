import "server-only";

import { getDb, logActivity, nowIso, uuid } from "@/lib/db";
import type { NormalizedInvoiceStatus } from "@/lib/types";
import { AppError, redact } from "@/lib/utils/errors";
import type { PayPalWebhookEvent } from "@/lib/paypal/types";
import {
  markInvoiceStatus,
  refreshInvoiceFromPayPal,
} from "./invoice-service";

const INVOICE_EVENT_STATUS: Record<string, NormalizedInvoiceStatus> = {
  "INVOICING.INVOICE.PAID": "PAID",
  "INVOICING.INVOICE.CANCELLED": "CANCELLED",
  "INVOICING.INVOICE.REFUNDED": "REFUNDED_OR_OTHER",
  "INVOICING.INVOICE.SENT": "SENT",
};

export type WebhookRecordResult = {
  duplicate: boolean;
  eventRowId: string;
  processed: boolean;
};

export function eventResourceId(event: PayPalWebhookEvent): string | undefined {
  const resource = event.resource;
  if (!resource) return undefined;

  // PayPal Invoicing events nest the invoice: resource.invoice.id.
  // Keep the documented fallbacks for other webhook families.
  if (resource.invoice && typeof resource.invoice.id === "string") {
    return resource.invoice.id;
  }
  return (
    resource.invoice_id ??
    (typeof resource.id === "string" ? resource.id : undefined)
  );
}

export async function processWebhookEvent(input: {
  event: PayPalWebhookEvent;
  verified: boolean;
  source?: "PAYPAL" | "LOCAL_TEST";
  rawPayload?: unknown;
}): Promise<WebhookRecordResult> {
  const db = getDb();
  const source = input.source ?? "PAYPAL";
  const resourceId = eventResourceId(input.event);
  const eventRowId = uuid();
  const payload = JSON.stringify(input.rawPayload ?? input.event).slice(
    0,
    200_000,
  );

  const insert = db
    .prepare(
      `INSERT INTO webhook_events
        (id, paypal_event_id, event_type, resource_id, received_at,
         processing_status, payload, verified, source)
       VALUES (?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?)
       ON CONFLICT(paypal_event_id) DO NOTHING`,
    )
    .run(
      eventRowId,
      input.event.id,
      input.event.event_type,
      resourceId ?? null,
      nowIso(),
      payload,
      input.verified ? 1 : 0,
      source,
    );

  if (insert.changes === 0) {
    return { duplicate: true, eventRowId: "", processed: true };
  }

  try {
    let invoiceUpdated = false;

    if (!input.event.event_type.startsWith("INVOICING.")) {
      db.prepare(
        `UPDATE webhook_events
         SET processing_status = 'PROCESSED', processed_at = ?
         WHERE id = ?`,
      ).run(nowIso(), eventRowId);
      logActivity({
        kind: "WEBHOOK_RECEIVED",
        title: `Ignored non-invoice webhook: ${input.event.event_type}`,
        detail: "PayPilot only applies invoice lifecycle events.",
        source,
        level: "INFO",
        metadata: { eventType: input.event.event_type },
      });
      return { duplicate: false, eventRowId, processed: true };
    }

    if (resourceId) {
      if (source === "PAYPAL" && input.verified) {
        // Do not trust an event snapshot; fetch the current invoice state.
        const invoice = await refreshInvoiceFromPayPal(resourceId, {
          silent: true,
        });
        invoiceUpdated = true;
        logActivity({
          kind: "INVOICE_UPDATED",
          title: `Invoice ${invoice.number ?? invoice.id} updated from PayPal webhook`,
          detail: `${input.event.event_type} → ${invoice.paypalStatus}`,
          invoiceId: invoice.id,
          source: "PAYPAL",
          level: input.event.event_type === "INVOICING.INVOICE.PAID" ? "SUCCESS" : "INFO",
          metadata: { eventType: input.event.event_type, eventId: input.event.id },
        });
      } else {
        const nextStatus = INVOICE_EVENT_STATUS[input.event.event_type];
        if (nextStatus) {
          const invoice = markInvoiceStatus(resourceId, nextStatus, {
            paypalStatus: nextStatus,
            source: "DEMO",
          });
          invoiceUpdated = Boolean(invoice);
        }
      }
    }

    db.prepare(
      `UPDATE webhook_events
       SET processing_status = 'PROCESSED', processed_at = ?
       WHERE id = ?`,
    ).run(nowIso(), eventRowId);

    logActivity({
      kind:
        input.event.event_type === "INVOICING.INVOICE.PAID"
          ? "PAYMENT_RECORDED"
          : "WEBHOOK_RECEIVED",
      title:
        source === "LOCAL_TEST"
          ? "Local test event recorded (not a PayPal webhook)"
          : `PayPal webhook: ${input.event.event_type}`,
      detail:
        source === "LOCAL_TEST"
          ? "This event was generated locally to exercise the UI. It is not a verified PayPal delivery."
          : `Verified event ${input.event.id}${resourceId ? ` for ${resourceId}` : ""}.${invoiceUpdated ? " Invoice cache refreshed." : ""}`,
      invoiceId: resourceId,
      source,
      level: source === "LOCAL_TEST" ? "WARNING" : "SUCCESS",
      metadata: { eventType: input.event.event_type, verified: input.verified },
    });

    return { duplicate: false, eventRowId, processed: true };
  } catch (error) {
    const message = redact(
      error instanceof Error ? error.message : "Webhook processing failed",
    );
    db.prepare(
      `UPDATE webhook_events
       SET processing_status = 'FAILED', processed_at = ?, error = ?
       WHERE id = ?`,
    ).run(nowIso(), message, eventRowId);

    logActivity({
      kind: "WEBHOOK_RECEIVED",
      level: "ERROR",
      title: `Webhook processing failed: ${input.event.event_type}`,
      detail: message,
      invoiceId: resourceId,
      source,
      metadata: { eventId: input.event.id },
    });

    throw new AppError(
      "INTERNAL_ERROR",
      "The webhook was verified but could not be processed. PayPal may retry it.",
      { details: message },
    );
  }
}

/**
 * Creates a clearly-labelled local test event. Never used by the public
 * webhook endpoint; only the demo "simulate payment" action calls this.
 */
export function simulatePaidEvent(invoiceId: string): WebhookRecordResult & {
  alreadyPaid: boolean;
} {
  const invoiceRow = getDb()
    .prepare("SELECT status FROM invoices_cache WHERE id = ?")
    .get(invoiceId) as { status: string } | undefined;

  const alreadyPaid = invoiceRow?.status === "PAID";
  const event: PayPalWebhookEvent = {
    id: `LOCAL-TEST-${uuid()}`,
    event_type: "INVOICING.INVOICE.PAID",
    resource_type: "invoice",
    summary: "Local test fixture — not a PayPal delivery",
    resource: { id: invoiceId, invoice_id: invoiceId, status: "PAID" },
  };

  const db = getDb();
  const eventRowId = uuid();
  db.prepare(
    `INSERT INTO webhook_events
      (id, paypal_event_id, event_type, resource_id, received_at,
       processing_status, payload, verified, source)
     VALUES (?, ?, 'INVOICING.INVOICE.PAID', ?, ?, 'PROCESSED', ?, 0, 'LOCAL_TEST')`,
  ).run(
    eventRowId,
    event.id,
    invoiceId,
    nowIso(),
    JSON.stringify(event),
  );

  if (!alreadyPaid) {
    markInvoiceStatus(invoiceId, "PAID", {
      paypalStatus: "LOCAL_TEST_PAID",
      source: "DEMO",
    });
  }

  logActivity({
    kind: "PAYMENT_RECORDED",
    title: alreadyPaid
      ? "Local test payment event received (invoice already paid)"
      : "Local test payment event received",
    detail:
      "LOCAL TEST FIXTURE — this did not come from PayPal. Use a real webhook delivery to verify production behaviour.",
    invoiceId,
    source: "LOCAL_TEST",
    level: "WARNING",
  });

  return {
    duplicate: false,
    eventRowId,
    processed: true,
    alreadyPaid,
  };
}
