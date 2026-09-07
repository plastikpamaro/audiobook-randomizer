ALTER TABLE draws DROP CONSTRAINT draws_source_type_check;
ALTER TABLE draws ADD CONSTRAINT draws_source_type_check CHECK (source_type IN ('random','manual','bulk'));
ALTER TABLE episode_completions DROP CONSTRAINT episode_completions_source_type_check;
ALTER TABLE episode_completions ADD CONSTRAINT episode_completions_source_type_check CHECK (source_type IN ('random','manual','bulk'));

-- Multiple real listens in a round count separately; availability is determined
-- by existence of any unreversed completion. Each draw still has one completion.
DROP INDEX episode_completions_current_unique;
CREATE INDEX episode_completions_current_idx ON episode_completions(user_id,episode_id,round_number) WHERE reversed_at IS NULL;

ALTER TABLE draws ADD COLUMN client_request_id uuid;
CREATE UNIQUE INDEX draws_client_request_unique ON draws(user_id,client_request_id) WHERE client_request_id IS NOT NULL;
