# PayPilot

**Stop chasing payments. Let AI handle your receivables.**

PayPilot is an AI accounts-receivable workspace built on PayPal Invoicing. A small-business owner can ask an agent to find overdue invoices, see an explainable priority ranking, review a personalized reminder, approve it, and execute it through the PayPal Sandbox — with every step recorded in an audit trail and payment updates arriving through verified webhooks.

Built for the PayPal AI Hackathon. Sandbox only. No real money moves through this app.

---

## The 60-second story

1. **Overview** shows outstanding, overdue, paid-this-month, and due-in-7-days totals straight from the invoice records.
2. **Invoices** lists PayPal Sandbox or clearly-labelled demo invoices with derived overdue status.
3. **AI Agent** answers questions by calling typed tools — it sees invoice facts, not a prompt stuffed with guesses.
4. **A draft reminder** is stored as `PENDING_APPROVAL`. Nothing is sent.
5. **You edit and approve it.** Only then does the server call PayPal's reminder endpoint.
6. **A PayPal webhook** (signature-verified, idempotent) refreshes the invoice and writes to the activity timeline.

The AI has no execution tool. Approval is enforced server-side, not by hiding a button.

---

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16 App Router + React 19 + TypeScript |
| Styling | Tailwind CSS v4 (hand-built component system, no UI kit runtime) |
| Server | Next.js route handlers (Node runtime) |
| Database | SQLite via `better-sqlite3`, schema auto-applied |
| AI | Anthropic Claude Messages API with tool use |
| Payments | PayPal Invoicing REST API v2, Sandbox |
| Validation | Zod |
| Tests | Vitest |

> Node.js **22.5+** is required. SQLite is a deliberate single-instance hackathon choice; the data layer is isolated in `lib/services` so it can be swapped for Postgres later.

---

## Quick start (demo data, no credentials)

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app starts in **Demo data** mode when PayPal credentials are absent, seeds five fictional invoices, and labels every one of them. You can exercise the full flow — analysis, draft, edit, approval, execution — without external services.

Add an Anthropic key to enable the agent:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5-5
```

Restart `npm run dev`. Without a key, the invoice workspace and manual reminder drafts still work; the agent explains that it is not configured.

---

## Connect PayPal Sandbox

Full walkthrough: **[docs/PAYPAL_SETUP.md](docs/PAYPAL_SETUP.md)**.

Short version:

1. Sign in at [developer.paypal.com/dashboard](https://developer.paypal.com/dashboard/) and confirm the toggle is **Sandbox**.
2. **Apps & Credentials → Create App**. Copy the Client ID and Secret.
3. Put them in `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
4. Copy a **personal sandbox account email** into `PAYPAL_SANDBOX_BUYER_EMAIL`.
5. Run `npm run smoke` to verify OAuth and invoice listing.
6. Run `npm run paypal:seed` to create real sandbox invoices through the API.
7. Restart, open **Settings**, test the connection, and switch the data source to **PayPal Sandbox**.
8. For webhooks, expose the app over HTTPS (`ngrok http 3000`), register `https://<host>/api/webhooks/paypal`, subscribe to the invoice events, and set `PAYPAL_WEBHOOK_ID`.

> PayPal may reject backdated due dates on newly created invoices. If that happens, the seed script says so and falls back to a due date of today instead of faking "overdue". PayPilot never invents status.

### PayPal APIs used

| Purpose | Endpoint |
| --- | --- |
| OAuth client credentials (server-side, cached) | `POST /v1/oauth2/token` |
| List invoices | `GET /v2/invoicing/invoices` |
| Invoice detail | `GET /v2/invoicing/invoices/{invoice_id}` |
| Send reminder (after approval) | `POST /v2/invoicing/invoices/{invoice_id}/remind` |
| Webhook signature verification | `POST /v1/notifications/verify-webhook-signature` |

Webhook events handled: `INVOICING.INVOICE.PAID`, `SENT`, `CANCELLED`, `REFUNDED` (plus `UPDATED`/`CREATED` refresh paths). On a verified event PayPilot re-fetches the invoice from PayPal instead of trusting the event snapshot.

> Sandbox note from this build: individual invoicing event subscriptions did not deliver until the webhook was switched to the wildcard `*` subscription. The app handles the extra invoice events correctly; see the troubleshooting section in `docs/PAYPAL_SETUP.md`.

**PayPal limitation, stated honestly:** the reminder endpoint currently ignores caller-supplied `subject` and `note` and sends PayPal's own system email. PayPilot still stores and displays the personalized draft as the approval record, and the UI says so after execution.

---

## What is real, what is demo

