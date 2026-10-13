import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

function normalizeTitle(title) {
  return title.toLocaleLowerCase("de").normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()
    .replace(/\b(\p{L}+)\s+\1\b/gu, "$1");
}

export function planAudioImport(filenames, catalog) {
  const plan = [];
  const assigned = new Set();
  for (const filename of filenames.filter((name) => /\.mp3$/i.test(name)).sort()) {
    const match = /^(\d+)\s*[-–]\s*(.+)\.mp3$/i.exec(filename);
    if (!match) throw new Error(`Keine Folgennummer im Dateinamen: ${filename}`);
    const number = Number(match[1]);
    const candidates = catalog.filter((episode) => /^\d+$/.test(episode.numberLabel ?? "") && Number(episode.numberLabel) === number);
    if (candidates.length !== 1) throw new Error(`Folge ${number} ist im Katalog nicht eindeutig vorhanden.`);
    const episode = candidates[0];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(episode.id)) throw new Error("Ungültige Folgen-ID im Katalog.");
    if (assigned.has(episode.id)) throw new Error(`Mehrere Dateien für Folge ${number}.`);
    if (normalizeTitle(match[2]) !== normalizeTitle(episode.title)) {
      throw new Error(`Titelkonflikt bei Folge ${number}: „${match[2]}“ / „${episode.title}“.`);
    }
    assigned.add(episode.id);
    plan.push({ filename, episodeId: episode.id, number, title: episode.title });
  }
  if (!plan.length) throw new Error("Keine nummerierten MP3-Dateien gefunden.");
  return plan;
}

export async function importAudio(sourceDirectory, catalogPath, outputDirectory = "data/audio") {
  const source = resolve(sourceDirectory);
  const output = resolve(outputDirectory);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const entries = await readdir(source, { withFileTypes: true });
  const plan = planAudioImport(entries.filter((entry) => entry.isFile()).map((entry) => entry.name), catalog);
  await mkdir(output, { recursive: true });
  const manifest = [];
  for (const item of plan) {
    const from = join(source, item.filename);
    const to = join(output, `${item.episodeId}.mp3`);
    const original = await readFile(from);
    if (!original.length || !(original.subarray(0, 3).toString() === "ID3" || (original[0] === 0xff && (original[1] & 0xe0) === 0xe0))) {
      throw new Error(`Die Datei hat keinen MP3-Header: ${item.filename}`);
    }
    const sha256 = createHash("sha256").update(original).digest("hex");
    try {
      await copyFile(from, to, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = createHash("sha256").update(await readFile(to)).digest("hex");
      if (existing !== sha256) throw new Error(`Für Folge ${item.number} liegt bereits eine andere Datei vor.`);
    }
    manifest.push({ ...item, bytes: original.length, sha256 });
  }
  await writeFile(join(output, "import-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, catalog, output] = process.argv.slice(2);
  if (!source || !catalog) {
    console.error('Aufruf: npm run audio:import -- "MP3-Ordner" katalog.json [Zielordner]');
    process.exitCode = 1;
  } else {
    const manifest = await importAudio(source, catalog, output);
    console.log(`${manifest.length} Originalfassungen zugeordnet und unverändert kopiert (${Math.round(manifest.reduce((sum, item) => sum + item.bytes, 0) / 1024 / 1024)} MiB).`);
  }
}
