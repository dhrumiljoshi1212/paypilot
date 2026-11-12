import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AgentChat } from "@/components/agent-chat";
import { PageHeader } from "@/components/metric-card";
import { listActions } from "@/lib/services/action-service";
import { getConfig } from "@/lib/env";
import { getDataSource } from "@/lib/services/invoice-service";

export const dynamic = "force-dynamic";

export const metadata = { title: "AI Agent" };

export default function AgentPage() {
  const config = getConfig();
  const mode = getDataSource() === "PAYPAL" ? "PAYPAL" : "DEMO";
  const actions = listActions({ limit: 100 }).filter(
    (action) =>
      (action.status === "PENDING_APPROVAL" || action.status === "APPROVED") &&
      (!action.invoice || action.invoice.source === mode),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Agent"
        description="Natural-language receivables work, backed by typed tools and a mandatory human approval step."
        actions={
          <Link href="/invoices" className="btn-secondary text-xs">
            <Sparkles className="size-3.5" />
            Browse invoices
          </Link>
        }
      />
      <AgentChat
        aiConfigured={config.aiConfigured}
        initialActions={actions}
        mode={mode}
      />
    </div>
  );
}