| Capability | Demo mode | PayPal Sandbox mode |
| --- | --- | --- |
| Invoice data | 5 fictional USD invoices, labelled **Demo** everywhere | Live reads from the sandbox account |
| AI tool analysis | Real tools over demo records | Real tools over sandbox records |
| Reminder draft + approval | Real local workflow | Real local workflow |
| Execution | Records a labelled demo action; **no PayPal call** | `POST .../remind`; success only after HTTP 204 |
| Payment lifecycle | **Simulate payment** creates a labelled `LOCAL_TEST` event | Verified PayPal webhook with signature check |
| Secrets | None | Server-only; never returned by an API |

Demo actions are textually explicit: "Demo action recorded — nothing was sent." A local test event is never called a PayPal webhook.

---

## Architecture

```text
Browser
  │  (no secrets, no PayPal SDK)
  ▼
Next.js server
  ├── /api/agent ──────────► AI agent loop (max 5 rounds, Zod-validated tools)
  │                             ├── read tools ──► invoice-service ──► SQLite
  │                             └── draft tool ──► action-service (PENDING_APPROVAL)
  ├── /api/actions/:id/{approve,cancel,execute}
  │                             └── execute ──► eligibility recheck ──► PayPal remind
  ├── /api/paypal/* ─────────► PayPal OAuth + Invoicing client (token cache, timeouts)
  ├── /api/webhooks/paypal ──► verify signature ──► dedupe event ID ──► refresh invoice
  └── pages ─────────────────► server-rendered from SQLite
```

Key directories:

- `lib/paypal/` — OAuth, typed client, invoice normalization, webhook verification.
- `lib/services/` — deterministic business logic, invoice cache, action state machine, webhooks.
- `lib/ai/` — system prompt, typed tools, bounded agent loop.
- `app/api/` — route handlers with consistent error envelopes.
- `components/` — app shell, invoices table/drawer, approval card, agent chat, timeline.
- `db/schema.sql` — reference schema (applied automatically at runtime).

---

## The agent

The model can call only these server-side tools:

| Tool | Type | Purpose |
| --- | --- | --- |
| `get_invoice_summary` | read | Filter invoices by open/overdue/status, amount, overdue days, due window |
| `get_invoice_details` | read | One invoice with eligibility facts |
| `analyze_overdue_invoices` | read | Explainable priority scores and currency-safe totals |
| `calculate_cashflow_summary` | read | Outstanding, overdue, paid-this-month, due-in-horizon by currency |
| `draft_payment_reminder` | write (draft only) | Validate eligibility, store `PENDING_APPROVAL`, return action ID |

There is deliberately **no** `execute_reminder` tool. The agent cannot reach the PayPal client.

Priority is a transparent heuristic, not an ML claim:

```text
score = amount (0–40) + days overdue (0–35) + urgency (0–15) + data confidence (0–10)
```

Every score ships with a sentence explaining it. Amounts are never summed across currencies.

### Example prompts

- "Show invoices overdue by 7 days."
- "Who owes me the most?"
- "Draft reminders for overdue invoices."
- "Summarize my cash flow for the next 7 days."

If the model is unavailable, the API returns a clear `AI_NOT_CONFIGURED` / `AI_ERROR` message and preserves the user's message in the UI. Manual drafts remain available from the invoice drawer.

---

## Human approval state machine

```text
PENDING_APPROVAL ── approve ──► APPROVED ── PayPal 204 ──► EXECUTED
       │                           │
       └──── cancel ──► CANCELLED  └──── PayPal error ──► FAILED (terminal)
```

- Approval and execution are separate server endpoints. The one-click UI calls both sequentially; the backend still enforces each transition.
- `FAILED` cannot be retried. Create a new draft after fixing the problem.
- Execution uses the action's UUID as `PayPal-Request-Id` and an in-process lock, so a duplicate click does not double-send.
- Execution always re-fetches the invoice from PayPal and re-checks eligibility before sending.
- Success is shown only after the actual PayPal response.

---

## API routes

| Route | Method | Notes |
| --- | --- | --- |
| `/api/health` | GET | Config flags + mode; no secrets |
| `/api/paypal/connect` | POST | OAuth proof; stores last check |
| `/api/paypal/invoices` | GET / POST | Read cache / refresh from current source |
| `/api/paypal/invoices/[id]` | GET | Detail; `?refresh=1` re-reads PayPal |
| `/api/paypal/invoices/[id]/remind` | POST | Alias requiring an approved `actionId` |
| `/api/actions` | GET / POST | List / manual draft |
| `/api/actions/[id]` | GET | Current action state |
| `/api/actions/[id]/approve` | POST | `PENDING_APPROVAL → APPROVED` with edits |
| `/api/actions/[id]/cancel` | POST | Cancel pending/approved |
| `/api/actions/[id]/execute` | POST | `APPROVED → EXECUTED/FAILED` |
| `/api/agent` | POST | Stateless agent turn with optional history |
| `/api/activity` | GET | Audit timeline |
| `/api/settings` | GET / PATCH | Source switch, demo reset |
| `/api/webhooks/paypal` | POST | Signature verification + idempotent processing |
| `/api/demo/simulate-payment` | POST / DELETE | Demo-only local test event / reset |

