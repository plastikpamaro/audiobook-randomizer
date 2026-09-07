import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { APPLE_CATALOGS, parseAppleCatalog, type AppleCatalogKind } from "@/lib/apple-catalog";

describe("Apple-Music-Serienkataloge", () => {
  it.each(Object.keys(APPLE_CATALOGS) as AppleCatalogKind[])("liest %s ohne Sammelboxen und doppelte Nummern", async (kind) => {
    const input = await readFile(`tests/fixtures/apple-${APPLE_CATALOGS[kind].artistId}.json`, "utf8");
    const feed = parseAppleCatalog(input, kind);
    expect(feed.issues).toEqual([]);
    expect(feed.episodes.length).toBeGreaterThan(30);
    expect(new Set(feed.episodes.map((item) => item.numberLabel)).size).toBe(feed.episodes.length);
    expect(feed.episodes[0].numberLabel).toBe("1");
    expect(feed.episodes.some((item) => /Edition|Ultimative Sammlung/.test(item.title))).toBe(false);
    if (kind === "van_dusen") expect(feed.episodes[0].title).toBe("Eine Unze Radium");
    if (kind === "van_dusen_neue") expect(feed.episodes[0].title).toBe("Professor van Dusen im Spukhaus");
    if (kind === "point_whitmark") expect(feed.episodes.find((item) => item.numberLabel === "10")?.title).toBe("Der Schattenadmiral");
  });

  it("meldet ungültige Antworten und unbekannte Albumformate", () => {
    expect(parseAppleCatalog("invalid", "pater_brown").issues).toHaveLength(1);
    expect(parseAppleCatalog("{}", "pater_brown").issues).toHaveLength(1);
    const feed = parseAppleCatalog(JSON.stringify({ results: [{ wrapperType: "collection", artistId: 876466527, collectionName: "Anderes Format" }] }), "pater_brown");
    expect(feed.issues).toHaveLength(1);
    expect(feed.episodes).toEqual([]);
  });

  it("importiert Titania einschließlich neuer Folgen und fasst vollständige Zweiteiler zusammen", async () => {
    const document = JSON.parse(await readFile("tests/fixtures/apple-469372336.json", "utf8"));
    const feed = parseAppleCatalog(JSON.stringify(document), "sherlock_titania");
    expect(feed.episodes).toHaveLength(73);
    expect(feed.episodes[0].title).toBe("Im Schatten des Rippers");
    expect(feed.episodes.at(-1)).toMatchObject({ numberLabel: "73", title: "Die trügerische Spur", releaseDate: "2026-09-25", priorityOnRelease: true });
    for (const number of ["28", "35", "41"]) {
      const episode = feed.episodes.find((item) => item.numberLabel === number)!;
      expect(episode.externalId).toBe(`titania:episode:${number}`);
      expect(episode.links.map((link) => link.label)).toEqual(["Apple Music – Teil 1", "Apple Music – Teil 2"]);
      expect(episode.title).not.toContain("Teil");
    }
    expect(feed.episodes.some((item) => /Box/.test(item.title))).toBe(false);
    expect(parseAppleCatalog(JSON.stringify({ results: document.results.toReversed() }), "sherlock_titania")).toEqual(feed);
    const incomplete = { results: document.results.filter((item: { collectionName?: string }) => item.collectionName !== "Folge 41: Mayerling (Teil 2 von 2)") };
    const partial = parseAppleCatalog(JSON.stringify(incomplete), "sherlock_titania");
    expect(partial.issues).toHaveLength(1);
    expect(partial.episodes.some((item) => item.numberLabel === "41")).toBe(false);
  });

  it("stoppt bei doppelten Folgen und einem möglicherweise abgeschnittenen Katalog", async () => {
    const document = JSON.parse(await readFile("tests/fixtures/apple-202777371.json", "utf8"));
    const album = document.results.find((item: { wrapperType: string }) => item.wrapperType === "collection");
    document.results.push({ ...album, collectionId: 123 });
    expect(parseAppleCatalog(JSON.stringify(document), "point_whitmark").issues).toHaveLength(1);
    expect(parseAppleCatalog(JSON.stringify({ results: Array(200).fill(album) }), "point_whitmark").issues.some((item) => item.message.includes("Abruflimit"))).toBe(true);
  });
});
