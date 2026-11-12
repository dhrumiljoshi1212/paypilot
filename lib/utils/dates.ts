const DAY_MS = 86_400_000;

/** Parse a PayPal date-only value (`YYYY-MM-DD`) as UTC midnight. */
export function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function todayUtc(now: Date = new Date()): Date {
  return startOfUtcDay(now);
}

/** Whole days past the due date. Due today = 0, yesterday = 1. */
export function daysOverdue(
  dueDate: string | undefined,
  now: Date = new Date(),
): number {
  const due = parseDateOnly(dueDate);
  if (!due) return 0;
  const diff = todayUtc(now).getTime() - startOfUtcDay(due).getTime();
  return diff > 0 ? Math.floor(diff / DAY_MS) : 0;
}

export function isOverdue(
  status: string,
  dueDate: string | undefined,
  now: Date = new Date(),
): boolean {
  if (status === "PAID" || status === "CANCELLED") return false;
  if (status === "DRAFT" || status === "REFUNDED_OR_OTHER") return false;
  const due = parseDateOnly(dueDate);
  if (!due) return false;
  return todayUtc(now).getTime() > startOfUtcDay(due).getTime();
}

export function daysUntil(
  dueDate: string | undefined,
  now: Date = new Date(),
): number | null {
  const due = parseDateOnly(dueDate);
  if (!due) return null;
  return Math.round(
    (startOfUtcDay(due).getTime() - todayUtc(now).getTime()) / DAY_MS,
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isInCurrentUtcMonth(
  value: string | undefined,
  now: Date = new Date(),
): boolean {
  const date = parseDateOnly(value);
  if (!date) return false;
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth()
  );
}

export function formatDate(value?: string): string {
  const date = parseDateOnly(value);
  if (!date) return "No due date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value?: string): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDateTime(value);
}
