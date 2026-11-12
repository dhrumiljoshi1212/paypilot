import "server-only";

export type RuntimeConfig = {
  appUrl: string;
  nodeEnv: string;
  paypalBaseUrl: string;
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalWebhookId?: string;
  paypalConfigured: boolean;
  anthropicApiKey?: string;
  anthropicModel: string;
  aiConfigured: boolean;
  webhookConfigured: boolean;
  demoModeDefault: boolean;
  databasePath: string;
  maxAgentRounds: number;
  webhookUrl: string;
};

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanEnv(name: string): boolean | undefined {
  const value = read(name)?.toLowerCase();
  if (value === undefined) return undefined;
  return value === "true" || value === "1" || value === "yes";
}

export function getConfig(): RuntimeConfig {
  const paypalClientId = read("PAYPAL_CLIENT_ID");
  const paypalClientSecret = read("PAYPAL_CLIENT_SECRET");
  const paypalWebhookId = read("PAYPAL_WEBHOOK_ID");
  const anthropicApiKey = read("ANTHROPIC_API_KEY");

  const paypalBaseUrl =
    read("PAYPAL_BASE_URL") ?? "https://api-m.sandbox.paypal.com";

  // PayPilot is a sandbox-only hackathon project. Refuse to accidentally point
  // live credentials at real money movement unless explicitly overridden.
  if (
    !paypalBaseUrl.includes("sandbox") &&
    booleanEnv("ALLOW_LIVE_PAYPAL") !== true
  ) {
    throw new Error(
      "PAYPAL_BASE_URL must be a sandbox URL. Set ALLOW_LIVE_PAYPAL=true only if you understand the risk.",
    );
  }

  const paypalConfigured = Boolean(paypalClientId && paypalClientSecret);
  const aiConfigured = Boolean(anthropicApiKey);
  const appUrl = read("APP_URL") ?? "http://localhost:3000";

  const demoModeDefault =
    booleanEnv("DEMO_MODE") ?? !paypalConfigured;

  const maxAgentRounds = Number(read("MAX_AGENT_ROUNDS") ?? "5");

  return {
    appUrl,
    nodeEnv: read("NODE_ENV") ?? "development",
    paypalBaseUrl: paypalBaseUrl.replace(/\/$/, ""),
    paypalClientId,
    paypalClientSecret,
    paypalWebhookId,
    paypalConfigured,
    anthropicApiKey,
    anthropicModel:
      read("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
    aiConfigured,
    webhookConfigured: Boolean(paypalWebhookId && paypalConfigured),
    demoModeDefault,
    databasePath: read("DATABASE_PATH") ?? "data/paypilot.db",
    maxAgentRounds:
      Number.isFinite(maxAgentRounds) && maxAgentRounds > 0
        ? Math.min(maxAgentRounds, 10)
        : 5,
    webhookUrl: `${appUrl.replace(/\/$/, "")}/api/webhooks/paypal`,
  };
}

export function assertPayPalConfigured(): {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
} {
  const config = getConfig();
  if (!config.paypalConfigured) {
    throw new Error(
      "PayPal Sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
    );
  }
  return {
    clientId: config.paypalClientId!,
    clientSecret: config.paypalClientSecret!,
    baseUrl: config.paypalBaseUrl,
  };
}
