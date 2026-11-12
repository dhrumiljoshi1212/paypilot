import "server-only";

import { getDb, getSetting, logActivity, nowIso, setSetting } from "@/lib/db";
import { getConfig } from "@/lib/env";
import type { Invoice, InvoiceSource, NormalizedInvoiceStatus } from "@/lib/types";
import { daysOverdue, isOverdue } from "@/lib/utils/dates";
import { AppError } from "@/lib/utils/errors";
import {
  getPayPalInvoice,
  listAllPayPalInvoices,
  normalizePayPalInvoice,
} from "@/lib/paypal/invoices";
import type { PayPalInvoice } from "@/lib/paypal/types";

export type InvoiceRow = {
  id: string;
  number: string | null;
  status: string;
  currency: string;
  total_amount: number;
  due_date: string | null;
  invoice_date: string | null;
  customer_name: string | null;
  customer_email: string | null;
  hosted_invoice_url: string | null;
  paypal_status: string;
  source: string;
  last_synced_at: string;
  raw_payload: string | null;
};

export function rowToInvoice(row: InvoiceRow, now: Date = new Date()): Invoice {
  const status = row.status as NormalizedInvoiceStatus;
  const dueDate = row.due_date ?? undefined;
  const overdue = isOverdue(status, dueDate, now);
  return {
    id: row.id,
    number: row.number ?? undefined,
    status,
    paypalStatus: row.paypal_status,
    currency: row.currency,
    totalAmount: row.total_amount,
    dueDate,
    invoiceDate: row.invoice_date ?? undefined,
    customerName: row.customer_name ?? undefined,
    customerEmail: row.customer_email ?? undefined,
    hostedInvoiceUrl: row.hosted_invoice_url ?? undefined,
    source: row.source as InvoiceSource,
    lastSyncedAt: row.last_synced_at,
    daysOverdue: overdue ? daysOverdue(dueDate, now) : 0,
    isOverdue: overdue,
  };
}

