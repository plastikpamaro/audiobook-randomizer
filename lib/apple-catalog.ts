import type { ImportSourceKind, ParsedImportFeed } from "@/lib/online-import-types";

export const APPLE_CATALOGS = {
  van_dusen: { artistId: 626774221, newCases: false },
  van_dusen_neue: { artistId: 626774221, newCases: true },
  point_whitmark: { artistId: 202777371, newCases: false },
  pater_brown: { artistId: 876466527, newCases: false },
  sherlock_titania: { artistId: 469372336, newCases: false },
  sherlock_original: { artistId: 1553808878, newCases: false },
  sherlock_reloaded: { artistId: 1553810025, newCases: false },
  // This artist only contains new cases; some albums omit the series suffix.
  sherlock_neue: { artistId: 1553809713, newCases: null },
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
  const multipart = new Map<string, { total: number; parts: Map<number, ParsedImportFeed["episodes"][number]> }>();
  for (const item of albums) {
    if (item.artistId !== config.artistId) continue;
    const name = typeof item.collectionName === "string" ? item.collectionName.trim() : "";
    if (kind === "sherlock_titania" && /(?:^Box\s+\d+\b|\(Box\s+\d+\))/i.test(name)) continue;
    // Collections repeat existing episodes and must never become separate draws.
    if (/^(?:(?:Die (?:alten|neuen) Fälle(?: \(Reloaded\))?|Die Originale)\s*[:,–-]\s*)?(?:Ultimative Sammlung\b|Edition\s+\d+|Collector['’]s Box\s+\d+|Box\s+\d+)/i.test(name)) continue;
    if (kind === "sherlock_original" && /\(Live-Edition\)$/i.test(name)) continue;
    const newCases = /Die neuen Fälle/i.test(name);
    if (config.newCases !== null && newCases !== config.newCases) continue;
    let cleaned = name.replace(/^Die neuen Fälle,\s*/i, "").replace(/\s*\((?:Die neuen Fälle|Ungekürzt)\)\s*$/i, "");
    if (kind === "sherlock_original") {
      cleaned = cleaned.replace(/^Die Originale\s*[-,]\s*/i, "").replace(/\s*\(Die Originale\)$/i, "");
    } else if (kind === "sherlock_reloaded") {
      cleaned = cleaned.replace(/^Die alten Fälle \(Reloaded\),\s*/i, "")
        .replace(/\s*(?:\(Die alten Fälle\)\s*\[Reloaded\]|\(Die alten Fälle: Reloaded\)|\(Die alten Fälle \(Reloaded\)\))$/i, "");
    }
    const match = cleaned.match(/^(?:(?:Folge|Fall)\s+)?0*(\d+)\s*[:/]\s*(.+)$/i);
    let url: URL;
    try { url = new URL(item.collectionViewUrl); } catch { url = new URL("https://invalid.example"); }
    if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(item.collectionId) || item.collectionId < 1 || url.protocol !== "https:" || url.hostname !== "music.apple.com") {
      feed.issues.push({ item: name || "Album", message: "Folgenummer, Titel oder stabile Albumkennung fehlt." });
      continue;
    }
    const number = String(Number(match[1]));
    const part = kind === "sherlock_titania" ? match[2].match(/\s*\(Teil (\d+) von (\d+)\)$/i) : null;
    if (numbers.has(number) && !part) {
      feed.issues.push({ item: name, message: `Mehrere Alben für Folge ${number}; bitte Quelle prüfen.` });
      continue;
    }
    numbers.add(number);
    const date = typeof item.releaseDate === "string" ? item.releaseDate.slice(0, 10) : "";
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
    const episode = {
      externalId: kind === "sherlock_titania" ? `titania:episode:${number}` : `itunes:collection:${item.collectionId}`, title: match[2].trim(),
      numberLabel: number, sortOrder: Number(number), releaseDate: validDate ? date : null,
      durationMinutes: null, priorityOnRelease: validDate,
      canonicalUrl: url.href, links: [{ label: "Apple Music", url: url.href }],
    };
    if (part) {
      episode.title = match[2].slice(0, part.index).trim();
      const partNumber = Number(part[1]);
      const total = Number(part[2]);
      const group = multipart.get(number) || { total, parts: new Map() };
      if (total < 2 || total > 20 || partNumber < 1 || partNumber > total || group.total !== total || group.parts.has(partNumber)) {
        feed.issues.push({ item: name, message: "Ungültige oder doppelte Teilfolge." });
        continue;
      }
      episode.links[0].label = `Apple Music – Teil ${partNumber}`;
      group.parts.set(partNumber, episode);
      multipart.set(number, group);
    } else feed.episodes.push(episode);
  }
  for (const [number, group] of multipart) {
    const parts = [...group.parts.entries()].sort(([a], [b]) => a - b).map(([, episode]) => episode);
    if (parts.length !== group.total || parts.some((part) => part.title !== parts[0].title || part.releaseDate !== parts[0].releaseDate) || feed.episodes.some((episode) => episode.numberLabel === number)) {
      feed.issues.push({ item: `Folge ${number}`, message: "Die Teilfolgen sind unvollständig oder widersprüchlich." });
      continue;
    }
    feed.episodes.push({ ...parts[0], links: parts.flatMap((part) => part.links) });
  }
  feed.episodes.sort((a, b) => a.sortOrder! - b.sortOrder!);
  return feed;
}
