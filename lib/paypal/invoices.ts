import "server-only";

import { paypalRequest } from "./client";
import type {
  PayPalInvoice,
  PayPalInvoiceListResponse,
  PayPalInvoiceName,
} from "./types";
import type { Invoice } from "@/lib/types";
import { daysOverdue, isOverdue } from "@/lib/utils/dates";
import { parseAmount } from "@/lib/utils/currency";
import { normalizeInvoiceStatus } from "@/lib/services/collection-service";

export function nameFromPayPal(name?: PayPalInvoiceName): string | undefined {
  if (!name) return undefined;
  if (name.full_name) return name.full_name;
  const parts = [name.given_name, name.middle_name, name.surname].filter(
    Boolean,
  );
  if (parts.length > 0) return parts.join(" ");
  return name.business_name;
}

export function dueDateFromPayPal(raw: PayPalInvoice): string | undefined {
  return (
    raw.detail?.payment_term?.due_date ??
    raw.detail?.due_date ??
    undefined
  );
}

export function hostedUrlFromPayPal(raw: PayPalInvoice): string | undefined {
  return (
    raw.links?.find((link) => link.rel === "payer-view")?.href ??
    raw.links?.find((link) => link.rel === "customer-view")?.href ??
    undefined
  );
}

export function normalizePayPalInvoice(
  raw: PayPalInvoice,
  now: Date = new Date(),
): Invoice {
  const currency =
    raw.amount?.currency_code ?? raw.detail?.currency_code ?? "USD";
  const totalAmount = parseAmount(raw.amount?.value);
  const status = normalizeInvoiceStatus(raw.status);
  const dueDate = dueDateFromPayPal(raw);
  const recipient = raw.primary_recipients?.[0]?.billing_info;
  const overdue = isOverdue(status, dueDate, now);
  const days = overdue ? daysOverdue(dueDate, now) : 0;

  return {
    id: raw.id,
    number: raw.detail?.invoice_number,
    status,
    paypalStatus: raw.status,
    currency,
    totalAmount,
    dueDate,
    invoiceDate: raw.detail?.invoice_date,
    customerName: nameFromPayPal(recipient?.name) ?? "Unknown customer",
    customerEmail: recipient?.email_address,
    hostedInvoiceUrl: hostedUrlFromPayPal(raw),
    source: "PAYPAL",
    lastSyncedAt: now.toISOString(),
    daysOverdue: days,
    isOverdue: overdue,
  };
}

export async function listPayPalInvoices(options?: {
  page?: number;
  pageSize?: number;
}): Promise<{
  items: PayPalInvoice[];
  page: number;
  totalPages: number;
  totalItems: number;
}> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 20));

  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    total_required: "true",
  });

  const response = await paypalRequest<PayPalInvoiceListResponse>(
    `/v2/invoicing/invoices?${query.toString()}`,
  );

  return {
    items: response.items ?? [],
    page,
    totalPages: response.total_pages ?? page,
    totalItems: response.total_items ?? response.items?.length ?? 0,
  };
}

/** Bounded pagination: fetch at most `maxPages` pages to keep sync predictable. */
export async function listAllPayPalInvoices(
  maxPages = 5,
): Promise<PayPalInvoice[]> {
  const all: PayPalInvoice[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await listPayPalInvoices({ page, pageSize: 100 });
    all.push(...result.items);
    totalPages = result.totalPages;
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  return all;
}

export async function getPayPalInvoice(
  invoiceId: string,
): Promise<PayPalInvoice> {
  return paypalRequest<PayPalInvoice>(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
  );
}

/**
 * Sends PayPal's reminder email for an invoice.
 *
 * PayPal currently ignores caller-supplied `subject`/`note` values for this
 * endpoint and uses its own system email. PayPilot stores the personalized
 * draft for the audit trail and explains this limitation in the UI.
 */
export async function sendPayPalReminder(
  invoiceId: string,
  options: { requestId?: string; note?: string; subject?: string },
): Promise<void> {
  await paypalRequest<undefined>(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`,
    {
      method: "POST",
      requestId: options.requestId,
      retryable: Boolean(options.requestId),
      body: {
        subject: options.subject,
        note: options.note,
        send_to_invoicer: false,
        send_to_recipient: true,
      },
    },
  );
}

export async function sendPayPalInvoice(
  invoiceId: string,
  options?: { requestId?: string },
): Promise<void> {
  await paypalRequest<undefined>(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    {
      method: "POST",
      requestId: options?.requestId,
      body: { send_to_recipient: true, send_to_invoicer: false },
    },
  );
}