Errors use:

```json
{ "error": { "code": "PAYPAL_API_ERROR", "message": "...", "requestId": "..." } }
```

Stack traces, tokens, and secret-bearing provider responses are never returned.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | For sandbox | Server-side OAuth |
| `PAYPAL_BASE_URL` | No | Defaults to `https://api-m.sandbox.paypal.com`; non-sandbox URLs are refused unless `ALLOW_LIVE_PAYPAL=true` |
| `PAYPAL_WEBHOOK_ID` | For webhooks | Required for signature verification |
| `PAYPAL_SANDBOX_BUYER_EMAIL` | Seed script | Sandbox personal account email |
| `ANTHROPIC_API_KEY` | For AI | Server-only |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-5-5` |
| `DATABASE_PATH` | No | Defaults to `data/paypilot.db` |
| `DEMO_MODE` | No | Start in demo; defaults to on only when PayPal is unconfigured |
| `APP_URL` | For webhooks | Used to print the listener URL |
| `MAX_AGENT_ROUNDS` | No | Defaults to 5, capped at 10 |

Never commit `.env`. `.env.example` contains placeholders only.

---

## Deploying

Current environment state, sandbox resource IDs, tunnel/webhook lifecycle, and hosting settings are recorded in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

Vercel's ephemeral filesystem is not suitable for SQLite. Use a single-instance host with a persistent disk (for example Render, Railway, or Fly.io):

- Build: `npm ci && npm run build`
- Start: `npm start`
- Persistent disk mounted at `/var/data`; set `DATABASE_PATH=/var/data/paypilot.db`
- Set `APP_URL` to the public HTTPS origin
- Set `ANTHROPIC_API_KEY`, PayPal sandbox credentials, and `PAYPAL_WEBHOOK_ID`
- Register `https://<origin>/api/webhooks/paypal` with `npm run webhook:register -- https://<origin>` (or the PayPal dashboard)

There is no authentication layer. Put the deployment behind SSO/basic auth before sharing it beyond the judges, and never enable live PayPal credentials.

## Testing

```bash
npm test          # 26 unit/integration tests
npm run typecheck
npm run lint
npm run build
npm run smoke     # live PayPal + app checks (needs credentials and a running app)
```

Covered: status normalization, UTC overdue math, currency-safe aggregation, priority scoring, reminder eligibility, action state transitions, draft/approve/execute (demo), duplicate execution, tool-argument validation, unknown tool rejection, webhook idempotency, and duplicate event IDs.

Not automated: a live PayPal reminder (requires an eligible sandbox invoice) and a real webhook delivery (requires a public HTTPS URL). Both have documented manual steps in `docs/PAYPAL_SETUP.md`; the live sandbox run is recorded in `docs/VERIFICATION.md`.

---

## Demo script

A full three-minute script, prep checklist, and fallback plan live in **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)**. Live verification evidence is in **[docs/VERIFICATION.md](docs/VERIFICATION.md)**; current environment/deployment state is in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## Security and scope

- PayPal secrets, AI keys, and access tokens are server-only. Nothing is exposed with `NEXT_PUBLIC_`.
- The API base URL is forced to sandbox unless explicitly overridden.
- Webhook signatures are mandatory; unverified events are rejected, never "best effort" processed.
- Webhook event IDs are unique; retries acknowledge duplicates without double-processing.
- Invoice IDs are validated and scoped to cached/connected records.
- Logs redact bearer tokens and truncate provider errors.
- **No authentication in this MVP.** It is a single-operator demo; deploy behind auth/SSO before exposing it.
- No transfers, refunds, payouts, chargebacks, or autonomous sends.
- AI output is treated as a draft; the approval screen always shows the grounding facts.

### Known limitations

- SQLite + in-memory token cache assume one instance.
- PayPal may refuse backdated due dates; seeded sandbox invoices may not be overdue immediately.
- PayPal reminders are limited to 2 per invoice per day; a 422/429 is surfaced verbatim.
- PayPal ignores custom reminder subject/note text.
- No invoice creation UI (the seed script creates sandbox invoices through the API).
- `paid this month` uses PayPal's `invoice_date` because the list API does not expose a reliable payment timestamp; the UI states this.

---

## Repository layout

```text
app/                  pages + API route handlers
components/           app shell, invoices, approval, agent, activity, settings
lib/ai/               system prompt, typed tools, agent loop
lib/paypal/           OAuth, client, invoices, webhooks, types
lib/services/         collection logic, invoice cache, actions, webhooks
lib/utils/            dates, currency, errors, cn
db/schema.sql         reference schema
scripts/              demo seed, PayPal seed, smoke test
tests/                Vitest suites
docs/                 PayPal setup + demo script
```

---

## License

[MIT](LICENSE). PayPilot is an independent hackathon project and is not affiliated with or endorsed by PayPal.
