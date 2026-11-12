# PayPilot deployment record

Last updated: **2026-11-12**
Environment: **PayPal Sandbox only** (live payments are blocked by the app unless `ALLOW_LIVE_PAYPAL=true`).

This file records deployment state and operating details. **It contains no secrets.** Credentials live in `.env`, which is gitignored.

---

## 1. Current state

| Item | Value |
| --- | --- |
| Hosted app | https://paypilot-ff6847.azurewebsites.net (Azure App Service, Linux B1, Central India, RG `paypilot-rg`) |
| Local app | http://localhost:3000 |
| Data source | PayPal Sandbox (`data_source=PAYPAL` in SQLite) |
| PayPal API | `https://api-m.sandbox.paypal.com` |
| AI model | `claude-sonnet-5-5` (Anthropic Messages API, tool use) |
| Database | `data/paypilot.db` (SQLite, WAL) |
| Auth | None — single-operator demo; put behind SSO before public sharing |
| Tunnel | **Stopped** (Cloudflare quick tunnel, temporary) |
| Webhook | **Deleted** after the tunnel was stopped |
| Tests | 26 passing (`npm test`) |
| Smoke test | 5/5 passed on 2026-11-12 (`npm run smoke`) |

The app remains runnable locally in sandbox mode. Without a public HTTPS URL, webhook configuration is intentionally blank (`PAYPAL_WEBHOOK_ID=`), so the settings screen shows "Not configured". Invoice reads, AI tools, approvals, and real reminder execution still work.

---

## 2. Credentials and configuration

All runtime secrets are in **`.env`** at the repository root. It is ignored by Git via `.env*` (`.env.example` is the only committed template — placeholders only).

| Variable | Value / purpose |
| --- | --- |
| `APP_URL` | `http://localhost:3000` locally; set to the public origin when deployed |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` |
| `PAYPAL_CLIENT_ID` | Sandbox app client ID (in `.env`) |
| `PAYPAL_CLIENT_SECRET` | Sandbox app secret (in `.env`) |
| `PAYPAL_WEBHOOK_ID` | Empty after tunnel shutdown; set after re-registering |
| `PAYPAL_SANDBOX_BUYER_EMAIL` | Sandbox personal/buyer email (in `.env`) |
| `ANTHROPIC_API_KEY` | Claude key (in `.env`) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` |
| `DATABASE_PATH` | `data/paypilot.db` |
| `DEMO_MODE` | `false` (start in sandbox mode) |
| `ALLOW_LIVE_PAYPAL` | `false` |

Never commit `.env`, `.env.local`, the SQLite database, or screenshots containing secrets.

### Key rotation

The PayPal secret and Anthropic key were shared in chat during setup. Rotate both in the PayPal Developer Dashboard and Anthropic Console once the demo recording is complete, then update `.env` and restart. Rotating invalidates the current sandbox app secret but does not delete the app or its invoices.

---

## 3. Sandbox resources created

### Invoices

All are real PayPal Sandbox invoices created through the Invoicing API. Prefix `PILOT-` marks test data.

| Invoice number | PayPal ID | Amount | Due | Status |
| --- | --- | --- | --- | --- |
| `PILOT-1794474025465-A` | `INV2-738K-4R6U-V8UW-R3GL` | $1,200.00 | 2026-10-31 | SENT (12 days overdue) |
| `PILOT-1794474025465-B` | `INV2-AADH-WA7R-K34F-ZETR` | $850.00 | 2026-11-05 | SENT (7 days overdue) |
| `PILOT-1794474060305-C` | `INV2-5M2P-HLUK-BB6L-JZS8` | $2,000.00 | 2026-11-13 | SENT (due soon) |
| `PILOT-WH3-1794474879825` | `INV2-6QQ4-4H9H-7MWA-JMK4` | $75.00 | 2026-11-15 | PAID (webhook test) |
| `PILOT-PAID-1794474796690` | `INV2-WE4D-45ES-L4JJ-8CV3` | $50.00 | 2026-11-19 | PAID (lifecycle test) |
| `PILOT-WH2-1794474264850` | `INV2-738B-8R2T-3U89-PJ7A` | $100.00 | 2026-12-12 | CANCELLED (test) |
| `PILOT-WH-1794474213873` | `INV2-X4PZ-ABZ8-2X8E-33LG` | $300.00 | 2026-12-12 | CANCELLED (test) |

The app cache reflects this list after a full refresh. The three open invoices drive the dashboard metrics.

### Executed reminder

