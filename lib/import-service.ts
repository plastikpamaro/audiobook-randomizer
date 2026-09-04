import "server-only";

import { transaction } from "@/lib/db";
import { localDate } from "@/lib/dates";
import { AppError } from "@/lib/http";
import { parseCsvImport, type CsvImportPreview } from "@/lib/csv-import";

export function previewCsv(csv: string): CsvImportPreview {
  return parseCsvImport(csv, localDate());
}

export async function commitCsv(csv: string): Promise<CsvImportPreview["summary"]> {
  const preview = previewCsv(csv);
  if (preview.issues.length) {
    throw new AppError("Der Import enthält Fehler.", 422, "IMPORT_ERRORS", preview.issues);
  }

  await transaction(async (client) => {
    const seriesIds = new Map<string, string>();
    for (const episode of preview.episodes) {
      let seriesId = seriesIds.get(episode.seriesKey);
      if (!seriesId) {
        const seriesResult = await client.query<{ id: string }>(
          `INSERT INTO series (series_key, name)
           VALUES ($1,$2)
           ON CONFLICT (series_key) DO UPDATE SET name=EXCLUDED.name, updated_at=now()
           RETURNING id`,
          [episode.seriesKey, episode.seriesName],
        );
        seriesId = seriesResult.rows[0].id;
        seriesIds.set(episode.seriesKey, seriesId);
      }

      const episodeResult = await client.query<{ id: string }>(
        `INSERT INTO episodes (
           series_id, episode_key, number_label, sort_order, title, release_date,
           duration_minutes, priority_on_release, archived
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (series_id, episode_key) DO UPDATE SET
           number_label=EXCLUDED.number_label, sort_order=EXCLUDED.sort_order,
           title=EXCLUDED.title, release_date=EXCLUDED.release_date,
           duration_minutes=EXCLUDED.duration_minutes,
           priority_on_release=EXCLUDED.priority_on_release,
           archived=EXCLUDED.archived, updated_at=now()
         RETURNING id`,
        [
          seriesId,
          episode.episodeKey,
          episode.numberLabel,
          episode.sortOrder,
          episode.title,
          episode.releaseDate,
          episode.durationMinutes,
          episode.priorityOnRelease,
          episode.archived,
        ],
      );
      for (const [sortOrder, link] of episode.links.entries()) {
        await client.query(
          `INSERT INTO episode_links (episode_id, label, url, sort_order)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (episode_id, label, url) DO UPDATE SET sort_order=EXCLUDED.sort_order`,
          [episodeResult.rows[0].id, link.label, link.url, sortOrder],
        );
      }
    }
  });
  return preview.summary;
}
