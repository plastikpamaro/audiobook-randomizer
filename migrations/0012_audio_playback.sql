CREATE TABLE user_episode_playback (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position_seconds double precision NOT NULL DEFAULT 0 CHECK (position_seconds >= 0 AND position_seconds <= 604800),
  duration_seconds double precision CHECK (duration_seconds > 0 AND duration_seconds <= 604800),
  playback_session_id uuid NOT NULL,
  save_sequence integer NOT NULL DEFAULT 0 CHECK (save_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id),
  CHECK (duration_seconds IS NULL OR position_seconds <= duration_seconds)
);
