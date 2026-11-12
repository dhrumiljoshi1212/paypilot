"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  Cloud,
  Database,
  FlaskConical,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/dates";

type SettingsState = {
  dataSource: "DEMO" | "PAYPAL";
  paypalConfigured: boolean;
  aiConfigured: boolean;
  webhookConfigured: boolean;
  paypalBaseUrl: string;
  model: string;
  webhookUrl: string;
  lastSyncAt?: string;
  lastError?: string;
  lastConnectionCheck?: string;
  lastConnectionStatus?: string;
  nodeEnv: string;
};

type ApiErr = { error?: { message?: string } };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErr;
    return body.error?.message ?? `Request failed (HTTP ${response.status}).`;
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
}

export function SettingsPanel({ initial }: { initial: SettingsState }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function switchSource(source: "DEMO" | "PAYPAL") {
    setBusy("source");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSource: source }),
      });
      if (!response.ok) throw new Error(await readError(response));

      if (source === "PAYPAL") {
        const sync = await fetch("/api/paypal/invoices", { method: "POST" });
        if (!sync.ok) throw new Error(await readError(sync));
        const body = (await sync.json()) as { refreshed: number };
        setNotice(
          `Switched to PayPal Sandbox and synced ${body.refreshed} invoice${body.refreshed === 1 ? "" : "s"}.`,
        );
      } else {
        setNotice("Switched to demo data. Fictional invoices are clearly labelled.");
      }
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch data source.");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/paypal/connect", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as {
        environment: string;
        checkedAt: string;
        cachedInvoices: number;
      };
      setNotice(
        `PayPal ${body.environment} OAuth succeeded at ${new Date(body.checkedAt).toLocaleTimeString()}. ${body.cachedInvoices} PayPal invoice(s) cached.`,
      );
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection test failed.");
    } finally {
      setBusy(null);
    }
  }

  async function resetDemo() {
    if (
      !window.confirm(
        "Reset demo invoices and demo actions? This deletes local demo records only; PayPal data is untouched.",
      )
    ) {
      return;
    }
    setBusy("reset");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetDemo: true }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice("Demo data reset to the original five sample invoices.");
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reset failed.");
    } finally {
      setBusy(null);
    }
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(initial.webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed. Select and copy the URL manually.");
    }
  }

  return (
    <div className="space-y-5">
      {notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-brand-soft text-brand">
              <PlugZap className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">PayPal Sandbox connection</h2>
              <p className="text-[11px] text-muted">
                Server-to-server OAuth · secrets stay on the server
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2.5 text-xs">
            <Row label="Credentials">
              <Status ok={initial.paypalConfigured}>
                {initial.paypalConfigured ? "Configured" : "Not configured"}
              </Status>
            </Row>
            <Row label="API base URL">
              <span className="mono">{initial.paypalBaseUrl}</span>
            </Row>
            <Row label="Last API check">
              <span>
                {initial.lastConnectionCheck
                  ? `${relativeTime(initial.lastConnectionCheck)} · ${initial.lastConnectionStatus ?? "unknown"}`
                  : "Never checked"}
              </span>
            </Row>
            <Row label="Last invoice sync">
              <span>
                {initial.lastSyncAt ? relativeTime(initial.lastSyncAt) : "Not yet"}
              </span>
            </Row>
          </dl>

          {initial.lastError ? (
            <p className="mt-3 rounded-md border border-danger/20 bg-danger-soft px-2.5 py-2 text-[11px] text-danger">
              {initial.lastError}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={testConnection}
              disabled={busy !== null || !initial.paypalConfigured}
            >
              <RefreshCw className={cn("size-4", busy === "test" && "animate-spin")} />
              {busy === "test" ? "Checking..." : "Test connection"}
            </button>
            <a
              href="https://developer.paypal.com/dashboard/applications/sandbox"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-xs"
            >
              Developer dashboard ↗
            </a>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-warning-soft text-warning">
              <FlaskConical className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Data source</h2>
              <p className="text-[11px] text-muted">
                Demo data is always labelled. It is never presented as PayPal data.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => switchSource("DEMO")}
              disabled={busy !== null || initial.dataSource === "DEMO"}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                initial.dataSource === "DEMO"
                  ? "border-warning/30 bg-warning-soft"
                  : "border-line hover:bg-canvas",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 items-center justify-center rounded-full border",
                  initial.dataSource === "DEMO"
                    ? "border-warning bg-warning text-white"
                    : "border-line",
                )}
              >
                {initial.dataSource === "DEMO" ? <Check className="size-3" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium">Demo data</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                  Five fictional USD invoices with stable due dates. Reminder
                  execution is recorded locally and never claims to reach PayPal.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => switchSource("PAYPAL")}
              disabled={
                busy !== null ||
                !initial.paypalConfigured ||
                initial.dataSource === "PAYPAL"
              }
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-60",
                initial.dataSource === "PAYPAL"
                  ? "border-brand/30 bg-brand-soft"
                  : "border-line hover:bg-canvas",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 items-center justify-center rounded-full border",
                  initial.dataSource === "PAYPAL"
                    ? "border-brand bg-brand text-white"
                    : "border-line",
                )}
              >
                {initial.dataSource === "PAYPAL" ? <Check className="size-3" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium">PayPal Sandbox</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                  Real invoice reads and real Sandbox reminder requests through the
                  PayPal Invoicing API.
                  {!initial.paypalConfigured ? " Add sandbox credentials first." : ""}
                </span>
              </span>
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={resetDemo}
              disabled={busy !== null}
            >
              <RotateCcw className="size-3.5" />
              {busy === "reset" ? "Resetting..." : "Reset demo data"}
            </button>
            <span className="text-[11px] text-muted">
              Current source: {initial.dataSource === "DEMO" ? "Demo" : "PayPal Sandbox"}
            </span>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-success-soft text-success">
              <Webhook className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Webhook endpoint</h2>
              <p className="text-[11px] text-muted">
                Signature verification is mandatory; unverified events are rejected.
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2.5 text-xs">
            <Row label="Webhook ID">
              <Status ok={initial.webhookConfigured}>
                {initial.webhookConfigured ? "Configured" : "Not configured"}
              </Status>
            </Row>
            <Row label="Listener URL">
              <span className="mono break-all">{initial.webhookUrl}</span>
            </Row>
            <Row label="Subscribed events">
              <span className="mono">
                INVOICING.INVOICE.PAID · SENT · CANCELLED · REFUNDED · UPDATED
              </span>
            </Row>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={copyWebhook}>
              <Clipboard className="size-3.5" />
              {copied ? "Copied" : "Copy URL"}
            </button>
            {!initial.webhookConfigured ? (
              <span className="self-center text-[11px] text-muted">
                Set PAYPAL_WEBHOOK_ID after registering a public HTTPS URL.
              </span>
            ) : null}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Local development needs a public HTTPS tunnel (for example{" "}
            <span className="mono">ngrok http 3000</span>). Without a registered
            webhook, the payment lifecycle can still be demonstrated with the
            clearly-labelled <span className="font-medium">Simulate payment</span>{" "}
            button on a demo invoice.
          </p>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-canvas text-muted">
              <Database className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Environment checklist</h2>
              <p className="text-[11px] text-muted">
                No secret values are ever rendered in the browser.
              </p>
            </div>
          </div>

          <ul className="mt-4 space-y-2 text-xs">
            <CheckRow ok={initial.paypalConfigured} label="PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET" />
            <CheckRow ok={initial.webhookConfigured} label="PAYPAL_WEBHOOK_ID" />
            <CheckRow ok={initial.aiConfigured} label="ANTHROPIC_API_KEY" />
            <CheckRow ok label="SQLite persistence (data/paypilot.db)" />
            <CheckRow
              ok={initial.paypalBaseUrl.includes("sandbox")}
              label="Sandbox-only API base URL"
            />
          </ul>

          <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-muted">
            <p className="font-semibold text-ink">AI model</p>
            <p className="mono mt-0.5">{initial.aiConfigured ? initial.model : "Not configured"}</p>
            <p className="mt-1">
              The model receives invoice facts through typed tools only. It has no
              PayPal client access and cannot execute a reminder.
            </p>
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck className="size-3.5 text-success" />
            Environment: {initial.nodeEnv} · sandbox-only guard enabled
          </p>
        </section>
      </div>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Cloud className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Connect PayPal Sandbox in five minutes</h2>
            <p className="text-[11px] text-muted">
              The same steps are in README.md and docs/PAYPAL_SETUP.md.
            </p>
          </div>
        </div>

        <ol className="mt-4 grid gap-3 text-xs leading-relaxed text-muted sm:grid-cols-2">
          <li className="rounded-lg border border-line px-3 py-3">
            <span className="font-semibold text-ink">1. Create a developer account</span>
            <p className="mt-1">
              Sign in at{" "}
              <a
                href="https://developer.paypal.com/dashboard/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand underline"
              >
                developer.paypal.com
              </a>{" "}
              and make sure the dashboard is set to <strong>Sandbox</strong>, not Live.
            </p>
          </li>
          <li className="rounded-lg border border-line px-3 py-3">
            <span className="font-semibold text-ink">2. Create an app</span>
            <p className="mt-1">
              Go to <strong>Apps &amp; Credentials → Create App</strong>. Copy the
              Client ID and Secret into{" "}
              <span className="mono">PAYPAL_CLIENT_ID</span> and{" "}
              <span className="mono">PAYPAL_CLIENT_SECRET</span> in{" "}
              <span className="mono">.env.local</span>.
            </p>
          </li>
          <li className="rounded-lg border border-line px-3 py-3">
            <span className="font-semibold text-ink">3. Use sandbox accounts</span>
            <p className="mt-1">
              Under <strong>Testing Tools → Sandbox Accounts</strong>, use the
              business account as the invoicer and the personal account email as
              the customer. Run{" "}
              <span className="mono">npm run paypal:seed</span> to create demo
              invoices through the real API.
            </p>
          </li>
          <li className="rounded-lg border border-line px-3 py-3">
            <span className="font-semibold text-ink">4. Register the webhook</span>
            <p className="mt-1">
              Expose the app with a public HTTPS URL, add{" "}
              <span className="mono">/api/webhooks/paypal</span> as a webhook, and
              subscribe to the invoice events. Put the webhook ID in{" "}
              <span className="mono">PAYPAL_WEBHOOK_ID</span>.
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
      )}
    >
      <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-warning")} />
      {children}
    </span>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-success" />
      ) : (
        <AlertTriangle className="size-3.5 shrink-0 text-warning" />
      )}
      <span className={ok ? "text-ink" : "text-muted"}>{label}</span>
    </li>
  );
}
