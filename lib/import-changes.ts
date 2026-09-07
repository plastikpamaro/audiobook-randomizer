import { createHash } from "node:crypto";
import type { NormalizedImportEpisode, NormalizedImportLink } from "@/lib/online-import-types";

export type ImportFieldChanges = Record<string, { from: unknown; to: unknown }>;

export function normalizedLinks(links: NormalizedImportLink[]): NormalizedImportLink[] {
  return links.map(({ label, url }) => ({ label, url }))
    .sort((a, b) => a.url.localeCompare(b.url) || a.label.localeCompare(b.label));
}

// JSONB does not preserve object-key order. Hash explicit fields, never raw JSON.
// canonicalUrl and priorityOnRelease are parser hints, not editable metadata.
export function hashImportEpisode(episode: NormalizedImportEpisode): string {
  return createHash("sha256").update(JSON.stringify([
    episode.externalId, episode.title, episode.numberLabel, episode.sortOrder,
    episode.releaseDate, episode.durationMinutes, normalizedLinks(episode.links),
  ])).digest("hex");
}

export function importFieldChanges(incoming: NormalizedImportEpisode, current: NormalizedImportEpisode): ImportFieldChanges {
  const changes: ImportFieldChanges = {};
  for (const key of ["title", "numberLabel", "sortOrder", "releaseDate", "durationMinutes"] as const) {
    // Missing source metadata must not erase information already in the library.
    if (incoming[key] !== null && incoming[key] !== current[key]) changes[key] = { from: current[key], to: incoming[key] };
  }
  if (JSON.stringify(normalizedLinks(incoming.links)) !== JSON.stringify(normalizedLinks(current.links))) {
    changes.links = { from: current.links, to: incoming.links };
  }
  return changes;
}
