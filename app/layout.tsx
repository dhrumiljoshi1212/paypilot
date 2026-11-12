import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getConfig } from "@/lib/env";
import { getDataSource } from "@/lib/services/invoice-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "PayPilot — AI accounts receivable for PayPal invoices",
    template: "%s · PayPilot",
  },
  description:
    "Ask an AI agent to find overdue PayPal invoices, review a personalized reminder, approve it, and send it through the PayPal Sandbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const mode = getDataSource() === "PAYPAL" ? "PAYPAL" : "DEMO";

  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">
        <AppShell mode={mode} aiConfigured={config.aiConfigured}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
