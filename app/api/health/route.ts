import { getConfig } from "@/lib/env";
import { getDb } from "@/lib/db";
import { getDataSource } from "@/lib/services/invoice-service";
import { errorResponse } from "@/lib/utils/errors";
import type { HealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getConfig();
    getDb().prepare("SELECT 1").get();
    const dataSource = getDataSource();

    const body: HealthResponse = {
      ok: true,
      mode: dataSource === "PAYPAL" ? "sandbox" : "demo",
      dataSource,
      paypalConfigured: config.paypalConfigured,
      aiConfigured: config.aiConfigured,
      webhookConfigured: config.webhookConfigured,
      databaseConfigured: true,
      paypalBaseUrl: config.paypalBaseUrl,
      model: config.aiConfigured ? config.anthropicModel : undefined,
      webhookUrl: config.webhookUrl,
    };

    return Response.json(body);
  } catch (error) {
    return errorResponse(error);
  }
}
