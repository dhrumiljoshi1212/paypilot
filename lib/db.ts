import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ActivityEvent, ActivityKind } from "@/lib/types";

const SCHEMA = `
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
`;

let instance: Database.Database | null = null;

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim() || "data/paypilot.db";
  if (configured === ":memory:") return configured;
  return path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function getDb(): Database.Database {
  if (instance) return instance;

  const file = resolveDatabasePath();
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function logActivity(input: {
  kind: ActivityKind;
  level?: ActivityEvent["level"];
  title: string;
  detail?: string;
  invoiceId?: string;
  actionId?: string;
  source: ActivityEvent["source"];
  metadata?: Record<string, unknown>;
  at?: string;
}): ActivityEvent {
  const event: ActivityEvent = {
    id: uuid(),
    at: input.at ?? nowIso(),
    kind: input.kind,
    level: input.level ?? "INFO",
    title: input.title,
    detail: input.detail,
    invoiceId: input.invoiceId,
    actionId: input.actionId,
    source: input.source,
    metadata: input.metadata,
  };

  getDb()
    .prepare(
      `INSERT INTO activity_events
        (id, at, kind, level, title, detail, invoice_id, action_id, source, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.at,
      event.kind,
      event.level,
      event.title,
      event.detail ?? null,
      event.invoiceId ?? null,
      event.actionId ?? null,
      event.source,
      event.metadata ? JSON.stringify(event.metadata) : null,
    );

  return event;
}

type ActivityRow = {
  id: string;
  at: string;
  kind: ActivityKind;
  level: ActivityEvent["level"];
  title: string;
  detail: string | null;
  invoice_id: string | null;
  action_id: string | null;
  source: ActivityEvent["source"];
  metadata: string | null;
};

export function listActivity(limit = 100): ActivityEvent[] {
  const rows = getDb()
    .prepare("SELECT * FROM activity_events ORDER BY at DESC LIMIT ?")
    .all(limit) as ActivityRow[];

  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    level: row.level,
    title: row.title,
    detail: row.detail ?? undefined,
    invoiceId: row.invoice_id ?? undefined,
    actionId: row.action_id ?? undefined,
    source: row.source,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : undefined,
  }));
}
