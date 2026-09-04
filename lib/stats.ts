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
