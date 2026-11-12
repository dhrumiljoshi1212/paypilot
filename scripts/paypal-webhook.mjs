#!/usr/bin/env node
/**
 * PayPal webhook helper for sandbox development.
 *
 *   npm run webhook:list
 *   npm run webhook:register -- https://your-public-host
 *   npm run webhook:events
 *   npm run webhook:update -- <webhookId> https://new-public-host
 *   npm run webhook:delete -- <webhookId>
 *
 * The register command uses the wildcard `*` subscription because individual
 * invoicing subscriptions did not deliver in this sandbox during verification.
 *
 * Requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.
 */
const BASE = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
const WEBHOOK_PATH = "/api/webhooks/paypal";

if (!BASE.includes("sandbox")) {
  console.error("Refusing to run: PAYPAL_BASE_URL is not a sandbox URL.");
  process.exit(1);
}
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error("Missing PayPal sandbox credentials in .env");
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

async function token() {
  const basic = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`OAuth failed: HTTP ${response.status}`);
  }
  return body.access_token;
}

async function api(accessToken, path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { response, body };
}

function normalizeListenerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provide a valid public URL, for example https://abc.example.com");
  }
  if (url.protocol !== "https:") {
    throw new Error("PayPal webhooks require HTTPS.");
  }
  return url.pathname.endsWith(WEBHOOK_PATH)
    ? url.toString().replace(/\/$/, "")
    : `${url.origin}${WEBHOOK_PATH}`;
}

async function listWebhooks(accessToken) {
  const { response, body } = await api(accessToken, "/v1/notifications/webhooks?page_size=10");
  if (!response.ok) throw new Error(`List failed: HTTP ${response.status}`);
  return body.webhooks ?? [];
}

async function main() {
  const accessToken = await token();

  switch (command) {
    case "list": {
      const webhooks = await listWebhooks(accessToken);
      if (webhooks.length === 0) {
        console.log("No webhooks registered for this sandbox app.");
        return;
      }
      for (const webhook of webhooks) {
        console.log(`${webhook.id}  ${webhook.url}`);
        console.log(`  events: ${webhook.event_types.map((event) => event.name).join(", ")}`);
      }
      return;
    }

    case "register": {
      const rawUrl = args[0];
      if (!rawUrl) throw new Error("Usage: webhook:register -- https://public-host");
      const listener = normalizeListenerUrl(rawUrl);
      const existing = await listWebhooks(accessToken);
      const match = existing.find((webhook) => webhook.url === listener);
      if (match) {
        console.log(`Webhook already exists: ${match.id}`);
        console.log(`Add to .env: PAYPAL_WEBHOOK_ID=${match.id}`);
        return;
      }

      const { response, body } = await api(accessToken, "/v1/notifications/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: listener,
          event_types: [{ name: "*" }],
        }),
      });
      if (!response.ok) {
        throw new Error(`Register failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 400)}`);
      }
      console.log(`Registered webhook ${body.id}`);
      console.log(`  URL: ${body.url}`);
      console.log(`  Events: ${body.event_types.map((event) => event.name).join(", ")}`);
      console.log(`Add to .env: PAYPAL_WEBHOOK_ID=${body.id}`);
      console.log("Then restart the app so the new webhook ID is loaded.");
      return;
    }

    case "update": {
      const [id, rawUrl] = args;
      if (!id || !rawUrl) throw new Error("Usage: webhook:update -- <webhookId> https://public-host");
      const listener = normalizeListenerUrl(rawUrl);
      const { response } = await api(accessToken, `/v1/notifications/webhooks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify([{ op: "replace", path: "/url", value: listener }]),
      });
      if (!response.ok) throw new Error(`Update failed: HTTP ${response.status}`);
      console.log(`Webhook ${id} now points to ${listener}`);
      return;
    }

    case "delete": {
      const [id] = args;
      if (!id) throw new Error("Usage: webhook:delete -- <webhookId>");
      const { response } = await api(accessToken, `/v1/notifications/webhooks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Delete failed: HTTP ${response.status}`);
      console.log(`Deleted webhook ${id}. Clear PAYPAL_WEBHOOK_ID in .env.`);
      return;
    }

    case "events": {
      const { response, body } = await api(accessToken, "/v1/notifications/webhooks-events?page_size=20");
      if (!response.ok) throw new Error(`Events failed: HTTP ${response.status}`);
      const events = body.events ?? [];
      if (events.length === 0) {
        console.log("No webhook events generated for this app yet.");
        return;
      }
      for (const event of events) {
        const invoice = event.resource?.invoice?.id ?? event.resource?.id ?? "n/a";
        console.log(`${event.create_time}  ${event.event_type}  ${invoice}`);
      }
      return;
    }

    default:
      console.log(`PayPal webhook helper

  npm run webhook:list
  npm run webhook:register -- https://your-public-host
  npm run webhook:events
  npm run webhook:update -- <webhookId> https://new-public-host
  npm run webhook:delete -- <webhookId>
`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
