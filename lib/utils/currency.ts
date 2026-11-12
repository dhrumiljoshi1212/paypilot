import type { CurrencyTotals } from "@/lib/types";

export function addToTotals(
  totals: CurrencyTotals,
  currency: string,
  amount: number,
): void {
  const code = currency || "USD";
  totals[code] = (totals[code] ?? 0) + amount;
}

/** Never sum across currencies. Returns `null` when no values exist. */
export function formatTotals(totals: CurrencyTotals): string | null {
  const entries = Object.entries(totals).filter(([, value]) => value !== 0);
  if (entries.length === 0) return null;
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => formatMoney(value, currency))
    .join(" + ");
}

export function formatMoney(
  amount: number,
  currency = "USD",
  options?: { compact?: boolean },
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: options?.compact && Math.abs(amount) >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: options?.compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function parseAmount(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
