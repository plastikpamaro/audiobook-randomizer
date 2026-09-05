import { describe, expect, it } from "vitest";
import { fetchImportFeed } from "@/lib/online-import-fetch";

describe.skipIf(process.env.LIVE_IMPORT_TEST !== "1")("optionaler Live-Smoke-Test der offiziellen Kataloge", () => {
  it.each(["drei_fragezeichen", "tkkg"] as const)("liest %s ohne Katalogänderungen", async (kind) => {
    const result = await fetchImportFeed({ kind, url: null }, false);
    expect(result.feed?.issues).toEqual([]);
    expect(result.feed?.episodes.length).toBeGreaterThan(100);
    expect(new Set(result.feed?.episodes.map((episode) => episode.externalId)).size).toBe(result.feed?.episodes.length);
  }, 120_000);
});
