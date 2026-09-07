import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashImportEpisode, importFieldChanges } from "@/lib/import-changes";
import type { NormalizedImportEpisode } from "@/lib/online-import-types";

const episode: NormalizedImportEpisode = {
  externalId: "87", title: "Der böse Geist vom Waisenhaus", numberLabel: "87", sortOrder: 87,
  releaseDate: "1993-01-01", durationMinutes: 45, priorityOnRelease: false,
  links: [{ label: "Hören", url: "https://example.org/87" }, { label: "Infos", url: "https://example.org/info" }], canonicalUrl: "https://example.org/87",
};

describe("inhaltlicher Importvergleich", () => {
  it("reproduziert den alten JSONB-Hashfehler und ignoriert die Feldreihenfolge", () => {
    const stored = Object.fromEntries(Object.entries(episode).reverse()) as unknown as NormalizedImportEpisode;
    const oldHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(oldHash(stored)).not.toBe(oldHash(episode));
    expect(hashImportEpisode(stored)).toBe(hashImportEpisode(episode));
    expect(importFieldChanges(stored, episode)).toEqual({});
  });
  it("ignoriert Linkreihenfolge, verschachtelte Schlüsselreihenfolge und Parserhinweise", () => {
    const incoming = { ...episode, links: episode.links.toReversed().map(({ label, url }) => ({ url, label })), priorityOnRelease: true, canonicalUrl: null };
    expect(hashImportEpisode(incoming)).toBe(hashImportEpisode(episode));
    expect(importFieldChanges(incoming, episode)).toEqual({});
  });
  it("zeigt tatsächliche Titel-, Datums- und Linkänderungen mit beiden Werten", () => {
    const incoming = { ...episode, title: "Korrigierter Titel", releaseDate: "1993-02-01", links: [{ label: "Hören", url: "https://example.org/new" }] };
    expect(hashImportEpisode(incoming)).not.toBe(hashImportEpisode(episode));
    expect(importFieldChanges(incoming, episode)).toEqual({ title: { from: episode.title, to: incoming.title }, releaseDate: { from: episode.releaseDate, to: incoming.releaseDate }, links: { from: episode.links, to: incoming.links } });
  });
  it("löscht keine Metadaten bei fehlenden Angaben, zeigt aber entfernte Quellenlinks", () => {
    const incoming = { ...episode, numberLabel: null, sortOrder: null, releaseDate: null, durationMinutes: null, links: [] };
    expect(importFieldChanges(incoming, episode)).toEqual({ links: { from: episode.links, to: [] } });
  });
});
