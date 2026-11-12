import { Activity, BadgeCheck, Send, ShieldCheck } from "lucide-react";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader, SectionCard } from "@/components/metric-card";
import { listActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Activity" };

export default function ActivityPage() {
  const events = listActivity(150);

  const verified = events.filter(
    (event) =>
      event.source === "PAYPAL" &&
      (event.kind === "WEBHOOK_RECEIVED" || event.kind === "PAYMENT_RECORDED"),
  ).length;
  const localTests = events.filter((event) => event.source === "LOCAL_TEST").length;
  const executed = events.filter((event) => event.kind === "ACTION_EXECUTED").length;
  const approvals = events.filter((event) => event.kind === "ACTION_APPROVED").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity"
        description="An audit trail of invoice syncs, AI recommendations, approvals, PayPal requests, and webhook deliveries."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<BadgeCheck className="size-4" />} label="Approvals recorded" value={approvals} />
        <Stat icon={<Send className="size-4" />} label="Actions executed" value={executed} />
        <Stat
          icon={<ShieldCheck className="size-4" />}
          label="Verified PayPal webhooks"
          value={verified}
        />
        <Stat
          icon={<Activity className="size-4" />}
          label="Local test fixtures"
          value={localTests}
          warning
        />
      </div>

      <SectionCard
        title="Timeline"
        description="Verified PayPal events, app actions, and local test fixtures are visually distinct."
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-4 py-2 text-[11px] text-muted">
          <span className="rounded border border-brand/15 bg-brand-soft px-1.5 py-0.5 font-semibold text-brand">
            PayPal verified
          </span>
          <span>confirmed by PayPal signature verification</span>
          <span className="text-line">|</span>
          <span className="rounded border border-warning/20 bg-warning-soft px-1.5 py-0.5 font-semibold text-warning">
            Local test — not PayPal
          </span>
          <span>generated inside PayPilot to exercise the UI</span>
        </div>
        <ActivityTimeline events={events} />
      </SectionCard>

      <p className="px-1 text-[11px] leading-relaxed text-muted">
        PayPal webhook deliveries are stored with their PayPal event ID and are
        de-duplicated on retry. Local test entries are never presented as real
        PayPal webhooks.
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  warning,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span
        className={
          warning
            ? "flex size-8 items-center justify-center rounded-md bg-warning-soft text-warning"
            : "flex size-8 items-center justify-center rounded-md bg-brand-soft text-brand"
        }
      >
        {icon}
      </span>
      <div>
        <p className="text-lg font-semibold leading-none">{value}</p>
        <p className="mt-1 text-[11px] text-muted">{label}</p>
      </div>
    </div>
  );
}
