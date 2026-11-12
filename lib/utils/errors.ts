export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYPAL_NOT_CONFIGURED"
  | "PAYPAL_API_ERROR"
  | "PAYPAL_AUTH_ERROR"
  | "PAYPAL_INELIGIBLE_INVOICE"
  | "WEBHOOK_NOT_CONFIGURED"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "AI_NOT_CONFIGURED"
  | "AI_ERROR"
  | "DEMO_MODE_RESTRICTED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYPAL_NOT_CONFIGURED: 503,
  PAYPAL_API_ERROR: 502,
  PAYPAL_AUTH_ERROR: 502,
  PAYPAL_INELIGIBLE_INVOICE: 422,
  WEBHOOK_NOT_CONFIGURED: 503,
  WEBHOOK_VERIFICATION_FAILED: 400,
  AI_NOT_CONFIGURED: 503,
  AI_ERROR: 502,
  DEMO_MODE_RESTRICTED: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  requestId?: string;
  details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { requestId?: string; details?: unknown; status?: number },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code];
    this.requestId = options?.requestId;
    this.details = options?.details;
  }
}

export function errorResponse(error: unknown): Response {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", "Something went wrong. Please try again.");

  if (!(error instanceof AppError)) {
    console.error("[paypilot] unhandled error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return Response.json(
    {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.requestId ? { requestId: appError.requestId } : {}),
      },
    },
    { status: appError.status },
  );
}

export function redact(value: string, maxLength = 300): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/("access_token"\s*:\s*")[^"]+/gi, "$1[redacted]")
    .replace(/(client_secret=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, maxLength);
}
