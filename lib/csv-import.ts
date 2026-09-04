import { parse } from "csv-parse/sync";
import { keySchema } from "@/lib/validation";

export interface CsvImportIssue {
  row: number;
  field?: string;
  message: string;
}

export interface CsvImportLink {
  label: string;
  url: string;
}

export interface CsvImportEpisode {
  seriesKey: string;
  seriesName: string;
  episodeKey: string;
  title: string;
  numberLabel: string | null;
  sortOrder: number | null;
  releaseDate: string | null;
  durationMinutes: number | null;
  priorityOnRelease: boolean;
  archived: boolean;
  links: CsvImportLink[];
}

export interface CsvImportPreview {
  episodes: CsvImportEpisode[];
  issues: CsvImportIssue[];
  summary: { rows: number; series: number; episodes: number; links: number };
}

const requiredHeaders = ["series_key", "series_name", "episode_key", "title"];

function parseBoolean(value: string, fallback: boolean): boolean | null {
  if (!value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "ja", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "nein", "n"].includes(normalized)) return false;
  return null;
}

function parsePositiveInteger(value: string): number | null | "invalid" {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim()) || Number(value) <= 0) return "invalid";
  return Number(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseCsvImport(csv: string, today: string): CsvImportPreview {
  const issues: CsvImportIssue[] = [];
  let rows: Record<string, string>[] = [];
  try {
    rows = parse(csv.replace(/^\uFEFF/, ""), {
      columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    });
  } catch (error) {
    return {
      episodes: [],
      issues: [{ row: 1, message: error instanceof Error ? error.message : "CSV konnte nicht gelesen werden." }],
      summary: { rows: 0, series: 0, episodes: 0, links: 0 },
    };
  }

  if (!rows.length) {
    return {
      episodes: [],
      issues: [{ row: 1, message: "Die CSV-Datei enthält keine Datenzeilen." }],
      summary: { rows: 0, series: 0, episodes: 0, links: 0 },
    };
  }

  const headers = Object.keys(rows[0]);
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) issues.push({ row: 1, field: header, message: `Pflichtspalte ${header} fehlt.` });
  }
  if (issues.length) {
    return { episodes: [], issues, summary: { rows: rows.length, series: 0, episodes: 0, links: 0 } };
  }

  const grouped = new Map<string, CsvImportEpisode>();
  const seriesNames = new Map<string, string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const seriesKey = row.series_key || "";
    const episodeKey = row.episode_key || "";
    const seriesKeyResult = keySchema.safeParse(seriesKey);
    const episodeKeyResult = keySchema.safeParse(episodeKey);
    if (!seriesKeyResult.success) issues.push({ row: rowNumber, field: "series_key", message: seriesKeyResult.error.issues[0].message });
    if (!episodeKeyResult.success) issues.push({ row: rowNumber, field: "episode_key", message: episodeKeyResult.error.issues[0].message });
    if (!(row.series_name || "").trim()) issues.push({ row: rowNumber, field: "series_name", message: "Serienname fehlt." });
    if (!(row.title || "").trim()) issues.push({ row: rowNumber, field: "title", message: "Titel fehlt." });

    const sortOrder = parsePositiveInteger(row.sort_order || "");
    const duration = parsePositiveInteger(row.duration_minutes || "");
    if (sortOrder === "invalid") issues.push({ row: rowNumber, field: "sort_order", message: "Muss eine positive ganze Zahl sein." });
    if (duration === "invalid") issues.push({ row: rowNumber, field: "duration_minutes", message: "Muss eine positive ganze Zahl sein." });

    const releaseDate = (row.release_date || "").trim();
    if (releaseDate && !validDate(releaseDate)) {
      issues.push({ row: rowNumber, field: "release_date", message: "Datum muss im Format JJJJ-MM-TT vorliegen." });
    }
    const priority = parseBoolean(row.priority_on_release || "", Boolean(releaseDate && releaseDate > today));
    const archived = parseBoolean(row.archived || "", false);
    if (priority === null) issues.push({ row: rowNumber, field: "priority_on_release", message: "Ungültiger Wahrheitswert." });
    if (archived === null) issues.push({ row: rowNumber, field: "archived", message: "Ungültiger Wahrheitswert." });

    const linkLabel = (row.link_label || "").trim();
    const linkUrl = (row.link_url || "").trim();
    if (Boolean(linkLabel) !== Boolean(linkUrl)) {
      issues.push({ row: rowNumber, field: "link_url", message: "Link-Name und Link-URL müssen gemeinsam gesetzt sein." });
    }
    if (linkUrl) {
      try {
        const parsedUrl = new URL(linkUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
      } catch {
        issues.push({ row: rowNumber, field: "link_url", message: "Nur gültige HTTP(S)-Links sind erlaubt." });
      }
    }
    if (issues.some((issue) => issue.row === rowNumber)) return;

    const knownSeriesName = seriesNames.get(seriesKey);
    if (knownSeriesName && knownSeriesName !== row.series_name.trim()) {
      issues.push({ row: rowNumber, field: "series_name", message: "Derselbe Serien-Schlüssel verwendet mehrere Namen." });
      return;
    }
    seriesNames.set(seriesKey, row.series_name.trim());

    const groupKey = `${seriesKey}/${episodeKey}`;
    const next: CsvImportEpisode = {
      seriesKey,
      seriesName: row.series_name.trim(),
      episodeKey,
      title: row.title.trim(),
      numberLabel: (row.number_label || "").trim() || null,
      sortOrder: sortOrder === "invalid" ? null : sortOrder,
      releaseDate: releaseDate || null,
      durationMinutes: duration === "invalid" ? null : duration,
      priorityOnRelease: priority ?? false,
      archived: archived ?? false,
      links: linkUrl ? [{ label: linkLabel, url: linkUrl }] : [],
    };
    const existing = grouped.get(groupKey);
    if (existing) {
      const comparableFields: Array<keyof CsvImportEpisode> = [
        "seriesName", "title", "numberLabel", "sortOrder", "releaseDate",
        "durationMinutes", "priorityOnRelease", "archived",
      ];
      if (comparableFields.some((field) => existing[field] !== next[field])) {
        issues.push({ row: rowNumber, message: "Wiederholte Folge enthält widersprüchliche Metadaten." });
        return;
      }
      for (const link of next.links) {
        if (!existing.links.some((item) => item.label === link.label && item.url === link.url)) existing.links.push(link);
      }
    } else {
      grouped.set(groupKey, next);
    }
  });

  const episodes = [...grouped.values()];
  return {
    episodes,
    issues,
    summary: {
      rows: rows.length,
      series: new Set(episodes.map((episode) => episode.seriesKey)).size,
      episodes: episodes.length,
      links: episodes.reduce((sum, episode) => sum + episode.links.length, 0),
    },
  };
}
