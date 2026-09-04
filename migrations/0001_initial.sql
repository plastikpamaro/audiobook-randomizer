CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  catalog_baseline_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip_hash char(64) NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_lookup_idx ON login_attempts (email, ip_hash, attempted_at DESC);

CREATE TABLE series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  accent_color varchar(7) NOT NULL DEFAULT '#f0a35b',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE RESTRICT,
  episode_key text NOT NULL,
  number_label text,
  sort_order integer,
  title text NOT NULL,
  release_date date,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  priority_on_release boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, episode_key)
);

CREATE INDEX episodes_series_catalog_idx ON episodes (series_id, archived, release_date, sort_order);

CREATE TABLE episode_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  label text NOT NULL,
  url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, label, url)
);

CREATE INDEX episode_links_episode_idx ON episode_links (episode_id, sort_order, label);

CREATE TABLE presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX presets_user_name_unique ON presets (user_id, lower(name));

CREATE TABLE preset_series (
  preset_id uuid NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  PRIMARY KEY (preset_id, series_id)
);

CREATE TABLE user_series_rounds (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, series_id)
);

CREATE TABLE draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
  round_number integer NOT NULL CHECK (round_number > 0),
  status text NOT NULL CHECK (status IN ('active', 'heard', 'skipped')),
  source_type text NOT NULL DEFAULT 'random' CHECK (source_type IN ('random', 'bulk')),
  preset_id uuid REFERENCES presets(id) ON DELETE SET NULL,
  selection_series_ids uuid[] NOT NULL,
  drawn_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  corrected_at timestamptz
);

CREATE UNIQUE INDEX draws_one_active_per_user ON draws (user_id) WHERE status = 'active';
CREATE INDEX draws_user_history_idx ON draws (user_id, drawn_at DESC);
CREATE INDEX draws_user_status_idx ON draws (user_id, status, resolved_at DESC);
CREATE INDEX draws_episode_idx ON draws (episode_id, drawn_at DESC);

CREATE TABLE episode_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
  round_number integer NOT NULL CHECK (round_number > 0),
  draw_id uuid NOT NULL REFERENCES draws(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('random', 'bulk')),
  completed_at timestamptz NOT NULL DEFAULT now(),
  duration_minutes_snapshot integer CHECK (duration_minutes_snapshot IS NULL OR duration_minutes_snapshot > 0),
  reversed_at timestamptz
);

CREATE UNIQUE INDEX episode_completions_current_unique
  ON episode_completions (user_id, episode_id, round_number)
  WHERE reversed_at IS NULL;
CREATE INDEX episode_completions_user_time_idx ON episode_completions (user_id, completed_at DESC);

CREATE TABLE episode_priority_offers (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  draw_id uuid NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  offered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE user_episode_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  favorite boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);

CREATE INDEX user_episode_preferences_favorite_idx
  ON user_episode_preferences (user_id, favorite)
  WHERE favorite = true;
