import { getAppTimezone } from "@/lib/env";

export function localDate(date = new Date(), timeZone = getAppTimezone()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function isoDateTime(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function formatDate(value: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeZone: getAppTimezone(),
    ...options,
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
