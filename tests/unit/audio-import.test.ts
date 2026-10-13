import { describe, expect, it } from "vitest";
// @ts-expect-error CLI module is plain JavaScript.
import { planAudioImport } from "../../scripts/import-audio.mjs";

const catalog = [
  { id: "d0e9df18-3c25-42b6-819e-6cf7a180ddd1", numberLabel: "2", title: "und der Phantomsee" },
  { id: "95102597-d6c0-40fc-a114-460c91e95927", numberLabel: "11", title: "und das Gespensterschloß" },
];

describe("Originaldateien zuordnen", () => {
  it("ordnet führende Nullen zu und toleriert doppelte Wörter im Dateinamen", () => {
    const plan = planAudioImport(["002 - und der Phantomsee.mp3", "011 - und das das Gespensterschloß.mp3"], catalog);
    expect(plan.map((item: { episodeId: string }) => item.episodeId)).toEqual(catalog.map((episode) => episode.id));
  });
  it("stoppt bei falschem Titel, fehlender oder mehrdeutiger Nummer und doppelten Dateien", () => {
    expect(() => planAudioImport(["002 - Falsche Folge.mp3"], catalog)).toThrow("Titelkonflikt");
    expect(() => planAudioImport(["003 - Unbekannt.mp3"], catalog)).toThrow("nicht eindeutig");
    expect(() => planAudioImport(["002 - und der Phantomsee.mp3"], [...catalog, catalog[0]])).toThrow("nicht eindeutig");
    expect(() => planAudioImport(["002 - und der Phantomsee.mp3", "2 - und der Phantomsee.mp3"], catalog)).toThrow("Mehrere Dateien");
  });
});
