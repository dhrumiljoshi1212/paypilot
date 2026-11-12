"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
  TestTube2,
  X,
} from "lucide-react";
import type { AgentAction, Invoice, InvoiceSource } from "@/lib/types";
import { SourceBadge, InvoiceStatusBadge, ModePill } from "./badges";
import { ApprovalCard } from "./approval-card";
import { PageHeader, EmptyState } from "./metric-card";
import { isEligibleForReminder } from "@/lib/services/collection-service";
import { formatDate, relativeTime } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/currency";
import { cn } from "@/lib/utils/cn";

type StatusFilter =
  | "ALL"
  | "OVERDUE"
  | "SENT"
  | "PAID"
  | "DRAFT"
  | "CANCELLED";

type SortKey = "due" | "amount" | "overdue";

type ApiErr = { error?: { message?: string } };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErr;
    return body.error?.message ?? `Request failed (HTTP ${response.status}).`;
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
}

export function InvoicesView({
  invoices,
  initialActions,
  focusId,
  initialStatus,
  source,
  lastSyncAt,
  syncError,
}: {
  invoices: Invoice[];
  initialActions: AgentAction[];
  focusId?: string;
  initialStatus?: StatusFilter;
  source: InvoiceSource;
  lastSyncAt?: string;
  syncError?: string;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus ?? "ALL");
  const [sort, setSort] = useState<SortKey>("due");
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [actions, setActions] = useState<AgentAction[]>(initialActions);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(syncError ?? null);
  const [drawerBusy, setDrawerBusy] = useState<string | null>(null);

  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? null;
  const selectedActions = selected
    ? actions.filter((action) => action.invoiceId === selected.id)
    : [];
  const reviewAction =
    actions.find((action) => action.id === reviewActionId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        setReviewActionId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = invoices.filter((invoice) => {
      if (status === "OVERDUE" && !invoice.isOverdue) return false;
      if (status === "SENT" && invoice.status !== "SENT") return false;
      if (status === "PAID" && invoice.status !== "PAID") return false;
      if (status === "DRAFT" && invoice.status !== "DRAFT") return false;
      if (status === "CANCELLED" && invoice.status !== "CANCELLED") return false;
      if (!query) return true;
      return [
        invoice.number,
        invoice.id,
        invoice.customerName,
        invoice.customerEmail,
        invoice.currency,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    result = [...result].sort((a, b) => {
      if (sort === "amount") return b.totalAmount - a.totalAmount;
      if (sort === "overdue") return b.daysOverdue - a.daysOverdue;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    return result;
  }, [invoices, search, status, sort]);

  async function refreshAll() {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/paypal/invoices", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { refreshed: number };
      setNotice(
        source === "DEMO"
          ? "Demo invoices refreshed."
          : `Refreshed ${body.refreshed} invoice${body.refreshed === 1 ? "" : "s"} from PayPal Sandbox.`,
      );
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed.");
    }
  }

  async function draftReminder(invoice: Invoice) {
    setDrawerBusy("draft");
    setError(null);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, tone: "professional" }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { action: AgentAction };
      setActions((current) => [body.action, ...current]);
      setReviewActionId(body.action.id);
      setNotice("Draft created. Nothing has been sent — review and approve it below.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a draft.");
    } finally {
      setDrawerBusy(null);
    }
  }

  async function refreshInvoice(invoice: Invoice) {
    setDrawerBusy("invoice");
    setError(null);
    try {
      const response = await fetch(
        `/api/paypal/invoices/${encodeURIComponent(invoice.id)}?refresh=1`,
      );
      if (!response.ok) throw new Error(await readError(response));
      setNotice(`Invoice ${invoice.number ?? invoice.id} refreshed from PayPal.`);
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed.");
    } finally {
      setDrawerBusy(null);
    }
  }

  async function simulatePayment(invoice: Invoice) {
    if (
      !window.confirm(
        "Record a LOCAL TEST payment event for this demo invoice? This is not a PayPal webhook and no real payment occurs.",
      )
    ) {
      return;
    }
    setDrawerBusy("simulate");
    setError(null);
    try {
      const response = await fetch("/api/demo/simulate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(
        "Local test event recorded. The activity timeline labels it as a local fixture, not a PayPal webhook.",
      );
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Simulation failed.");
    } finally {
      setDrawerBusy(null);
    }
  }

  function openInvoice(invoice: Invoice) {
    setSelectedId(invoice.id);
    setReviewActionId(null);
    setNotice(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description="Facts come from PayPal or clearly-labelled demo records. Derived overdue status is shown next to the raw PayPal status."
        actions={
          <>
            <ModePill mode={source} />
            <button
              type="button"
              className="btn-secondary"
              onClick={refreshAll}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </>
        }
      />

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            className="ml-auto text-xs font-semibold underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
          <button
            type="button"
            className="ml-auto text-xs font-semibold underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
            <input
              className="input pl-9"
              placeholder="Search customer, invoice number, or ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="ALL">All statuses</option>
            <option value="OVERDUE">Overdue (derived)</option>
            <option value="SENT">Sent / unpaid</option>
            <option value="PAID">Paid</option>
            <option value="DRAFT">Draft</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select
            className="input w-auto"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort invoices"
          >
            <option value="due">Due date</option>
            <option value="amount">Amount</option>
            <option value="overdue">Days overdue</option>
          </select>
          <span className="ml-auto text-xs text-muted">
            {filtered.length} of {invoices.length}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={invoices.length === 0 ? "No invoices yet" : "No invoices match those filters"}
            description={
              invoices.length === 0
                ? "Your invoices will appear here once PayPal is connected or demo data is enabled."
                : "Try clearing the search or choosing a different status."
            }
            action={
              invoices.length === 0 ? (
                <button type="button" className="btn-primary" onClick={refreshAll}>
                  <RefreshCw className="size-4" />
                  Load invoices
                </button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Invoice</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Customer</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Due</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Source</th>
                    <th scope="col" className="px-4 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="cursor-pointer transition-colors hover:bg-canvas/70"
                      onClick={() => openInvoice(invoice)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{invoice.number ?? invoice.id}</p>
                        <p className="mono text-[11px] text-muted">{invoice.id}</p>
                      </td>
                      <td className="max-w-52 px-4 py-3">
                        <p className="truncate">{invoice.customerName ?? "Unknown"}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatMoney(invoice.totalAmount, invoice.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <p>{formatDate(invoice.dueDate)}</p>
                        {invoice.isOverdue ? (
                          <p className="text-[11px] font-medium text-danger">
                            {invoice.daysOverdue}d overdue
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge
                          status={invoice.isOverdue ? "OVERDUE" : invoice.status}
                        />
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                          {invoice.source === "PAYPAL" ? "PayPal" : "Stored"}:{" "}
                          {invoice.paypalStatus}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <SourceBadge source={invoice.source} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight className="ml-auto size-4 text-muted" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {filtered.map((invoice) => (
                <li key={invoice.id}>
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left hover:bg-canvas/70"
                    onClick={() => openInvoice(invoice)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {invoice.customerName ?? "Unknown"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {invoice.number ?? invoice.id} · due {formatDate(invoice.dueDate)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold">
                        {formatMoney(invoice.totalAmount, invoice.currency)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <InvoiceStatusBadge
                        status={invoice.isOverdue ? "OVERDUE" : invoice.status}
                      />
                      <SourceBadge source={invoice.source} />
                      {invoice.isOverdue ? (
                        <span className="text-[11px] font-medium text-danger">
                          {invoice.daysOverdue}d overdue
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11px] text-muted">
          <span>
            Last {source === "PAYPAL" ? "PayPal" : "demo"} sync:{" "}
            {lastSyncAt ? relativeTime(lastSyncAt) : "not yet"}
          </span>
          <span className="flex items-center gap-1">
            <ArrowDownUp className="size-3" />
            Sort: {sort === "due" ? "due date" : sort === "amount" ? "amount" : "days overdue"}
          </span>
        </div>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close invoice details"
            className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
            onClick={() => {
              setSelectedId(null);
              setReviewActionId(null);
            }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice ${selected.number ?? selected.id}`}
            className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-surface shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">
                    {selected.number ?? selected.id}
                  </h2>
                  <InvoiceStatusBadge
                    status={selected.isOverdue ? "OVERDUE" : selected.status}
                  />
                  <SourceBadge source={selected.source} />
                </div>
                <p className="mono mt-1 truncate text-[11px] text-muted">
                  {selected.id} ·{" "}
                  {selected.source === "PAYPAL" ? "PayPal status" : "Stored status"}{" "}
                  {selected.paypalStatus}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-canvas"
                onClick={() => {
                  setSelectedId(null);
                  setReviewActionId(null);
                }}
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="Customer" value={selected.customerName ?? "Unknown"} />
                <Detail
                  label="Amount"
                  value={formatMoney(selected.totalAmount, selected.currency)}
                />
                <Detail label="Invoice date" value={formatDate(selected.invoiceDate)} />
                <Detail
                  label="Due date"
                  value={`${formatDate(selected.dueDate)}${selected.isOverdue ? ` · ${selected.daysOverdue}d overdue` : ""}`}
                />
                <Detail label="Customer email" value={selected.customerEmail ?? "Not provided"} />
                <Detail
                  label="Overdue (derived)"
                  value={selected.isOverdue ? `Yes — ${selected.daysOverdue} days` : "No"}
                />
              </div>

              {selected.hostedInvoiceUrl ? (
                <a
                  href={selected.hostedInvoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary w-full"
                >
                  <ExternalLink className="size-4" />
                  Open PayPal invoice page
                </a>
              ) : null}

              <div className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                {selected.source === "PAYPAL"
                  ? "This record came from the PayPal Sandbox Invoicing API. PayPal is the source of truth; use refresh to re-read it."
                  : "This is a fictional demo invoice. It is not a live PayPal record, and it cannot be sent through PayPal."}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => draftReminder(selected)}
                  disabled={!isEligibleForReminder(selected).eligible || drawerBusy !== null}
                >
                  <Mail className="size-4" />
                  {drawerBusy === "draft" ? "Drafting..." : "Draft reminder"}
                </button>

                {selected.source === "PAYPAL" ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => refreshInvoice(selected)}
                    disabled={drawerBusy !== null}
                  >
                    <RefreshCw className={cn("size-4", drawerBusy === "invoice" && "animate-spin")} />
                    Refresh from PayPal
                  </button>
                ) : null}

                {selected.source === "DEMO" && selected.status !== "PAID" ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => simulatePayment(selected)}
                    disabled={drawerBusy !== null}
                  >
                    <TestTube2 className="size-4" />
                    Simulate payment
                  </button>
                ) : null}
              </div>

              {!isEligibleForReminder(selected).eligible ? (
                <p className="text-[11px] text-muted">
                  Reminder unavailable: {isEligibleForReminder(selected).reason}
                </p>
              ) : null}

              {reviewAction ? (
                <ApprovalCard
                  action={reviewAction}
                  onDismiss={() => setReviewActionId(null)}
                  onChanged={(updated) =>
                    setActions((current) =>
                      current.map((item) => (item.id === updated.id ? updated : item)),
                    )
                  }
                />
              ) : null}

              {selectedActions.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Reminder actions
                  </h3>
                  <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                    {selectedActions.map((action) => (
                      <li
                        key={action.id}
                        className="flex items-center justify-between gap-2 px-3 py-2.5"
                      >
                        <div>
                          <p className="text-xs font-medium">
                            {action.mode === "DEMO" ? "Demo reminder" : "PayPal reminder"} ·{" "}
                            {action.status.replaceAll("_", " ").toLowerCase()}
                          </p>
                          <p className="text-[11px] text-muted">
                            Created {relativeTime(action.createdAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-[11px]"
                          onClick={() => setReviewActionId(action.id)}
                        >
                          {action.status === "PENDING_APPROVAL" ? "Review" : "View"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex items-start gap-2 rounded-lg border border-brand/15 bg-brand-soft px-3 py-2.5 text-[11px] text-brand">
                <Sparkles className="mt-0.5 size-4 shrink-0" />
                <span>
                  Want a personalized draft? Open the{" "}
                  <a href="/agent" className="font-semibold underline">
                    AI Agent
                  </a>{" "}
                  and ask it to prioritize or draft a reminder. Approval is always
                  required before sending.
                </span>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className="mt-0.5 truncate text-sm">{value}</p>
    </div>
  );
}