export function upsertInvoice(invoice: Invoice, raw?: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO invoices_cache
        (id, number, status, currency, total_amount, due_date, invoice_date,
         customer_name, customer_email, hosted_invoice_url, paypal_status,
         source, last_synced_at, raw_payload)
       VALUES (@id, @number, @status, @currency, @totalAmount, @dueDate, @invoiceDate,
         @customerName, @customerEmail, @hostedInvoiceUrl, @paypalStatus,
         @source, @lastSyncedAt, @rawPayload)
       ON CONFLICT(id) DO UPDATE SET
         number = excluded.number,
         status = excluded.status,
         currency = excluded.currency,
         total_amount = excluded.total_amount,
         due_date = excluded.due_date,
         invoice_date = excluded.invoice_date,
         customer_name = excluded.customer_name,
         customer_email = excluded.customer_email,
         hosted_invoice_url = excluded.hosted_invoice_url,
         paypal_status = excluded.paypal_status,
         source = excluded.source,
         last_synced_at = excluded.last_synced_at,
         raw_payload = excluded.raw_payload`,
    )
    .run({
      id: invoice.id,
      number: invoice.number ?? null,
      status: invoice.status,
      currency: invoice.currency,
      totalAmount: invoice.totalAmount,
      dueDate: invoice.dueDate ?? null,
      invoiceDate: invoice.invoiceDate ?? null,
      customerName: invoice.customerName ?? null,
      customerEmail: invoice.customerEmail ?? null,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null,
      paypalStatus: invoice.paypalStatus,
      source: invoice.source,
      lastSyncedAt: invoice.lastSyncedAt,
      rawPayload: raw === undefined ? null : JSON.stringify(raw),
    });
}

export function getDataSource(): InvoiceSource {
  const config = getConfig();
  const stored = getSetting("data_source");

  if (stored === "PAYPAL" || stored === "DEMO") {
    if (stored === "PAYPAL" && !config.paypalConfigured) return "DEMO";
    return stored;
  }

  let initial: InvoiceSource = config.demoModeDefault ? "DEMO" : "PAYPAL";
  if (initial === "PAYPAL" && !config.paypalConfigured) {
    initial = "DEMO";
  }
  setSetting("data_source", initial);
  return initial;
}

export function setDataSource(source: InvoiceSource): void {
  const config = getConfig();
  if (source === "PAYPAL" && !config.paypalConfigured) {
    throw new AppError(
      "PAYPAL_NOT_CONFIGURED",
      "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before switching to PayPal Sandbox.",
    );
  }
  setSetting("data_source", source);
  logActivity({
    kind: "INVOICE_UPDATED",
    title: `Data source switched to ${source === "DEMO" ? "Demo data" : "PayPal Sandbox"}`,
    source: "APP",
    level: "INFO",
  });
}

const DAY = 86_400_000;
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

export function seedDemoInvoices(force = false): number {
  const db = getDb();
  const existing = db
    .prepare("SELECT COUNT(*) AS count FROM invoices_cache WHERE source = 'DEMO'")
    .get() as { count: number };

  if (existing.count > 0 && !force) return existing.count;

  const now = nowIso();
  const demo: Array<{
    id: string;
    number: string;
    status: NormalizedInvoiceStatus;
    amount: number;
    dueDate: string;
    invoiceDate: string;
    customerName: string;
    customerEmail: string;
  }> = [
    {
      id: "DEMO-INV-1001",
      number: "INV-1001",
      status: "SENT",
      amount: 1200,
      dueDate: daysAgo(12),
      invoiceDate: daysAgo(42),
      customerName: "Acme Design Co.",
      customerEmail: "billing@acme-design.example",
    },
    {
      id: "DEMO-INV-1002",
      number: "INV-1002",
      status: "SENT",
      amount: 850,
      dueDate: daysAgo(7),
      invoiceDate: daysAgo(37),
      customerName: "Northstar Coffee",
      customerEmail: "accounts@northstar-coffee.example",
    },
    {
      id: "DEMO-INV-1003",
      number: "INV-1003",
      status: "SENT",
      amount: 2000,
      dueDate: daysFromNow(1),
      invoiceDate: daysAgo(14),
      customerName: "Juniper Studio",
      customerEmail: "hello@juniper-studio.example",
    },
    {
      id: "DEMO-INV-1004",
      number: "INV-1004",
      status: "PAID",
      amount: 600,
      dueDate: daysAgo(20),
      invoiceDate: daysAgo(8),
      customerName: "Harbor & Pine",
      customerEmail: "finance@harbor-pine.example",
    },
    {
      id: "DEMO-INV-1005",
      number: "INV-1005",
      status: "DRAFT",
      amount: 450,
      dueDate: daysFromNow(14),
      invoiceDate: daysFromNow(0),
      customerName: "Copper Lane Bakery",
      customerEmail: "owner@copper-lane.example",
    },
  ];

  for (const item of demo) {
    upsertInvoice({
      id: item.id,
      number: item.number,
      status: item.status,
      paypalStatus: item.status === "SENT" ? "SENT" : item.status,
      currency: "USD",
      totalAmount: item.amount,
      dueDate: item.dueDate,
      invoiceDate: item.invoiceDate,
      customerName: item.customerName,
      customerEmail: item.customerEmail,
      source: "DEMO",
      lastSyncedAt: now,
      daysOverdue: 0,
      isOverdue: false,
    });
  }

  setSetting("last_demo_seed", now);
  logActivity({
    kind: "INVOICE_SYNCED",
    title: "Demo invoices loaded",
    detail:
      "Fictional sample data. These records are not live PayPal invoices.",
    source: "DEMO",
    metadata: { count: demo.length },
  });

  return demo.length;
}

export async function syncInvoicesFromPayPal(): Promise<Invoice[]> {
  const config = getConfig();
  if (!config.paypalConfigured) {
    throw new AppError(
      "PAYPAL_NOT_CONFIGURED",
      "PayPal Sandbox credentials are not configured.",
    );
  }

  const rawInvoices = await listAllPayPalInvoices();
  const now = new Date();

  for (const raw of rawInvoices) {
    const invoice = normalizePayPalInvoice(raw, now);
    upsertInvoice(invoice, raw);
  }

  setSetting("last_paypal_sync", now.toISOString());
  setSetting("last_paypal_sync_count", String(rawInvoices.length));
  setSetting("last_paypal_sync_error", "");

  logActivity({
    kind: "INVOICE_SYNCED",
    title: `Synced ${rawInvoices.length} invoice${rawInvoices.length === 1 ? "" : "s"} from PayPal Sandbox`,
    detail: "Invoice cache refreshed from the PayPal Invoicing API.",
    source: "PAYPAL",
    level: "SUCCESS",
    metadata: { count: rawInvoices.length },
  });

  return rawInvoices.map((raw) => normalizePayPalInvoice(raw, now));
}

export async function refreshInvoices(): Promise<{
  source: InvoiceSource;
  count: number;
}> {
  const source = getDataSource();
  if (source === "DEMO") {
    return { source, count: seedDemoInvoices() };
  }
  const invoices = await syncInvoicesFromPayPal();
  return { source, count: invoices.length };
}

export async function getAllInvoices(options?: {
  autoSync?: boolean;
}): Promise<Invoice[]> {
  const source = getDataSource();

  if (source === "DEMO") {
    seedDemoInvoices();
  } else if (options?.autoSync !== false) {
    const count = getDb()
      .prepare("SELECT COUNT(*) AS count FROM invoices_cache WHERE source = 'PAYPAL'")
      .get() as { count: number };
    if (count.count === 0) {
      try {
        await syncInvoicesFromPayPal();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown PayPal error";
        setSetting("last_paypal_sync_error", message);
        logActivity({
          kind: "INVOICE_SYNCED",
          level: "ERROR",
          title: "PayPal invoice sync failed",
          detail: message,
          source: "PAYPAL",
        });
      }
    }
  }

  // Never mix demo records with sandbox records in the same workspace view.
  const rows = getDb()
    .prepare(
      "SELECT * FROM invoices_cache WHERE source = ? ORDER BY due_date ASC, id ASC",
    )
    .all(source) as InvoiceRow[];

  return rows.map((row) => rowToInvoice(row));
}

export async function getInvoiceById(id: string): Promise<Invoice> {
  const row = getDb()
    .prepare("SELECT * FROM invoices_cache WHERE id = ?")
    .get(id) as InvoiceRow | undefined;

  if (row) return rowToInvoice(row);

  const source = getDataSource();
  if (source === "PAYPAL") {
    const raw = await getPayPalInvoice(id);
    const invoice = normalizePayPalInvoice(raw);
    upsertInvoice(invoice, raw);
    return invoice;
  }

  throw new AppError("NOT_FOUND", "That invoice is not in the local cache.");
}

export async function refreshInvoiceFromPayPal(
  id: string,
  options?: { silent?: boolean },
): Promise<Invoice> {
  const raw: PayPalInvoice = await getPayPalInvoice(id);
  const invoice = normalizePayPalInvoice(raw);
  upsertInvoice(invoice, raw);
  if (!options?.silent) {
    logActivity({
      kind: "INVOICE_UPDATED",
      title: `Refreshed invoice ${invoice.number ?? invoice.id} from PayPal`,
      detail: `PayPal status: ${invoice.paypalStatus}`,
      invoiceId: invoice.id,
      source: "PAYPAL",
      metadata: { status: invoice.status },
    });
  }
  return invoice;
}

export function markInvoiceStatus(
  id: string,
  status: NormalizedInvoiceStatus,
  options: {
    paypalStatus?: string;
    source: InvoiceSource;
    note?: string;
  },
): Invoice | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM invoices_cache WHERE id = ?")
    .get(id) as InvoiceRow | undefined;
  if (!row) return undefined;

  db.prepare(
    `UPDATE invoices_cache
     SET status = ?, paypal_status = ?, last_synced_at = ?
     WHERE id = ?`,
  ).run(
    status,
    options.paypalStatus ?? status,
    nowIso(),
    id,
  );

  const updated = {
    ...row,
    status,
    paypal_status: options.paypalStatus ?? status,
    last_synced_at: nowIso(),
  } as InvoiceRow;

  return rowToInvoice(updated);
}

export function getLastSyncInfo(): {
  lastSyncAt?: string;
  lastSyncCount?: number;
  lastError?: string;
  lastDemoSeed?: string;
} {
  return {
    lastSyncAt: getSetting("last_paypal_sync") || undefined,
    lastSyncCount: getSetting("last_paypal_sync_count")
      ? Number(getSetting("last_paypal_sync_count"))
      : undefined,
    lastError: getSetting("last_paypal_sync_error") || undefined,
    lastDemoSeed: getSetting("last_demo_seed") || undefined,
  };
}

export function resetDemoData(): void {
  const db = getDb();
  const demoInvoiceIds = (
    db
      .prepare("SELECT id FROM invoices_cache WHERE source = 'DEMO'")
      .all() as Array<{ id: string }>
  ).map((row) => row.id);
  const demoActionIds = (
    db
      .prepare("SELECT id FROM agent_actions WHERE mode = 'DEMO'")
      .all() as Array<{ id: string }>
  ).map((row) => row.id);

  const removeActivity = db.prepare("DELETE FROM activity_events WHERE id = ?");
  const activityRows = db
    .prepare("SELECT id, invoice_id, action_id, source FROM activity_events")
    .all() as Array<{
    id: string;
    invoice_id: string | null;
    action_id: string | null;
    source: string;
  }>;

  db.transaction(() => {
    for (const row of activityRows) {
      if (
        row.source === "DEMO" ||
        row.source === "LOCAL_TEST" ||
        (row.invoice_id && demoInvoiceIds.includes(row.invoice_id)) ||
        (row.action_id && demoActionIds.includes(row.action_id))
      ) {
        removeActivity.run(row.id);
      }
    }
    db.prepare("DELETE FROM agent_actions WHERE mode = 'DEMO'").run();
    db.prepare("DELETE FROM webhook_events WHERE source = 'LOCAL_TEST'").run();
    db.prepare("DELETE FROM invoices_cache WHERE source = 'DEMO'").run();
  })();

  seedDemoInvoices(true);
}
