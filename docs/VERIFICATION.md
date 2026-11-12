# Sandbox verification log

Recorded on 2026-11-12 against `https://api-m.sandbox.paypal.com` with the project's sandbox app. No secrets are included here.

**Post-verification state:** the temporary Cloudflare tunnel was stopped and the temporary webhook was deleted. Current operating state and re-enable steps are in [`DEPLOYMENT.md`](../DEPLOYMENT.md).

## Connection

- OAuth client-credentials token issued successfully; cache TTL honoured.
- `GET /v2/invoicing/invoices` returned **7** sandbox invoices (sent, paid, and cancelled states).
- `npm run smoke` passed **5/5** checks: OAuth, invoice list, invoice detail, app health, unauthenticated webhook rejection.

## AI agent (live Claude call)

Prompt: *"Find all invoices overdue by at least seven days and prioritize them."*

- Tools called: `get_invoice_summary`, `analyze_overdue_invoices`.
- Result: 2 overdue invoices, $2,050.00 total, with per-invoice scores (79 and 60) and explanations.
- The response explicitly labelled the data as PayPal Sandbox.

Prompt: *"Draft a friendly reminder for the highest-priority overdue invoice."*

- Tool called: `draft_payment_reminder`.
- Created action `PENDING_APPROVAL` for invoice `INV2-738K-4R6U-V8UW-R3GL` ($1,200, 12 days overdue).
- No PayPal call was made by the agent.
- The approval card showed "Nothing has been sent."

## Real PayPal reminder

After explicit approval:

1. `POST /api/actions/:id/approve` → `APPROVED`
2. `POST /api/actions/:id/execute` → PayPal `POST /v2/invoicing/invoices/{id}/remind` → **HTTP 204**
3. Action stored as `EXECUTED` with PayPal's response.
4. Activity recorded: "PayPal reminder sent for invoice PILOT-1794474025465-A".

PayPal sends its own system reminder email and ignores custom subject/note text; the personalized draft remains in PayPilot as the approval record.

## Webhooks

Webhook registered through the Webhooks API against a Cloudflare quick tunnel, with a wildcard `*` subscription (individual invoicing subscriptions did not deliver in this sandbox; wildcard did).

Verified and processed deliveries:

| Event | Resource | Status |
| --- | --- | --- |
| `INVOICING.INVOICE.CREATED` | `INV2-6QQ4-4H9H-7MWA-JMK4` | PROCESSED |
| `INVOICING.INVOICE.PAID` | `INV2-6QQ4-4H9H-7MWA-JMK4` | PROCESSED |
| `INVOICING.INVOICE.UNPAID` | nested invoice resource | PROCESSED |
| `INVOICING.INVOICE.CANCELLED` | `INV2-X4PZ-ABZ8-2X8E-33LG` | PROCESSED |

Observed effects:

- Signature verification returned success via `/v1/notifications/verify-webhook-signature`.
- Event IDs stored uniquely; duplicate acknowledgement covered by tests.
- The paid invoice was re-fetched from PayPal and changed to `PAID` / `MARKED_AS_PAID` in the local cache.
- Activity shows **PayPal verified** entries linked to the invoice.
- A request with no transmission headers is rejected with HTTP 400.

### Bug found and fixed during live verification

PayPal Invoicing events nest the resource as `resource.invoice.id`. The first implementation only read `resource.id`, so verified events were stored but no invoice was updated. `eventResourceId()` now reads the nested invoice ID, with fallbacks for other event families. A test covers this shape.

## Notes

- Sandbox test invoices used for the lifecycle checks are visibly labelled with `PILOT-` numbers. Real production invoices would have normal numbering.
- The demo dataset remains available in Settings → Demo data and is always labelled as fictional.
