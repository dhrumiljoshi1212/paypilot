#!/usr/bin/env node
/**
 * Seeds the five fictional demo invoices used by PayPilot in Demo mode.
 * Safe to re-run; pass --force to replace existing demo records.
 *
 * Usage: npm run seed
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH?.trim() || "data/paypilot.db";
const force = process.argv.includes("--force");

if (dbPath !== ":memory:") {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));

const existing = db
  .prepare("SELECT COUNT(*) AS count FROM invoices_cache WHERE source = 'DEMO'")
  .get().count;

if (existing > 0 && !force) {
  console.log(
    `Demo data already present (${existing} invoices). Use --force to replace it.`,
  );
  process.exit(0);
}

const DAY = 86_400_000;
const isoDate = (offsetDays) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const now = new Date().toISOString();

const demo = [
  ["DEMO-INV-1001", "INV-1001", "SENT", 1200, 42, -12, "Acme Design Co.", "billing@acme-design.example"],
  ["DEMO-INV-1002", "INV-1002", "SENT", 850, 37, -7, "Northstar Coffee", "accounts@northstar-coffee.example"],
  ["DEMO-INV-1003", "INV-1003", "SENT", 2000, 14, 1, "Juniper Studio", "hello@juniper-studio.example"],
  ["DEMO-INV-1004", "INV-1004", "PAID", 600, 8, -20, "Harbor & Pine", "finance@harbor-pine.example"],
  ["DEMO-INV-1005", "INV-1005", "DRAFT", 450, 0, 14, "Copper Lane Bakery", "owner@copper-lane.example"],
];

const upsert = db.prepare(`
  INSERT INTO invoices_cache
    (id, number, status, currency, total_amount, due_date, invoice_date,
     customer_name, customer_email, hosted_invoice_url, paypal_status,
     source, last_synced_at, raw_payload)
  VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, NULL, ?, 'DEMO', ?, NULL)
  ON CONFLICT(id) DO UPDATE SET
    number = excluded.number,
    status = excluded.status,
    total_amount = excluded.total_amount,
    due_date = excluded.due_date,
    invoice_date = excluded.invoice_date,
    customer_name = excluded.customer_name,
    customer_email = excluded.customer_email,
    paypal_status = excluded.paypal_status,
    source = 'DEMO',
    last_synced_at = excluded.last_synced_at
`);

if (force) {
  db.prepare("DELETE FROM agent_actions WHERE mode = 'DEMO'").run();
  db.prepare("DELETE FROM invoices_cache WHERE source = 'DEMO'").run();
}

const tx = db.transaction(() => {
  for (const [id, number, status, amount, invoiceOffset, dueOffset, name, email] of demo) {
    upsert.run(
      id,
      number,
      status,
      amount,
      isoDate(dueOffset),
      isoDate(-invoiceOffset),
      name,
      email,
      status,
      now,
    );
  }
});

tx();
db.prepare(
  "INSERT INTO app_settings (key, value) VALUES ('data_source', 'DEMO') ON CONFLICT(key) DO UPDATE SET value = 'DEMO'",
).run();
db.prepare(
  "INSERT INTO app_settings (key, value) VALUES ('last_demo_seed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
).run(now);

console.log(`Seeded ${demo.length} demo invoices into ${dbPath}.`);
console.log("These are fictional records and are labelled as Demo throughout the UI.");
db.close();
