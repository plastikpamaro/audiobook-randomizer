import { describe, expect, it } from "vitest";
import { APPLE_CATALOGS, type AppleCatalogKind } from "@/lib/apple-catalog";
import { fetchImportFeed } from "@/lib/online-import-fetch";

describe.skipIf(process.env.LIVE_IMPORT_TEST !== "1")("Apple-Kataloge live", () => {
  it.each(Object.keys(APPLE_CATALOGS) as AppleCatalogKind[])("ruft %s sicher ab", async (kind) => {
    const result = await fetchImportFeed({ kind, url: null }, false);
    expect(result.notModified).toBe(false);
    expect(result.feed?.issues).toEqual([]);
    expect(result.feed!.episodes.length).toBeGreaterThan(30);
  }, 30_000);
});
