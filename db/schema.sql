-- PayPilot persistence schema (SQLite)
-- The application applies this schema automatically on first use (lib/db.ts).
-- This file is provided for reference and for manual inspection.

CREATE TABLE IF NOT EXISTS invoices_cache (
  id TEXT PRIMARY KEY,
  number TEXT,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_amount REAL NOT NULL,
  due_date TEXT,
  invoice_date TEXT,
  customer_name TEXT,
  customer_email TEXT,
  hosted_invoice_url TEXT,
  paypal_status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'PAYPAL',
  last_synced_at TEXT NOT NULL,
  raw_payload TEXT
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  draft_subject TEXT NOT NULL,
  draft_message TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  executed_at TEXT,
  paypal_response TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'SANDBOX',
  execution_error TEXT,
  invoice_snapshot TEXT,
  origin TEXT NOT NULL DEFAULT 'AI'
);

CREATE INDEX IF NOT EXISTS idx_actions_status ON agent_actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_invoice ON agent_actions(invoice_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  paypal_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_status TEXT NOT NULL,
  payload TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'PAYPAL',
  error TEXT
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  invoice_id TEXT,
  action_id TEXT,
  source TEXT NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_events(at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
