import Link from "next/link";
import {
  BadgeCheck,
  BellRing,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  Inbox,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { ActivityEvent, ActivityKind } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, relativeTime } from "@/lib/utils/dates";
import { SourceBadge } from "./badges";

const KIND_META: Record<
  ActivityKind,
  { icon: typeof Clock3; className: string; label: string }
> = {
  INVOICE_SYNCED: { icon: RefreshCw, className: "bg-canvas text-muted", label: "Sync" },
  INVOICE_UPDATED: { icon: FileCheck2, className: "bg-brand-soft text-brand", label: "Invoice" },
  RECOMMENDATION: { icon: Sparkles, className: "bg-brand-soft text-brand", label: "AI" },
  DRAFT_CREATED: { icon: BellRing, className: "bg-warning-soft text-warning", label: "Draft" },
  ACTION_APPROVED: { icon: BadgeCheck, className: "bg-brand-soft text-brand", label: "Approval" },
  ACTION_CANCELLED: { icon: XCircle, className: "bg-canvas text-muted", label: "Cancelled" },
  ACTION_EXECUTED: { icon: Send, className: "bg-success-soft text-success", label: "Executed" },
  ACTION_FAILED: { icon: TriangleAlert, className: "bg-danger-soft text-danger", label: "Failed" },
  WEBHOOK_RECEIVED: { icon: Inbox, className: "bg-success-soft text-success", label: "Webhook" },
  PAYMENT_RECORDED: { icon: CircleDollarSign, className: "bg-success-soft text-success", label: "Payment" },
};

export function ActivityTimeline({
  events,
  compact = false,
}: {
  events: ActivityEvent[];
  compact?: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-sm text-muted">
        No activity yet. Actions and verified PayPal events will appear here.
      </div>
    );
  }

  return (
    <ol className={cn("relative", compact ? "px-4 py-2" : "px-5 py-4")}>
      {events.map((event, index) => {
        const meta = KIND_META[event.kind] ?? {
          icon: Clock3,
          className: "bg-canvas text-muted",
          label: "Event",
        };
        const Icon = meta.icon;
        return (
          <li key={event.id} className="relative flex gap-3 py-2.5">
            {index < events.length - 1 ? (
              <span className="absolute left-[15px] top-10 h-[calc(100%-1.5rem)] w-px bg-line" />
            ) : null}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                meta.className,
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-medium text-ink">{event.title}</p>
                {event.source === "PAYPAL" ? (
                  <span className="rounded border border-brand/15 bg-brand-soft px-1 py-0.5 text-[10px] font-semibold text-brand">
                    PayPal verified
                  </span>
                ) : event.source === "LOCAL_TEST" ? (
                  <span className="rounded border border-warning/20 bg-warning-soft px-1 py-0.5 text-[10px] font-semibold text-warning">
                    Local test — not PayPal
                  </span>
                ) : event.source === "DEMO" ? (
                  <span className="rounded border border-line bg-canvas px-1 py-0.5 text-[10px] font-semibold text-muted">
                    Demo
                  </span>
                ) : null}
              </div>
              {event.detail ? (
                <p className={cn("mt-0.5 text-xs leading-relaxed text-muted", compact && "line-clamp-2")}>
                  {event.detail}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <span title={formatDateTime(event.at)}>{relativeTime(event.at)}</span>
                {event.invoiceId ? (
                  <>
                    <span className="text-line">·</span>
                    <Link
                      href={`/invoices?invoice=${encodeURIComponent(event.invoiceId)}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {event.invoiceId}
                    </Link>
                  </>
                ) : null}
                {event.metadata?.eventType ? (
                  <>
                    <span className="text-line">·</span>
                    <span className="mono">{String(event.metadata.eventType)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { SourceBadge };