- Action ID: `5ccfe312-f619-410b-9055-0c9761d0f2a9`
- Invoice: `INV2-738K-4R6U-V8UW-R3GL`
- Approval: explicit human approval
- PayPal result: **HTTP 204** from `POST /v2/invoicing/invoices/{id}/remind`
- Outcome: `EXECUTED`; PayPal sent its own system reminder email to the sandbox buyer (custom note text is ignored by PayPal and retained in PayPilot)

### Webhook history

A temporary Cloudflare tunnel was used:

- Tunnel host (now stopped): `weblog-monkey-glow-maiden.trycloudflare.com`
- Webhook ID (deleted): `80M90247DT842251D`
- Subscription: wildcard `*` — individual invoicing subscriptions did not deliver in this sandbox
- Verified deliveries included:
  - `INVOICING.INVOICE.CREATED` — `INV2-6QQ4-4H9H-7MWA-JMK4`
  - `INVOICING.INVOICE.PAID` — `INV2-6QQ4-4H9H-7MWA-JMK4`
  - `INVOICING.INVOICE.CANCELLED` — `INV2-X4PZ-ABZ8-2X8E-33LG`

Full evidence: [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## 4. Re-enabling webhooks later

When you have a public HTTPS origin (a permanent deployment is preferable to a quick tunnel):

```bash
# 1. Start a tunnel for local testing (URL changes each run)
cloudflared tunnel --url http://localhost:3000

# 2. Register the webhook with the app's sandbox credentials; prints the webhook ID
npm run webhook:register -- https://your-public-host

# 3. Put the printed ID in .env
#    PAYPAL_WEBHOOK_ID=<id>
#    APP_URL=https://your-public-host

# 4. Restart the app
```

Useful helper commands:

```bash
npm run webhook:list
npm run webhook:events
npm run webhook:update -- <webhookId> https://new-host
npm run webhook:delete -- <webhookId>
```

The helper uses the wildcard subscription because that is what delivered reliably in this sandbox. PayPilot ignores non-invoice events safely.

---

## 5. Hosted deployment

SQLite requires a persistent filesystem, so Vercel's ephemeral filesystem is not suitable.

### Azure App Service (current)

`scripts/deploy-azure.sh [app-name] [resource-group] [location]` creates the plan and web app, copies secrets from `.env` into App Settings, and zip-deploys the committed `HEAD` (Oryx builds on Linux). Redeploy code only:

```bash
git archive --format=zip -o /tmp/paypilot.zip HEAD
az webapp deployment source config-zip -g paypilot-rg -n paypilot-ff6847 --src /tmp/paypilot.zip --timeout 1500
```

- Database: `/home/data/paypilot.db` (persistent `/home` share) with `SQLITE_JOURNAL_MODE=DELETE` (WAL is unreliable on that network share).
- Do not set `NODE_ENV` as an App Setting; `.npmrc` (`include=dev`) keeps build-time devDependencies installed.
- The first start after a deploy can exceed Azure's 10-minute wait while `node_modules` is unpacked; check `/api/health` before treating it as failed.

### Other hosts

Any single-instance Render/Railway/Fly service with a persistent disk also works.

| Setting | Value |
| --- | --- |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Node version | `>=22.5` |
| Disk mount | `/var/data` |
| `DATABASE_PATH` | `/var/data/paypilot.db` |
| `APP_URL` | public HTTPS origin |
| Health check | `/api/health` |

Then register the production webhook:

```bash
npm run webhook:register -- https://your-production-host
```

Set `PAYPAL_WEBHOOK_ID` and redeploy/restart. Add authentication (SSO/basic auth) before sharing the URL beyond judges — this MVP has no auth layer.

---

## 6. Operating commands

```bash
npm run dev             # local development
npm run build && npm start
npm test                # 26 tests
npm run typecheck
npm run lint
npm run smoke           # live PayPal + app checks
npm run seed            # seed demo invoices into SQLite
npm run paypal:seed     # create real sandbox invoices (needs buyer email)
npm run webhook:list
npm run webhook:events
```

Demo reset: **Settings → Reset demo data** (only affects demo records; PayPal data untouched).

---

## 7. Known limitations

- No authentication; intended for a single operator demo.
- SQLite and the in-memory OAuth token cache assume one app instance.
- PayPal may reject backdated due dates; the seed script reports this instead of faking overdue status.
- PayPal ignores custom reminder subject/note text and limits reminders to two per invoice per day.
- Cloudflare quick tunnels are temporary and have no uptime guarantee.
- Sandbox `PILOT-` invoices are test artifacts and remain in the sandbox account; PayPal does not allow deleting sent invoices.
- AI output is a draft and is always subject to server-enforced human approval.
