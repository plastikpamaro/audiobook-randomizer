import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deduplicateFeed, maxPaginationPage, parseCsvFeed, parseDreiFragezeichenPage,
  parseJsonFeed, parseRssFeed, parseTkkgPage, stableEpisodeKey,
} from "@/lib/feed-parsers";

describe("Online-Import-Parser", () => {
  it("liest Seiten, Sonderfolgen, Termine und Pagination bei Die drei ???", async () => {
    const html = await readFile(resolve("tests/fixtures/drei-fragezeichen-page.html"), "utf8");
    const feed = parseDreiFragezeichenPage(html, "https://www.dreifragezeichen.de/produktwelt/hoerspiele");
    expect(feed.issues).toEqual([]);
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes[0]).toMatchObject({ numberLabel: "241", sortOrder: 241, releaseDate: "2026-10-24" });
    expect(feed.episodes[0].links.map((link) => link.label)).toContain("Spotify");
    expect(feed.episodes[1]).toMatchObject({ numberLabel: null, title: "Planetarium Special" });
    expect(maxPaginationPage(html, "https://www.dreifragezeichen.de/produktwelt/hoerspiele")).toBe(24);
  });

  it("hält bei TKKG doppelte Nummern über getrennte Detail-URLs auseinander", async () => {
    const html = await readFile(resolve("tests/fixtures/tkkg-page.html"), "utf8");
    const feed = parseTkkgPage(html, "https://www.tkkg.de/produkte/hoerspiele");
    expect(feed.episodes).toHaveLength(2);
    expect(feed.episodes.map((episode) => episode.numberLabel)).toEqual(["239", "239"]);
    expect(new Set(feed.episodes.map((episode) => episode.externalId)).size).toBe(2);
    expect(feed.episodes[0].links[0].label).toBe("Anhören");
    expect(maxPaginationPage(html, "https://www.tkkg.de/produkte/hoerspiele")).toBe(8);
  });

  it("liest das versionierte JSON-Format und meldet ungültige Termine", () => {
    const good = parseJsonFeed(JSON.stringify({ version: 1, episodes: [{ external_id: "x-1", title: "Test", number_label: "7", release_date: "2026-09-05", links: [{ label: "Web", url: "https://example.com/x" }] }] }));
    expect(good.episodes[0]).toMatchObject({ externalId: "x-1", releaseDate: "2026-09-05" });
    expect(parseJsonFeed('{"version":1,"episodes":[{"external_id":"x","title":"T","release_date":"morgen"}]}').issues).toHaveLength(1);
  });

  it("verwendet episode_key im CSV-Feed als externe ID", () => {
    const feed = parseCsvFeed("series_key,series_name,episode_key,title\ntest,Test,folge-1,Start", "2026-09-04");
    expect(feed.issues).toEqual([]);
    expect(feed.episodes[0]).toMatchObject({ externalId: "folge-1", title: "Start" });
  });

  it("liest RSS inklusive GUID, Enclosure, Nummer und Laufzeit", () => {
    const feed = parseRssFeed(`<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><item><guid>urn:episode:123</guid><title>Folge 123: Die Spur</title><pubDate>Fri, 04 Sep 2026 05:00:00 GMT</pubDate><enclosure url="https://cdn.example.com/123.mp3"/><link>https://example.com/123</link><itunes:duration>01:02:30</itunes:duration></item></channel></rss>`);
    expect(feed.issues).toEqual([]);
    expect(feed.episodes[0]).toMatchObject({ externalId: "urn:episode:123", numberLabel: "123", durationMinutes: 63, releaseDate: "2026-09-04" });
    expect(feed.episodes[0].links).toHaveLength(2);
  });

  it("stoppt doppelte externe IDs und erzeugt stabile interne Schlüssel", () => {
    const episode = { externalId: "same", title: "Titel", numberLabel: null, sortOrder: null, releaseDate: null, durationMinutes: null, priorityOnRelease: false, links: [], canonicalUrl: null };
    expect(deduplicateFeed({ episodes: [episode, episode], issues: [], warnings: [] }).issues[0].message).toContain("mehrfach");
    expect(stableEpisodeKey("same", "Ärger im Café")).toBe(stableEpisodeKey("same", "Ärger im Café"));
  });
});
