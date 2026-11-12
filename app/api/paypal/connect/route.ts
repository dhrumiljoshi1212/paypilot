import { getConfig } from "@/lib/env";
import { getDb, logActivity, nowIso, setSetting } from "@/lib/db";
import { clearPayPalTokenCache, getPayPalAccessToken } from "@/lib/paypal/oauth";
import { errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = getConfig();
    if (!config.paypalConfigured) {
      return Response.json(
        {
          ok: false,
          configured: false,
          message:
            "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.local, then restart the app.",
        },
        { status: 503 },
      );
    }

    clearPayPalTokenCache();
    await getPayPalAccessToken();

    const checkedAt = nowIso();
    setSetting("last_paypal_connection_check", checkedAt);
    setSetting("last_paypal_connection_status", "ok");

    logActivity({
      kind: "INVOICE_UPDATED",
      title: "PayPal Sandbox connection verified",
      detail: "An OAuth access token was issued successfully.",
      source: "PAYPAL",
      level: "SUCCESS",
    });

    const invoiceCount = getDb()
      .prepare("SELECT COUNT(*) AS count FROM invoices_cache WHERE source = 'PAYPAL'")
      .get() as { count: number };

    return Response.json({
      ok: true,
      configured: true,
      environment: config.paypalBaseUrl.includes("sandbox") ? "sandbox" : "live",
      checkedAt,
      cachedInvoices: invoiceCount.count,
    });
  } catch (error) {
    setSetting("last_paypal_connection_check", nowIso());
    setSetting("last_paypal_connection_status", "error");
    return errorResponse(error);
  }
}
