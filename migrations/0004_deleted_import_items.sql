-- Remember only external identifiers so scheduled imports cannot recreate deleted episodes.
CREATE TABLE import_source_exclusions (
  source_id uuid NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

CREATE FUNCTION remember_deleted_import_episode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM import_proposals WHERE status = 'pending' AND candidate_episode_id = OLD.id;
  INSERT INTO import_source_exclusions (source_id, external_id)
    SELECT item.source_id, item.external_id FROM import_source_items item
    JOIN import_sources source ON source.id = item.source_id
    WHERE item.episode_id = OLD.id
    ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE TRIGGER remember_deleted_import_episode
  BEFORE DELETE ON episodes
  FOR EACH ROW EXECUTE FUNCTION remember_deleted_import_episode();
