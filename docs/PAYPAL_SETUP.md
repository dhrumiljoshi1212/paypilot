# PayPal Sandbox setup for PayPilot

This is the practical, end-to-end checklist for connecting a real PayPal Sandbox account. It takes about 10 minutes plus webhook setup.

Hackathon resources: [PayPal AI Hackathon resources on Devpost](https://paypalaihackathon.devpost.com/resources). Official docs: [REST API](https://developer.paypal.com/api/rest/), [Invoicing v2](https://developer.paypal.com/docs/api/invoicing/v2/), [Webhooks](https://developer.paypal.com/api/rest/webhooks/).

---

## 0. Before you start

- A PayPal account that can sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
- Node.js 22.5+ and this repository running (`npm install && npm run dev`).
- No live credentials. PayPilot refuses a non-sandbox `PAYPAL_BASE_URL` unless `ALLOW_LIVE_PAYPAL=true`.

If your country cannot create a PayPal account, ask the PayPal team in the hackathon Discord — account eligibility is separate from hackathon eligibility.

---

## 1. Confirm you are in Sandbox

1. Sign in at <https://developer.paypal.com/dashboard/>.
2. Top-left environment switcher: choose **Sandbox**, not Live.
3. You should see **Testing Tools → Sandbox Accounts** in the left navigation.

Sandbox is a full copy of PayPal with fake accounts, fake balances, and fake cards. Nothing touches real money.

---

## 2. Get the two sandbox accounts

By default PayPal gives you:

- a **business** account — the merchant / invoicer (PayPilot's account)
- a **personal** account — the buyer / customer

Go to **Testing Tools → Sandbox Accounts**. For the business account:

1. Click **⋯ → View/Edit Account**.
2. Note the email and system-generated password (you can change them).
3. Note the balance — usually $5,000; you can edit it.

Do the same for the personal account. You will use its **email** in `PAYPAL_SANDBOX_BUYER_EMAIL`, and its login to pay a sandbox invoice later.

Keep both accounts in the **same country and currency** to avoid confusing FX behaviour.

---

## 3. Create a Sandbox app and copy credentials

1. Go to **Apps & Credentials** (still Sandbox).
2. Click **Create App**, name it `PayPilot`, choose the business account if asked.
3. Open the app. Copy:
   - **Client ID** — public-ish, identifies the app
   - **Secret** — private, server-only
4. Never paste the secret into browser code, screenshots, chat, or Git.

Put them in `.env`:

```bash
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
PAYPAL_SANDBOX_BUYER_EMAIL=your_personal_sandbox_account@example.com
```

Restart `npm run dev` after changing env values.

### Verify OAuth

```bash
npm run smoke
```

Expected: OAuth ✓, invoice list ✓, app health ✓, unauthenticated webhook rejected ✓. If the sandbox account has no invoices yet, the invoice-detail check is the only expected failure until you seed data.

Or test manually:

```bash
curl -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

A `200` with `access_token` means the credentials are valid.

---

## 4. Create sandbox invoices through the real API

PayPilot does not fake invoice data. Use the seed script:

```bash
npm run paypal:seed
```

It creates three invoices (12 days overdue, 7 days overdue, due tomorrow), sends them to the buyer email, and prints the invoice IDs.

**Important limitation:** PayPal may reject a `due_date` in the past when creating an invoice. The script detects that, says so, and retries with a due date of today. It does not relabel a non-overdue invoice as overdue. If your account rejects backdating, use the demo dataset to show overdue logic, or create invoices earlier and wait.

Then in PayPilot:

1. Open **Settings**.
2. Click **Test connection**.
3. Under **Data source**, choose **PayPal Sandbox**.
4. Open **Invoices** and click **Refresh**.

You should see real `INV2-...` IDs with the **PayPal Sandbox** source badge.

---

## 5. Webhooks (payment lifecycle)

PayPal requires a public HTTPS URL. For local development use a tunnel:

```bash
ngrok http 3000
# or: cloudflared tunnel --url http://localhost:3000
```

Your listener URL is:

```text
https://<your-public-host>/api/webhooks/paypal
```

In the Developer Dashboard:

1. Open your sandbox app → **Webhooks** (or **Add Webhook**).
2. Paste the listener URL.
3. Subscribe to the invoice events:
   - `INVOICING.INVOICE.PAID`
   - `INVOICING.INVOICE.SENT`
   - `INVOICING.INVOICE.CANCELLED`
   - `INVOICING.INVOICE.REFUNDED`
   - `INVOICING.INVOICE.CREATED`
   - optionally `INVOICING.INVOICE.UPDATED`

   **Sandbox reliability note:** in this build, individual invoicing event selections did not deliver; switching the same webhook to the wildcard `*` subscription made `CREATED`, `UNPAID`, and `PAID` events arrive and verify correctly. If a specific-event subscription stays silent, replace it with `*` and retry. Check deliveries with `GET /v1/notifications/webhooks-events`.
4. Save and copy the **Webhook ID** (not the URL).
5. Add it to `.env`:

```bash
APP_URL=https://<your-public-host>
PAYPAL_WEBHOOK_ID=your_webhook_id
```

6. Restart the app.

Or register the webhook from the terminal with the app's sandbox credentials:

```bash
npm run webhook:register -- https://your-public-host
# copy the printed ID into PAYPAL_WEBHOOK_ID, then restart
```

### Verify a real delivery

1. Open an invoice in PayPilot and click **Open PayPal invoice page**.
2. Sign in with the **personal sandbox account** and pay the invoice using the sandbox balance.
3. PayPal sends `INVOICING.INVOICE.PAID` to your endpoint.
4. PayPilot verifies the signature with `/v1/notifications/verify-webhook-signature`, stores the event ID, re-fetches the invoice from PayPal, marks it paid, and writes a **PayPal verified** entry to Activity.

You can also trigger events from the dashboard's webhook simulator. If a delivery arrives without PayPal's transmission headers or fails signature verification, PayPilot rejects it by design — that is not a bug.

### Diagnose delivery

List the app's generated events (not just deliveries) with:

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events?page_size=20"
```

If `count` is 0, PayPal never generated the event (check app/credentials). If events exist but your Activity page is empty, check the tunnel, the webhook URL, and signature verification errors.

### Idempotency

The `paypal_event_id` column is unique. A retried delivery returns `200 { "status": "duplicate" }` without processing twice. The Vitest suite covers this.

### No public URL? Demo the lifecycle locally

On a **demo** invoice, open the invoice drawer and click **Simulate payment**. PayPilot records a `LOCAL_TEST` event and marks the invoice paid. The UI and timeline label it **"Local test — not PayPal"** so it can never be mistaken for a real webhook.

---

## 6. Execute a real reminder

1. Switch the data source to PayPal Sandbox.
2. Open a sent/unpaid invoice (from the seed script or the dashboard).
3. Click **Draft reminder**.
4. Edit the message.
5. Click **Approve & send reminder**.

Server flow: `PENDING_APPROVAL → APPROVED → PayPal remind → EXECUTED`. Success appears only after PayPal returns `204`.

PayPal limits reminders to **2 per invoice per day**, and its API currently ignores custom subject/note text. PayPilot surfaces both facts in the UI and keeps your draft as the audit record. It never claims the custom text was emailed.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `PAYPAL_AUTH_ERROR` / 401 | Wrong client ID or secret, or live credentials in sandbox | Re-copy from the Sandbox app; restart |
| `403` on invoicing | App lacks Invoicing permission/account is not a business account | Use the business sandbox account; confirm Invoicing is enabled |
| Empty invoice list | Sandbox account has no invoices | `npm run paypal:seed`, then Refresh |
| Seed fails on `due_date` | PayPal rejects backdated due dates | Script falls back to today; demo mode covers overdue showcase |
| `422` on remind | Invoice paid/cancelled/draft, or 2-reminder daily limit | UI shows PayPal's reason; create a new draft only when eligible |
| Webhook `503 WEBHOOK_NOT_CONFIGURED` | Missing `PAYPAL_WEBHOOK_ID` | Register the webhook and set the ID |
| Webhook `400 WEBHOOK_VERIFICATION_FAILED` | Missing headers, wrong webhook ID, or URL changed | Recheck the registered URL/ID; PayPal retries for 3 days |
| Reminder "succeeds" but email text differs | PayPal uses its own system reminder template | Expected; PayPilot documents this |
| Agent says not configured | No `ANTHROPIC_API_KEY` | Add key, restart; manual drafts still work |

---

## Safety rules

- Sandbox only. Do not set `ALLOW_LIVE_PAYPAL=true` for the hackathon demo.
- Keep `.env` out of Git.
- Do not screenshot the client secret or the `.env` file.
- No transfers, refunds, or payouts are implemented.
- Every customer-facing send goes through the human approval state machine.
