import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  Clock3,
  FileWarning,
  Sparkles,
  Wallet,
} from "lucide-react";
import { MetricCard, PageHeader, SectionCard, EmptyState } from "@/components/metric-card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { InvoiceStatusBadge, SourceBadge } from "@/components/badges";
import { listActivity } from "@/lib/db";
import {
  buildBriefing,
  calculateCashflowSummary,
  calculatePriorityScores,
} from "@/lib/services/collection-service";
import {
  getAllInvoices,
  getDataSource,
  getLastSyncInfo,
} from "@/lib/services/invoice-service";
import { formatMoney, formatTotals } from "@/lib/utils/currency";
import { formatDate, relativeTime } from "@/lib/utils/dates";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const invoices = await getAllInvoices();
  const summary = calculateCashflowSummary(invoices);
  const priorities = calculatePriorityScores(invoices).slice(0, 4);
  const briefing = buildBriefing(invoices);
  const activity = listActivity(6);
  const sync = getLastSyncInfo();
  const source = getDataSource();
  const overdueInvoices = invoices
    .filter((invoice) => invoice.isOverdue)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="A live read on your receivables, plus the accounts that need attention first."
        actions={
          <>
            <span className="text-xs text-muted">
              {source === "PAYPAL" ? "PayPal Sandbox sync" : "Demo data"}:{" "}
              <span className="font-medium text-ink">
                {relativeTime(sync.lastSyncAt ?? sync.lastDemoSeed)}
              </span>
            </span>
            <Link href="/agent" className="btn-primary">
              <Sparkles className="size-4" />
              Ask the agent
            </Link>
          </>
        }
      />

      {sync.lastError && source === "PAYPAL" ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <FileWarning className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">PayPal sync failed</p>
            <p className="mt-0.5 text-xs">{sync.lastError}</p>
            <Link href="/settings" className="mt-1 inline-block text-xs font-semibold underline">
              Check the connection
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Outstanding"
          value={formatTotals(summary.outstanding) ?? formatMoney(0, "USD")}
          sub={`${summary.invoiceCounts.open} open invoice${summary.invoiceCounts.open === 1 ? "" : "s"} · sent, unpaid`}
          tone="brand"
          icon={<Wallet className="size-4" />}
        />
        <MetricCard
          label="Overdue"
          value={formatTotals(summary.overdue) ?? formatMoney(0, "USD")}
          sub={`${summary.invoiceCounts.overdue} invoice${summary.invoiceCounts.overdue === 1 ? "" : "s"} past their due date`}
          tone="danger"
          icon={<FileWarning className="size-4" />}
        />
        <MetricCard
          label="Paid this month"
          value={formatTotals(summary.paidThisMonth) ?? formatMoney(0, "USD")}
          sub="By invoice date; see the cash-flow notes"
          tone="success"
          icon={<CircleDollarSign className="size-4" />}
        />
        <MetricCard
          label="Due in next 7 days"
          value={formatTotals(summary.dueNext7Days) ?? formatMoney(0, "USD")}
          sub="Scheduled amounts — not guaranteed cash"
          icon={<Clock3 className="size-4" />}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard
          title="Today's briefing"
          description="Deterministic, explainable priorities. No ML predictions."
          action={
            <Link href="/agent" className="btn-secondary text-xs">
              Investigate
              <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          <div className="bg-gradient-to-br from-brand-soft to-surface px-5 py-5">
            <div className="flex items-start gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-white">
                <Sparkles className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">{briefing.headline}</p>
                <ul className="mt-2 space-y-1.5">
                  {briefing.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2 text-xs leading-relaxed text-muted">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand/50" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="border-t border-line px-5 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Recommended next actions
              </h3>
              <Link href="/invoices" className="text-xs font-medium text-brand hover:underline">
                All invoices
              </Link>
            </div>

            {priorities.length === 0 ? (
              <EmptyState
                title="No open invoices need chasing"
                description="When an invoice is sent and passes its due date, it will show up here with an explanation."
              />
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {priorities.map((priority, index) => (
                  <li key={priority.invoice.id} className="flex items-start gap-3 py-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-[11px] font-semibold text-muted">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {priority.invoice.customerName ?? "Unknown customer"}
                        </p>
                        <SourceBadge source={priority.invoice.source} />
                        {priority.invoice.isOverdue ? (
                          <span className="text-[11px] font-medium text-danger">
                            {priority.invoice.daysOverdue}d overdue
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{priority.explanation}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">
                        {formatMoney(priority.invoice.totalAmount, priority.invoice.currency)}
                      </p>
                      <p className="text-[11px] text-muted">score {priority.score}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            title="Overdue invoices"
            description="Open invoices with a due date in the past."
            action={
              <Link href="/invoices?status=OVERDUE" className="text-xs font-medium text-brand hover:underline">
                View all
              </Link>
            }
          >
            {overdueInvoices.length === 0 ? (
              <EmptyState
                title="Nothing overdue"
                description="Your invoices will appear here once PayPal is connected or demo data is enabled."
                icon={<Clock3 className="size-5" />}
              />
            ) : (
              <ul className="divide-y divide-line px-4">
                {overdueInvoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {invoice.customerName}
                        </p>
                        <InvoiceStatusBadge status="OVERDUE" />
                        <SourceBadge source={invoice.source} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {invoice.number ?? invoice.id} · due {formatDate(invoice.dueDate)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">
                        {formatMoney(invoice.totalAmount, invoice.currency)}
                      </p>
                      <p className="text-[11px] font-medium text-danger">
                        {invoice.daysOverdue} days
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Recent activity"
            description="Approvals, PayPal events, and local test fixtures are labelled separately."
            action={
              <Link href="/activity" className="text-xs font-medium text-brand hover:underline">
                Timeline
              </Link>
            }
          >
            <ActivityTimeline events={activity} compact />
          </SectionCard>
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="flex size-7 items-center justify-center rounded-md bg-canvas">
            <Clock3 className="size-4" />
          </span>
          <span>
            <span className="font-medium text-ink">Human-in-the-loop by design.</span>{" "}
            PayPilot can draft and recommend, but only an explicit approval can
            trigger a PayPal reminder.
          </span>
        </div>
        <Link href="/agent" className="btn-secondary text-xs">
          Open AI Agent
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
