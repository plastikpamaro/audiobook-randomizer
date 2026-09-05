ALTER TABLE episode_completions
  ADD COLUMN rating smallint CHECK (rating BETWEEN 1 AND 10),
  ADD COLUMN rated_at timestamptz,
  ADD COLUMN rating_updated_at timestamptz;

CREATE UNIQUE INDEX episode_completions_draw_unique ON episode_completions (draw_id);

CREATE TABLE import_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('drei_fragezeichen', 'tkkg', 'csv', 'json', 'rss')),
  name text NOT NULL,
  url text,
  enabled boolean NOT NULL DEFAULT false,
  first_import_completed_at timestamptz,
  etag text,
  last_modified text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_item_count integer CHECK (last_item_count IS NULL OR last_item_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'drei_fragezeichen' AND url IS NULL)
    OR (kind = 'tkkg' AND url IS NULL)
    OR (kind IN ('csv', 'json', 'rss') AND url IS NOT NULL)
  )
);

CREATE INDEX import_sources_enabled_idx ON import_sources (enabled, last_checked_at);
CREATE INDEX import_sources_series_idx ON import_sources (series_id);

CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('preview', 'manual', 'scheduled')),
  status text NOT NULL CHECK (status IN (
    'running', 'awaiting_confirmation', 'succeeded', 'failed', 'needs_review', 'not_modified'
  )),
  scheduled_local_date date,
  fetched_item_count integer NOT NULL DEFAULT 0 CHECK (fetched_item_count >= 0),
  new_item_count integer NOT NULL DEFAULT 0 CHECK (new_item_count >= 0),
  changed_item_count integer NOT NULL DEFAULT 0 CHECK (changed_item_count >= 0),
  invalid_item_count integer NOT NULL DEFAULT 0 CHECK (invalid_item_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX import_runs_source_schedule_unique
  ON import_runs (source_id, scheduled_local_date)
  WHERE trigger_type = 'scheduled' AND scheduled_local_date IS NOT NULL;
CREATE INDEX import_runs_source_time_idx ON import_runs (source_id, started_at DESC);

CREATE TABLE import_source_items (
  source_id uuid NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE RESTRICT,
  payload_hash char(64) NOT NULL,
  source_payload jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_id),
  UNIQUE (source_id, episode_id)
);

CREATE INDEX import_source_items_episode_idx ON import_source_items (episode_id);

CREATE TABLE import_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  proposal_type text NOT NULL CHECK (proposal_type IN ('create', 'link', 'update')),
  candidate_episode_id uuid REFERENCES episodes(id) ON DELETE SET NULL,
  payload_hash char(64) NOT NULL,
  source_payload jsonb NOT NULL,
  field_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id, proposal_type, payload_hash)
);

CREATE INDEX import_proposals_pending_idx ON import_proposals (source_id, status, created_at DESC);

ALTER TABLE episode_links
  ADD COLUMN import_source_id uuid REFERENCES import_sources(id) ON DELETE SET NULL;

CREATE INDEX episode_links_import_source_idx ON episode_links (import_source_id);

CREATE TABLE import_worker_state (
  worker_key text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
