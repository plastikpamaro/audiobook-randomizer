import { describe, expect, it } from "vitest";
import { computeStreaks } from "@/lib/stats";

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
