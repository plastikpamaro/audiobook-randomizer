import { describe, expect, it } from "vitest";
import { parseCsvImport } from "@/lib/csv-import";

const header = "series_key,series_name,episode_key,title,number_label,sort_order,release_date,duration_minutes,priority_on_release,link_label,link_url,archived";

describe("CSV-Import", () => {
  it("führt wiederholte Folgenzeilen zu mehreren Links zusammen", () => {
    const csv = [
      header,
      "test,Testserie,folge-1,Die erste Folge,1,1,2025-01-01,60,false,A,https://example.com/a,false",
      "test,Testserie,folge-1,Die erste Folge,1,1,2025-01-01,60,false,B,https://example.com/b,false",
    ].join("\n");
    const result = parseCsvImport(csv, "2026-09-04");
    expect(result.issues).toEqual([]);
    expect(result.summary).toEqual({ rows: 2, series: 1, episodes: 1, links: 2 });
    expect(result.episodes[0].links).toHaveLength(2);
  });

  it("priorisiert zukünftige Termine standardmäßig und alte nicht", () => {
    const csv = [
      header,
      "test,Testserie,alt,Alt,,,2020-01-01,,,,,",
      "test,Testserie,neu,Neu,,,2030-01-01,,,,,",
    ].join("\n");
    const result = parseCsvImport(csv, "2026-09-04");
    expect(result.issues).toEqual([]);
    expect(result.episodes.find((item) => item.episodeKey === "alt")?.priorityOnRelease).toBe(false);
    expect(result.episodes.find((item) => item.episodeKey === "neu")?.priorityOnRelease).toBe(true);
  });

  it("meldet widersprüchliche Metadaten atomar als Fehler", () => {
    const csv = [
      header,
      "test,Testserie,folge-1,Titel A,,,,,,,,",
      "test,Testserie,folge-1,Titel B,,,,,,,,",
    ].join("\n");
    const result = parseCsvImport(csv, "2026-09-04");
    expect(result.issues[0].message).toContain("widersprüchliche");
  });

  it("akzeptiert Sonderfolgen ohne Nummer", () => {
    const result = parseCsvImport(`${header}\ntest,Testserie,spezial,Spezialfolge,,,,,,,,`, "2026-09-04");
    expect(result.issues).toEqual([]);
    expect(result.episodes[0].numberLabel).toBeNull();
  });
});
