import "server-only";

import { query } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import type { PlaybackProgress, PlaybackSave } from "@/lib/playback-types";

interface PlaybackRow {
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: Date;
  playback_session_id: string;
}

function progress(row?: PlaybackRow): PlaybackProgress {
  return {
    positionSeconds: row?.position_seconds ?? 0,
    durationSeconds: row?.duration_seconds ?? null,
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

export async function getPlaybackProgress(userId: string, episodeId: string): Promise<PlaybackProgress> {
  const rows = await query<PlaybackRow>(
    "SELECT * FROM user_episode_playback WHERE user_id = $1 AND episode_id = $2", [userId, episodeId],
  );
  return progress(rows[0]);
}

// A new play action takes ownership without changing the saved position. Delayed
// writes from an earlier device can no longer modify this user's episode state.
export async function claimPlayback(userId: string, episodeId: string, sessionId: string): Promise<PlaybackProgress> {
  const rows = await query<PlaybackRow>(
    `INSERT INTO user_episode_playback (user_id, episode_id, playback_session_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, episode_id) DO UPDATE
     SET playback_session_id = EXCLUDED.playback_session_id,
         save_sequence = CASE WHEN user_episode_playback.playback_session_id = EXCLUDED.playback_session_id
                              THEN user_episode_playback.save_sequence ELSE 0 END
     RETURNING *`,
    [userId, episodeId, sessionId],
  );
  return progress(rows[0]);
}

export async function savePlaybackProgress(userId: string, episodeId: string, input: PlaybackSave): Promise<PlaybackProgress> {
  const rows = await query<PlaybackRow>(
    `UPDATE user_episode_playback
     SET position_seconds = $5, duration_seconds = $6, save_sequence = $4, updated_at = now()
     WHERE user_id = $1 AND episode_id = $2 AND playback_session_id = $3 AND save_sequence < $4
     RETURNING *`,
    [userId, episodeId, input.sessionId, input.sequence, input.finished ? 0 : input.positionSeconds, input.durationSeconds],
  );
  if (rows[0]) return progress(rows[0]);
  const current = await query<PlaybackRow>(
    "SELECT * FROM user_episode_playback WHERE user_id = $1 AND episode_id = $2", [userId, episodeId],
  );
  if (!current[0] || current[0].playback_session_id !== input.sessionId) {
    throw new AppError("Die Folge wird auf einem anderen Gerät weitergehört. Zum Übernehmen drücke erneut Play.", 409, "PLAYBACK_REPLACED");
  }
  // Duplicate or reordered saves from the same player are harmless.
  return progress(current[0]);
}
