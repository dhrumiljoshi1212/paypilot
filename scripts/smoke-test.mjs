#!/usr/bin/env node
/**
 * PayPal + app smoke test. Read-only except for the deliberately invalid
 * webhook request, which must be rejected.
 *
 * Usage: npm run smoke
 */
const BASE = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`);
}

if (!CLIENT_ID || !SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET. Copy .env.example to .env.local first.");
  process.exit(1);
}

let token;
try {
  const basic = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");
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
    throw new Error(`HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  token = body.access_token;
  record("OAuth access token", true, `expires in ${body.expires_in}s`);
} catch (error) {
  record("OAuth access token", false, error.message);
  process.exit(1);
}

let firstInvoice;
try {
  const response = await fetch(
    `${BASE}/v2/invoicing/invoices?page=1&page_size=10&total_required=true`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(body)}`);
  firstInvoice = body.items?.[0];
  record(
    "Invoice list",
    true,
    `${body.items?.length ?? 0} item(s); total_items=${body.total_items ?? "n/a"}`,
  );
} catch (error) {
  record("Invoice list", false, error.message);
}

if (firstInvoice?.id) {
  try {
    const response = await fetch(
      `${BASE}/v2/invoicing/invoices/${encodeURIComponent(firstInvoice.id)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    record("Invoice detail", true, `${body.id} status=${body.status}`);
  } catch (error) {
    record("Invoice detail", false, error.message);
  }
} else {
  record(
    "Invoice detail",
    false,
    "No sandbox invoices found. Run `npm run paypal:seed` or create one in the dashboard.",
  );
}

try {
  const response = await fetch(`${APP_URL}/api/health`);
  const body = await response.json();
  record(
    "App health endpoint",
    response.ok && body.ok === true,
    `mode=${body.mode} paypal=${body.paypalConfigured} ai=${body.aiConfigured} webhook=${body.webhookConfigured}`,
  );
} catch (error) {
  record("App health endpoint", false, `Start the app with npm run dev (${error.message})`);
}

try {
  const response = await fetch(`${APP_URL}/api/webhooks/paypal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "smoke-invalid", event_type: "INVOICING.INVOICE.PAID" }),
  });
  record(
    "Unauthenticated webhook rejected",
    response.status === 400 || response.status === 503,
    `HTTP ${response.status}`,
  );
} catch (error) {
  record("Unauthenticated webhook rejected", false, error.message);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log("\nManual checks still worth doing:");
  console.log("- Invalid credentials produce a useful error (temporarily change the secret).");
  console.log("- A real webhook delivery is verified and a duplicate event ID is idempotent.");
  process.exit(1);
}
