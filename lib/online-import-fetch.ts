import {
  deduplicateFeed,
  maxPaginationPage,
  parseCsvFeed,
  parseDreiFragezeichenPage,
  parseJsonFeed,
  parseRssFeed,
  parseTkkgPage,
  parseTkkgRetroCatalog,
} from "@/lib/feed-parsers";
import { localDate } from "@/lib/dates";
import { AppError } from "@/lib/app-error";
import type { ImportSourceKind, ParsedImportFeed } from "@/lib/online-import-types";
import { safeFetchText } from "@/lib/safe-fetch";

const BUILTIN_URLS: Record<"drei_fragezeichen" | "tkkg", string> = {
  drei_fragezeichen: "https://www.dreifragezeichen.de/produktwelt/hoerspiele",
  tkkg: "https://www.tkkg.de/produkte/hoerspiele",
};

const TKKG_RETRO_CATALOG_URL = "https://itunes.apple.com/lookup?id=1442197513&entity=album&limit=200&country=DE";

export interface FetchedImportFeed {
  feed: ParsedImportFeed | null;
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
}

function mergeFeeds(feeds: ParsedImportFeed[]): ParsedImportFeed {
  return deduplicateFeed({
    episodes: feeds.flatMap((feed) => feed.episodes),
    issues: feeds.flatMap((feed) => feed.issues),
    warnings: feeds.flatMap((feed) => feed.warnings),
  });
}

async function fetchOfficial(
  kind: "drei_fragezeichen" | "tkkg",
  validators?: { etag?: string | null; lastModified?: string | null },
): Promise<FetchedImportFeed> {
  const rootUrl = BUILTIN_URLS[kind];
  const first = await safeFetchText(rootUrl, validators);
  if (first.status === 304) {
    return { feed: null, notModified: true, etag: first.etag, lastModified: first.lastModified, finalUrl: first.url };
  }
  if (!first.body) throw new AppError("Der offizielle Katalog ist leer.", 502, "IMPORT_EMPTY_RESPONSE");
  const parsePage = kind === "drei_fragezeichen" ? parseDreiFragezeichenPage : parseTkkgPage;
  const pageCount = maxPaginationPage(first.body, first.url);
  const feeds = [parsePage(first.body, first.url)];
  for (let page = 2; page <= pageCount; page += 3) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(3, pageCount - page + 1) }, (_, index) => {
        const url = new URL(rootUrl);
        url.searchParams.set("page", String(page + index));
        return safeFetchText(url.href);
      }),
    );
    for (const result of batch) {
      if (result.body) feeds.push(parsePage(result.body, result.url));
    }
  }
  if (kind === "tkkg") {
    const retro = await safeFetchText(TKKG_RETRO_CATALOG_URL);
    if (!retro.body) throw new AppError("Das TKKG Retro-Archiv ist leer.", 502, "IMPORT_EMPTY_RESPONSE");
    feeds.push(parseTkkgRetroCatalog(retro.body));
  }
  return {
    feed: mergeFeeds(feeds),
    notModified: false,
    etag: first.etag,
    lastModified: first.lastModified,
    finalUrl: first.url,
  };
}

export async function fetchImportFeed(
  source: { kind: ImportSourceKind; url: string | null; etag?: string | null; lastModified?: string | null },
  conditional = true,
): Promise<FetchedImportFeed> {
  const validators = conditional ? { etag: source.etag, lastModified: source.lastModified } : undefined;
  if (source.kind === "drei_fragezeichen" || source.kind === "tkkg") {
    return fetchOfficial(source.kind, validators);
  }
  if (!source.url) throw new AppError("Der Quelle fehlt eine URL.", 422, "SOURCE_URL_MISSING");
  const result = await safeFetchText(source.url, validators);
  if (result.status === 304) {
    return { feed: null, notModified: true, etag: result.etag, lastModified: result.lastModified, finalUrl: result.url };
  }
  if (!result.body) throw new AppError("Die Quelle ist leer.", 502, "IMPORT_EMPTY_RESPONSE");
  const feed = source.kind === "json"
    ? parseJsonFeed(result.body)
    : source.kind === "csv"
      ? parseCsvFeed(result.body, localDate())
      : parseRssFeed(result.body);
  return {
    feed: deduplicateFeed(feed),
    notModified: false,
    etag: result.etag,
    lastModified: result.lastModified,
    finalUrl: result.url,
  };
}

export function builtInSourceUrl(kind: ImportSourceKind): string | null {
  return kind === "drei_fragezeichen" || kind === "tkkg" ? BUILTIN_URLS[kind] : null;
}
