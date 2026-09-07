import type { ImportSourceKind, ParsedImportFeed } from "@/lib/online-import-types";

export const APPLE_CATALOGS = {
  van_dusen: { artistId: 626774221, newCases: false },
  van_dusen_neue: { artistId: 626774221, newCases: true },
  point_whitmark: { artistId: 202777371, newCases: false },
  pater_brown: { artistId: 876466527, newCases: false },
} as const;

export type AppleCatalogKind = keyof typeof APPLE_CATALOGS;

export function isAppleCatalog(kind: ImportSourceKind): kind is AppleCatalogKind {
  return Object.hasOwn(APPLE_CATALOGS, kind);
}

export function appleCatalogUrl(kind: AppleCatalogKind): string {
  return `https://itunes.apple.com/lookup?id=${APPLE_CATALOGS[kind].artistId}&entity=album&limit=200&country=DE`;
}

export function parseAppleCatalog(input: string, kind: AppleCatalogKind): ParsedImportFeed {
  const feed: ParsedImportFeed = { episodes: [], issues: [], warnings: [] };
  let document;
  try { document = JSON.parse(input); } catch {
    feed.issues.push({ item: "Katalog", message: "Ungültiges JSON." });
    return feed;
  }
  if (!Array.isArray(document?.results)) {
    feed.issues.push({ item: "Katalog", message: "Die Albumliste fehlt." });
    return feed;
  }
  const config = APPLE_CATALOGS[kind];
  const albums = document.results.filter((item: Record<string, unknown> | null) => item?.wrapperType === "collection");
  if (albums.length >= 200) feed.issues.push({ item: "Katalog", message: "Das Abruflimit wurde erreicht; die Vollständigkeit muss geprüft werden." });
  const numbers = new Set<string>();
  for (const item of albums) {
    if (item.artistId !== config.artistId) continue;
    const name = typeof item.collectionName === "string" ? item.collectionName.trim() : "";
    // Collections repeat existing episodes and must never become separate draws.
    if (/^(?:Die neuen Fälle:\s*)?Ultimative Sammlung\b|^Edition\s+\d+/i.test(name)) continue;
    const newCases = /Die neuen Fälle/i.test(name);
    if (newCases !== config.newCases) continue;
    const cleaned = name.replace(/^Die neuen Fälle,\s*/i, "").replace(/\s*\((?:Die neuen Fälle|Ungekürzt)\)\s*$/i, "");
    const match = cleaned.match(/^(?:(?:Folge|Fall)\s+)?0*(\d+)\s*[:/]\s*(.+)$/i);
    let url: URL;
    try { url = new URL(item.collectionViewUrl); } catch { url = new URL("https://invalid.example"); }
    if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(item.collectionId) || item.collectionId < 1 || url.protocol !== "https:" || url.hostname !== "music.apple.com") {
      feed.issues.push({ item: name || "Album", message: "Folgenummer, Titel oder stabile Albumkennung fehlt." });
      continue;
    }
    const number = String(Number(match[1]));
    if (numbers.has(number)) {
      feed.issues.push({ item: name, message: `Mehrere Alben für Folge ${number}; bitte Quelle prüfen.` });
      continue;
    }
    numbers.add(number);
    const date = typeof item.releaseDate === "string" ? item.releaseDate.slice(0, 10) : "";
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    feed.episodes.push({
      externalId: `itunes:collection:${item.collectionId}`, title: match[2].trim(),
      numberLabel: number, sortOrder: Number(number), releaseDate: validDate ? date : null,
      durationMinutes: null, priorityOnRelease: validDate,
      canonicalUrl: url.href, links: [{ label: "Apple Music", url: url.href }],
    });
  }
  feed.episodes.sort((a, b) => a.sortOrder! - b.sortOrder!);
  return feed;
}
