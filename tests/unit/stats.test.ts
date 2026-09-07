import { describe, expect, it } from "vitest";
import { computeStreaks, fillActivityDays } from "@/lib/stats";

describe("lückenlose Aktivitätszeitreihe", () => {
  it("zeigt am 05.09. null zwischen zwei Tagen mit jeweils zwei gehörten Folgen", () => {
    const points = [
      { bucket: "2026-09-06", heard: 2, skipped: 1, minutes: 90 },
      { bucket: "2026-09-04", heard: 2, skipped: 0, minutes: 100 },
    ];
    expect(fillActivityDays(points, "2026-09-04", "2026-09-06")).toEqual([
      points[1], { bucket: "2026-09-05", heard: 0, skipped: 0, minutes: 0 }, points[0],
    ]);
  });

  it("füllt auch leere Tage am Anfang und Ende des gewählten Zeitraums", () => {
    const point = { bucket: "2026-09-05", heard: 0, skipped: 2, minutes: 0 };
    expect(fillActivityDays([point], "2026-09-04", "2026-09-06")).toEqual([
      { bucket: "2026-09-04", heard: 0, skipped: 0, minutes: 0 }, point,
      { bucket: "2026-09-06", heard: 0, skipped: 0, minutes: 0 },
    ]);
  });

  it("zeigt einen vollständig leeren Zeitraum mit Nullwerten", () => {
    expect(fillActivityDays([], "2026-09-05", "2026-09-05")).toEqual([
      { bucket: "2026-09-05", heard: 0, skipped: 0, minutes: 0 },
    ]);
  });

  it.each([
    ["2024-02-28", "2024-03-01", ["2024-02-28", "2024-02-29", "2024-03-01"]],
    ["2026-03-28", "2026-03-30", ["2026-03-28", "2026-03-29", "2026-03-30"]],
    ["2026-10-24", "2026-10-26", ["2026-10-24", "2026-10-25", "2026-10-26"]],
    ["2026-12-31", "2027-01-01", ["2026-12-31", "2027-01-01"]],
  ])("erhält Kalendertage von %s bis %s", (from, to, days) => {
    expect(fillActivityDays([], from, to).map((point) => point.bucket)).toEqual(days);
  });
});

describe("computeStreaks", () => {
  it("berechnet aktuelle und längste Serie über unsortierte Duplikate", () => {
    expect(computeStreaks([
      "2026-08-25", "2026-08-24", "2026-08-24", "2026-09-02", "2026-09-03",
    ], "2026-09-04")).toEqual({ current: 2, longest: 2 });
  });

  it("setzt einen zu alten aktuellen Streak auf null", () => {
    expect(computeStreaks(["2026-08-01", "2026-08-02", "2026-08-03"], "2026-09-04"))
      .toEqual({ current: 0, longest: 3 });
  });
});
