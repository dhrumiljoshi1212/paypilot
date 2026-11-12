import { InvoicesView } from "@/components/invoices-view";
import { listActions } from "@/lib/services/action-service";
import {
  getAllInvoices,
  getDataSource,
  getLastSyncInfo,
} from "@/lib/services/invoice-service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Invoices" };

type SearchParams = Promise<{ invoice?: string; status?: string }>;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const invoices = await getAllInvoices();
  const source = getDataSource();
  const sync = getLastSyncInfo();
  const actions = listActions({ limit: 100 });

  const allowedStatuses = [
    "ALL",
    "OVERDUE",
    "SENT",
    "PAID",
    "DRAFT",
    "CANCELLED",
  ] as const;
  const status = allowedStatuses.includes(
    (params.status ?? "") as (typeof allowedStatuses)[number],
  )
    ? ((params.status ?? "ALL") as (typeof allowedStatuses)[number])
    : undefined;

  return (
    <InvoicesView
      invoices={invoices}
      initialActions={actions}
      focusId={params.invoice}
      initialStatus={status}
      source={source}
      lastSyncAt={source === "PAYPAL" ? sync.lastSyncAt : sync.lastDemoSeed}
      syncError={source === "PAYPAL" ? sync.lastError : undefined}
    />
  );
}
