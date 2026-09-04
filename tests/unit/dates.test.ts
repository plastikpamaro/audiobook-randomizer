import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";

describe("localDate", () => {
  it("verwendet den Berliner Kalendertag an UTC-Grenzen", () => {
    expect(localDate(new Date("2026-03-28T23:30:00Z"), "Europe/Berlin")).toBe("2026-03-29");
    expect(localDate(new Date("2026-10-24T22:30:00Z"), "Europe/Berlin")).toBe("2026-10-25");
  });
});
