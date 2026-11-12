import "server-only";

import { getConfig } from "@/lib/env";
import { AppError } from "@/lib/utils/errors";
import { paypalRequest } from "./client";
import type { PayPalWebhookEvent } from "./types";

export type WebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
};

export type VerificationResult = {
  verification_status: "SUCCESS" | "FAILURE" | string;
};

export async function verifyPayPalWebhookSignature(input: {
  headers: WebhookHeaders;
  event: PayPalWebhookEvent;
}): Promise<boolean> {
  const config = getConfig();
  if (!config.paypalWebhookId) {
    throw new AppError(
      "WEBHOOK_NOT_CONFIGURED",
      "PAYPAL_WEBHOOK_ID is not configured, so this webhook cannot be verified.",
    );
  }

  const result = await paypalRequest<VerificationResult>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      retryable: true,
      body: {
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSig,
        transmission_time: input.headers.transmissionTime,
        webhook_id: config.paypalWebhookId,
        webhook_event: input.event,
      },
    },
  );

  return result.verification_status === "SUCCESS";
}

export function readWebhookHeaders(request: Request): WebhookHeaders | null {
  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");
  const transmissionSig = request.headers.get("paypal-transmission-sig");

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    return null;
  }

  return { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig };
}
