import { z } from "zod";
import { getConfig } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/db";
import {
  getDataSource,
  getLastSyncInfo,
  resetDemoData,
  setDataSource,
} from "@/lib/services/invoice-service";
import { getPendingActions } from "@/lib/services/action-service";
import { AppError, errorResponse } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  dataSource: z.enum(["DEMO", "PAYPAL"]).optional(),
  resetDemo: z.boolean().optional(),
});

export async function GET() {
  try {
    const config = getConfig();
    const sync = getLastSyncInfo();
    return Response.json({
      dataSource: getDataSource(),
      demoModeDefault: config.demoModeDefault,
      paypalConfigured: config.paypalConfigured,
      aiConfigured: config.aiConfigured,
      webhookConfigured: config.webhookConfigured,
      paypalBaseUrl: config.paypalBaseUrl,
      model: config.anthropicModel,
      webhookUrl: config.webhookUrl,
      lastSync: sync,
      lastConnectionCheck: getSetting("last_paypal_connection_check"),
      lastConnectionStatus: getSetting("last_paypal_connection_status"),
      pendingActions: getPendingActions(100).length,
      nodeEnv: config.nodeEnv,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (!parsed.data.dataSource && !parsed.data.resetDemo)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Provide dataSource and/or resetDemo.",
      );
    }

    if (parsed.data.dataSource) {
      setDataSource(parsed.data.dataSource);
      // Persist immediately so a demo/sandbox switch feels instant. PayPal
      // sync failures are surfaced by the invoices screen, not swallowed here.
      setSetting("data_source_changed_at", new Date().toISOString());
    }
    if (parsed.data.resetDemo) {
      resetDemoData();
      setDataSource("DEMO");
    }

    return Response.json({
      ok: true,
      dataSource: getDataSource(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
