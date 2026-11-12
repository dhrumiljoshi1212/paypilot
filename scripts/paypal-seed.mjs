#!/usr/bin/env node
/**
 * Creates real Sandbox invoices through the PayPal Invoicing API so PayPilot has
 * live data to work with. This is optional: Demo mode works without it.
 *
 * Usage:
 *   npm run paypal:seed
 *
 * Requires: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX_BUYER_EMAIL
 * (a sandbox personal account email from Testing Tools -> Sandbox Accounts).
 */
const BASE = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;
const BUYER = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;

if (!BASE.includes("sandbox")) {
  console.error("Refusing to run: PAYPAL_BASE_URL is not a sandbox URL.");
  process.exit(1);
}
if (!CLIENT_ID || !SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env.local");
  process.exit(1);
}
if (!BUYER) {
  console.error("Missing PAYPAL_SANDBOX_BUYER_EMAIL (a sandbox personal account email).");
  process.exit(1);
}

const DAY = 86_400_000;
const isoDate = (offsetDays) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function token() {
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
  if (!response.ok) {
    throw new Error(`OAuth failed: HTTP ${response.status} ${await response.text()}`);
  }
  return (await response.json()).access_token;
}

async function invoiceRequest(accessToken, path, method, body, requestId) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

function invoiceBody({ number, amount, dueDate, invoiceDate }) {
  return {
    detail: {
      currency_code: "USD",
      invoice_number: number,
      invoice_date: invoiceDate,
      payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: dueDate },
      note: "Created by PayPilot's sandbox seeding script.",
    },
    invoicer: {
      name: { given_name: "PayPilot", surname: "Demo" },
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: BUYER,
          name: { given_name: "Sandbox", surname: "Buyer" },
        },
      },
    ],
    items: [
      {
        name: "Design retainer",
        description: "Sandbox test invoice for the PayPilot demo.",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: amount.toFixed(2) },
      },
    ],
  };
}

function extractInvoiceId(json, response) {
  if (json.id) return json.id;
  if (json.href) return json.href.split("/").pop();
  const location = response.headers.get("location");
  if (location) return location.split("/").pop();
  return undefined;
}

const plans = [
  { number: `PILOT-${Date.now()}-A`, amount: 1200, dueOffset: -12, invoiceOffset: -42, label: "12 days overdue" },
  { number: `PILOT-${Date.now()}-B`, amount: 850, dueOffset: -7, invoiceOffset: -37, label: "7 days overdue" },
  { number: `PILOT-${Date.now()}-C`, amount: 2000, dueOffset: 1, invoiceOffset: -14, label: "due tomorrow" },
];

const accessToken = await token();
console.log("OAuth token acquired. Creating sandbox invoices...\n");

let successes = 0;

for (const plan of plans) {
  const payload = invoiceBody({
    number: plan.number,
    amount: plan.amount,
    dueDate: isoDate(plan.dueOffset),
    invoiceDate: isoDate(plan.invoiceOffset),
  });

  let created = await invoiceRequest(
    accessToken,
    "/v2/invoicing/invoices",
    "POST",
    payload,
    `paypilot-seed-${plan.number}`,
  );

  // PayPal may reject a past due date on new invoices. Fall back to a due date
  // of today and tell the operator rather than pretending it is overdue.
  if (!created.response.ok) {
    const message = JSON.stringify(created.json);
    if (/due_date|date/i.test(message)) {
      console.warn(
        `PayPal rejected a past due date for ${plan.label}; retrying with due date today.`,
      );
      payload.detail.payment_term.due_date = isoDate(0);
      payload.detail.invoice_date = isoDate(-1);
      created = await invoiceRequest(
        accessToken,
        "/v2/invoicing/invoices",
        "POST",
        payload,
        `paypilot-seed-${plan.number}-retry`,
      );
    }
  }

  if (!created.response.ok) {
    console.error(
      `✗ ${plan.label}: HTTP ${created.response.status} ${JSON.stringify(created.json)}`,
    );
    continue;
  }

  const id = extractInvoiceId(created.json, created.response);
  if (!id) {
    console.error(`✗ ${plan.label}: created but could not read an invoice ID.`);
    continue;
  }

  const sent = await invoiceRequest(
    accessToken,
    `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`,
    "POST",
    { send_to_recipient: true, send_to_invoicer: false },
    `paypilot-send-${id}`,
  );

  if (!sent.response.ok) {
    console.error(
      `✗ ${plan.label}: invoice ${id} created but send failed (HTTP ${sent.response.status}).`,
    );
    continue;
  }

  successes += 1;
  console.log(`✓ ${plan.label}: ${id} created and sent to ${BUYER}`);
}

console.log(
  `\nDone. ${successes}/${plans.length} sandbox invoices created. Refresh the Invoices screen and switch the data source to PayPal Sandbox.`,
);
console.log(
  "Note: if PayPal refused a backdated due date, those invoices will not be overdue yet. PayPilot does not fake overdue status.",
);
