import { describe, expect, it } from "vitest";
import { seriesCreateSchema } from "@/lib/validation";

describe("Serien über Folgenanzahl anlegen", () => {
  it("braucht nur Name und Anzahl und erhält bestehende API-Eingaben", () => {
    expect(seriesCreateSchema.parse({ name: "TKKG", episodeCount: 250 })).toMatchObject({ name: "TKKG", episodeCount: 250 });
    expect(seriesCreateSchema.parse({ name: "Leer", seriesKey: "leer" }).episodeCount).toBe(0);
  });
  it.each([-1, 1.5, 10001, "20", null])("weist ungültige Anzahl %s zurück", (episodeCount) => {
    expect(seriesCreateSchema.safeParse({ name: "Test", episodeCount }).success).toBe(false);
  });
});
