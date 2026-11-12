import "server-only";

import { AppError, redact } from "@/lib/utils/errors";
import { assertPayPalConfigured } from "@/lib/env";
import { clearPayPalTokenCache, getPayPalAccessToken } from "./oauth";
import type { PayPalErrorBody } from "./types";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type RequestOptions = {
  method?: Method;
  body?: unknown;
  requestId?: string;
  /** Only safe/idempotent requests are retried. */
  retryable?: boolean;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

async function parseErrorBody(response: Response): Promise<PayPalErrorBody> {
  try {
    return (await response.json()) as PayPalErrorBody;
  } catch {
    return {};
  }
}

function providerMessage(body: PayPalErrorBody, status: number): string {
  const detail = body.details?.find((item) => item.description || item.issue);
  const message = body.message || detail?.description || detail?.issue;
  if (message) return message;
  if (status === 401) return "PayPal rejected the access token.";
  if (status === 403) return "This PayPal app is not permitted to perform that operation.";
  if (status === 404) return "PayPal could not find that resource.";
  if (status === 429) return "PayPal rate limit reached. Wait a moment and try again.";
  return `PayPal returned HTTP ${status}.`;
}

export async function paypalRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { baseUrl } = assertPayPalConfigured();
  const method = options.method ?? "GET";
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  // Writes are only retried when they carry a PayPal-Request-Id, so a timeout
  // can never create a duplicate reminder.
  const canRetry = method === "GET" || Boolean(options.requestId);
  const maxAttempts = options.retryable === false || !canRetry ? 1 : 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let token: string;
    try {
      token = await getPayPalAccessToken();
    } catch (error) {
      if (attempt < maxAttempts) continue;
      throw error;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    };
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        cache: "no-store",
      });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) continue;
      throw new AppError(
        "PAYPAL_API_ERROR",
        "Could not reach the PayPal API. Check connectivity and try again.",
        {
          details: redact(error instanceof Error ? error.message : String(error)),
        },
      );
    }

    const debugId =
      response.headers.get("paypal-debug-id") ??
      response.headers.get("correlation-id") ??
      undefined;

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AppError(
          "PAYPAL_API_ERROR",
          "PayPal returned a response PayPilot could not read.",
          { requestId: debugId },
        );
      }
    }

    const body = await parseErrorBody(response);

    if (response.status === 401) {
      clearPayPalTokenCache();
      if (attempt < maxAttempts) continue;
    }

    const retryableStatus =
      response.status === 429 || response.status >= 500;
    if (retryableStatus && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      continue;
    }

    throw new AppError(
      response.status === 401 ? "PAYPAL_AUTH_ERROR" : "PAYPAL_API_ERROR",
      providerMessage(body, response.status),
      {
        requestId: body.debug_id ?? debugId,
        details: body.details,
        status: response.status === 422 ? 422 : undefined,
      },
    );
  }

  throw new AppError(
    "PAYPAL_API_ERROR",
    "PayPal request failed after retrying.",
    {
      details: redact(
        lastError instanceof Error ? lastError.message : String(lastError),
      ),
    },
  );
}
