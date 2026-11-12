import { cn } from "@/lib/utils/cn";
import type { ActionStatus, InvoiceSource, NormalizedInvoiceStatus } from "@/lib/types";

const STATUS_STYLES: Record<NormalizedInvoiceStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-200",
  SENT: "bg-brand-soft text-brand ring-brand/15",
  OVERDUE: "bg-danger-soft text-danger ring-danger/15",
  PAID: "bg-success-soft text-success ring-success/15",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-200",
  REFUNDED_OR_OTHER: "bg-warning-soft text-warning ring-warning/15",
  UNKNOWN: "bg-slate-100 text-slate-600 ring-slate-200",
};

const STATUS_LABELS: Record<NormalizedInvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  OVERDUE: "Overdue",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  REFUNDED_OR_OTHER: "Refunded / other",
  UNKNOWN: "Unknown",
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: NormalizedInvoiceStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function SourceBadge({
  source,
  className,
}: {
  source: InvoiceSource;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        source === "PAYPAL"
          ? "border-brand/15 bg-brand-soft text-brand"
          : "border-warning/20 bg-warning-soft text-warning",
        className,
      )}
      title={
        source === "PAYPAL"
          ? "Invoice data from the PayPal Sandbox API"
          : "Fictional demo data — not a live PayPal invoice"
      }
    >
      {source === "PAYPAL" ? "PayPal Sandbox" : "Demo"}
    </span>
  );
}

const ACTION_STYLES: Record<ActionStatus, string> = {
  PENDING_APPROVAL: "bg-warning-soft text-warning ring-warning/20",
  APPROVED: "bg-brand-soft text-brand ring-brand/15",
  EXECUTED: "bg-success-soft text-success ring-success/15",
  FAILED: "bg-danger-soft text-danger ring-danger/15",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-200",
};

const ACTION_LABELS: Record<ActionStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved — not sent",
  EXECUTED: "Executed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        ACTION_STYLES[status],
      )}
    >
      {ACTION_LABELS[status]}
    </span>
  );
}

export function ModePill({
  mode,
  className,
}: {
  mode: "DEMO" | "PAYPAL";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        mode === "PAYPAL"
          ? "border-brand/20 bg-brand-soft text-brand"
          : "border-warning/20 bg-warning-soft text-warning",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          mode === "PAYPAL" ? "bg-brand" : "bg-warning",
        )}
      />
      {mode === "PAYPAL" ? "PayPal Sandbox" : "Demo data"}
    </span>
  );
}
