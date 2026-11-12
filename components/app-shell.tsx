"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ModePill } from "./badges";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/agent", label: "AI Agent", icon: Sparkles },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  mode,
  aiConfigured,
  children,
}: {
  mode: "DEMO" | "PAYPAL";
  aiConfigured: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-white">
            <Waypoints className="size-5" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-none tracking-tight">
              PayPilot
            </span>
            <span className="mt-1 block text-[11px] text-muted">
              Accounts receivable
            </span>
          </span>
        </Link>

        <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-canvas hover:text-ink",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="m-3 rounded-lg border border-line bg-canvas p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <ShieldCheck className="size-4 text-success" />
            Human approval required
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            PayPilot drafts reminders. It never sends a customer-facing action
            without your review and approval.
          </p>
        </div>

        <div className="border-t border-line px-4 py-3 text-[11px] text-muted">
          <div className="flex items-center justify-between">
            <span>Setup</span>
            <span
              className={cn(
                "flex items-center gap-1.5 font-medium",
                aiConfigured ? "text-success" : "text-warning",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  aiConfigured ? "bg-success" : "bg-warning",
                )}
              />
              {aiConfigured ? "AI ready" : "AI key missing"}
            </span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white">
                <Waypoints className="size-4" />
              </span>
              <span className="text-sm font-semibold">PayPilot</span>
            </div>

            <div className="hidden items-center gap-2 text-xs text-muted lg:flex">
              <span className="font-medium text-ink">
                {mode === "PAYPAL" ? "Sandbox workspace" : "Demo workspace"}
              </span>
              <span className="text-line">/</span>
              <span>
                {mode === "PAYPAL"
                  ? "Reads invoices from PayPal Sandbox"
                  : "Fictional sample invoices"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <ModePill mode={mode} />
              <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted sm:inline-flex">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    aiConfigured ? "bg-success" : "bg-warning",
                  )}
                />
                {aiConfigured ? "Agent online" : "Manual mode"}
              </span>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-line px-2 py-2 lg:hidden">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:bg-canvas",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>

        <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 pb-8 text-[11px] text-muted sm:px-6 lg:px-8">
          <span>
            PayPilot is a hackathon project. Sandbox data only — no real money
            moves through this app.
          </span>
          <span>Not affiliated with or endorsed by PayPal.</span>
        </footer>
      </div>
    </div>
  );
}
