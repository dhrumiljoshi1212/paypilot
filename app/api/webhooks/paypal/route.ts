import { getConfig } from "@/lib/env";
import {
  readWebhookHeaders,
  verifyPayPalWebhookSignature,
} from "@/lib/paypal/webhooks";
import { processWebhookEvent } from "@/lib/services/webhook-service";
import { AppError, errorResponse } from "@/lib/utils/errors";
import type { PayPalWebhookEvent } from "@/lib/paypal/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const config = getConfig();
    if (!config.webhookConfigured) {
      throw new AppError(
        "WEBHOOK_NOT_CONFIGURED",
        "Webhooks are not configured. Set PAYPAL_WEBHOOK_ID and sandbox credentials. Unverified events are never processed.",
      );
    }

    const raw = await request.text();
    if (raw.length === 0) {
      throw new AppError("VALIDATION_ERROR", "Empty webhook body.");
    }
    if (raw.length > 1_000_000) {
      throw new AppError("VALIDATION_ERROR", "Webhook body is too large.");
    }

    const headers = readWebhookHeaders(request);
    if (!headers) {
      throw new AppError(
        "WEBHOOK_VERIFICATION_FAILED",
        "Missing PayPal transmission headers. The event was not processed.",
      );
    }

    let event: PayPalWebhookEvent;
    try {
      event = JSON.parse(raw) as PayPalWebhookEvent;
    } catch {
      throw new AppError(
        "VALIDATION_ERROR",
        "Webhook body is not valid JSON.",
      );
    }

    if (!event?.id || !event?.event_type) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Webhook payload is missing id or event_type.",
      );
    }

    const verified = await verifyPayPalWebhookSignature({ headers, event });
    if (!verified) {
      throw new AppError(
        "WEBHOOK_VERIFICATION_FAILED",
        "PayPal signature verification failed. The event was rejected.",
      );
    }

    const result = await processWebhookEvent({
      event,
      verified: true,
      source: "PAYPAL",
      rawPayload: event,
    });

    return Response.json(
      result.duplicate
        ? { status: "duplicate", eventId: event.id }
        : { status: "processed", eventId: event.id },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
