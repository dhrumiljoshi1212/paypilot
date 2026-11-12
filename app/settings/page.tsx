import { SettingsPanel } from "@/components/settings-panel";
import { PageHeader } from "@/components/metric-card";
import { getConfig } from "@/lib/env";
import { getSetting } from "@/lib/db";
import {
  getDataSource,
  getLastSyncInfo,
} from "@/lib/services/invoice-service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  const config = getConfig();
  const sync = getLastSyncInfo();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Connection state, data source, and webhook setup. Secrets are read server-side and never returned to the browser."
      />
      <SettingsPanel
        initial={{
          dataSource: getDataSource(),
          paypalConfigured: config.paypalConfigured,
          aiConfigured: config.aiConfigured,
          webhookConfigured: config.webhookConfigured,
          paypalBaseUrl: config.paypalBaseUrl,
          model: config.anthropicModel,
          webhookUrl: config.webhookUrl,
          lastSyncAt: sync.lastSyncAt,
          lastError: sync.lastError,
          lastConnectionCheck:
            getSetting("last_paypal_connection_check") || undefined,
          lastConnectionStatus:
            getSetting("last_paypal_connection_status") || undefined,
          nodeEnv: config.nodeEnv,
        }}
      />
    </div>
  );
}
