import type { ActivityPoint } from "@/lib/types";

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function computeStreaks(daysInput: string[], today: string): { current: number; longest: number } {
  const days = [...new Set(daysInput)].sort();
  if (!days.length) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < days.length; index += 1) {
    if (dayNumber(days[index]) - dayNumber(days[index - 1]) === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
  }

  const last = dayNumber(days.at(-1)!);
  const now = dayNumber(today);
  if (last !== now && last !== now - 1) return { current: 0, longest };

  let current = 1;
  for (let index = days.length - 1; index > 0; index -= 1) {
    if (dayNumber(days[index]) - dayNumber(days[index - 1]) !== 1) break;
    current += 1;
  }
  return { current, longest };
}
/** Include every calendar day, even when the events query returns no row. */
export function fillActivityDays(points: ActivityPoint[], from: string, to: string): ActivityPoint[] {
  const byDay = new Map(points.map((point) => [point.bucket, point]));
  const result: ActivityPoint[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // UTC calendar arithmetic avoids skipping or repeating days at DST changes.
  while (day <= end) {
    const bucket = day.toISOString().slice(0, 10);
    result.push(byDay.get(bucket) ?? { bucket, heard: 0, skipped: 0, minutes: 0 });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return result;
}
