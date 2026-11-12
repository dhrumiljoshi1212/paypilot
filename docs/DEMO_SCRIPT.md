# PayPilot demo script (under 3 minutes)

Record the actual running app. No prerecorded fake API success.

## Prep (do this before recording)

1. `.env` has `ANTHROPIC_API_KEY` and, if demonstrating real PayPal actions, sandbox credentials + webhook ID.
2. `npm run dev` is running; browser is at `/dashboard`.
3. Run **Settings → Reset demo data** if you are demoing with demo records.
4. If demoing **PayPal Sandbox**: run `npm run smoke`, `npm run paypal:seed`, switch the source to PayPal Sandbox, and have the buyer sandbox account signed in in a second window.
5. Close unrelated tabs. Set the browser zoom so the invoice table and approval card are readable.
6. Have the buyer sandbox email/password ready in case you pay an invoice live.

> The strongest submission shows a real PayPal Sandbox reminder (HTTP 204). If your sandbox account cannot support it, show the real successful operations you do have and say what is demo. Never fake it.

---

## 0:00–0:20 — Problem

Say:

> "Small businesses spend hours chasing unpaid invoices. They need to know who owes them money, what to prioritize, and what to do next — without handing money movement to a robot."

Show the **Overview** dashboard. Point at outstanding, overdue, paid this month, and due-in-7-days. Note the **Sandbox/Demo** pill.

---

## 0:20–0:40 — Product

Say:

> "This is PayPilot, an AI accounts-receivable assistant built on PayPal Invoicing. It reads real sandbox invoices, explains priorities, and prepares reminders that a human must approve."

Open **Invoices**. Hover the table: invoice number, customer, amount, due date, derived overdue days, PayPal status, source.

---

## 0:40–1:10 — Natural-language intelligence

Open **AI Agent**. Type:

> `Find all invoices overdue by at least seven days and prioritize them.`

While it runs, point at the tool activity: "Checking invoices..." → "Calculating overdue priorities..."

When it answers, highlight:

- the invoice count and currency-grouped total
- the priority score explanation, e.g. "Medium priority because this sizeable invoice is 7 days overdue"
- the sentence confirming nothing was sent

If the model asks a clarifying question, answer it naturally.

---

## 1:10–1:40 — Personalized reminder

Type:

> `Draft a friendly reminder for the highest-priority invoice.`

When the approval card appears, read the facts aloud: customer, invoice number, amount, due date, days overdue, **"Nothing has been sent."**

Edit the draft — add a line like "Happy to jump on a quick call if that helps."

Point at the AI rationale and the **Demo / PayPal Sandbox** mode label.

---

## 1:40–2:10 — Human approval and PayPal

Click **Approve & send reminder** (sandbox mode).

Say:

> "The AI cannot execute this. The server requires a separate approval transition, re-checks the invoice with PayPal, and only then calls the reminder endpoint."

Show the real result:

- Sandbox: "PayPal accepted the reminder request. HTTP 204" with request ID.
- Demo: "Demo action recorded — nothing was sent" (say clearly that demo mode cannot call PayPal).

Open **Activity**. Show the approved → executed entries and the PayPal/PayPal-verified label.

---

## 2:10–2:35 — Payment lifecycle

Choose one:

**Real webhook:** open the hosted invoice link, pay as the buyer sandbox account, then show the **Activity** entry "PayPal webhook: INVOICING.INVOICE.PAID" and the invoice flipping to **Paid**.

**Local fixture:** on a demo invoice, click **Simulate payment**. Say plainly:

> "This is a local test fixture, clearly labelled — not a PayPal webhook. The real webhook path is signature-verified and idempotent."

Show the invoice status and timeline update.

---

## 2:35–2:55 — Impact

Say:

> "PayPilot turns receivables management from repetitive administration into an intelligent workflow. It doesn't just tell businesses who owes them money — it helps them collect it, with a human in control of every customer-facing action."

End on the dashboard or activity timeline.

---

## Fallbacks

| Problem while recording | Do this |
| --- | --- |
| AI key missing/invalid | Stop; add a valid key. Do not claim AI features. The manual draft flow is not a substitute for the agent demo. |
| PayPal credentials missing | Record in Demo mode and say "demo invoices, clearly labelled." Show the real code path in Settings. |
| No overdue invoices in sandbox | Show the demo dataset for prioritization; state the limitation. |
| Reminder 422 | Show the real error, explain eligibility/daily limit, and demonstrate a different eligible invoice. |
| Webhook not delivered | Show the local test fixture and explicitly distinguish it. |

## Claims you may make

- Real PayPal OAuth, invoice list/detail, and reminder requests (when credentials are set).
- Real signature verification and idempotent webhook storage (when a webhook is registered).
- Typed AI tool calls and server-enforced approval.
- Clearly-labelled demo/simulation paths.

## Claims you must not make

- That a demo action was sent to PayPal or a customer.
- That a local test event is a real PayPal webhook.
- That PayPal emailed your custom reminder text (it uses its own template).
- That the priority score is machine learning.
- That money movement, refunds, or transfers are implemented.
