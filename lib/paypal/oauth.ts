import "server-only";

import { AppError, redact } from "@/lib/utils/errors";
import { assertPayPalConfigured } from "@/lib/env";
import type { PayPalErrorBody, PayPalTokenResponse } from "./types";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;

function isFresh(token: CachedToken | null): token is CachedToken {
  return Boolean(token && token.expiresAt > Date.now() + 60_000);
}

async function requestToken(): Promise<CachedToken> {
  const { clientId, clientSecret, baseUrl } = assertPayPalConfigured();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Accept-Language": "en_US",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new AppError(
      "PAYPAL_AUTH_ERROR",
      "Could not reach PayPal to obtain an access token. Check your network and sandbox credentials.",
      { details: redact(error instanceof Error ? error.message : String(error)) },
    );
  }

  const debugId = response.headers.get("paypal-debug-id") ?? undefined;

  if (!response.ok) {
    let body: PayPalErrorBody = {};
    try {
      body = (await response.json()) as PayPalErrorBody;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new AppError(
      "PAYPAL_AUTH_ERROR",
      response.status === 401
        ? "PayPal rejected the sandbox credentials. Confirm PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET belong to the same sandbox app."
        : `PayPal authentication failed (HTTP ${response.status}).`,
      {
        requestId: body.debug_id ?? debugId,
        details: redact(body.error_description ?? body.message ?? ""),
      },
    );
  }

  const body = (await response.json()) as PayPalTokenResponse;
  if (!body.access_token) {
    throw new AppError(
      "PAYPAL_AUTH_ERROR",
      "PayPal returned an empty access token.",
      { requestId: debugId },
    );
  }

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + Math.max(60, body.expires_in - 120) * 1000,
  };
}

export async function getPayPalAccessToken(): Promise<string> {
  if (isFresh(cached)) return cached.accessToken;

  if (!inflight) {
    inflight = requestToken()
      .then((token) => {
        cached = token;
        return token;
      })
      .finally(() => {
        inflight = null;
      });
  }

  const token = await inflight;
  return token.accessToken;
}

export function clearPayPalTokenCache(): void {
  cached = null;
}
