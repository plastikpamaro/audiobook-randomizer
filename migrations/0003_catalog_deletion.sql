-- Permanently remove dependent catalog data, including listening history.
ALTER TABLE episodes DROP CONSTRAINT episodes_series_id_fkey,
  ADD CONSTRAINT episodes_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;
ALTER TABLE draws DROP CONSTRAINT draws_episode_id_fkey,
  ADD CONSTRAINT draws_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
ALTER TABLE episode_completions DROP CONSTRAINT episode_completions_episode_id_fkey,
  ADD CONSTRAINT episode_completions_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  DROP CONSTRAINT episode_completions_draw_id_fkey,
  ADD CONSTRAINT episode_completions_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES draws(id) ON DELETE CASCADE;
ALTER TABLE import_sources DROP CONSTRAINT import_sources_series_id_fkey,
  ADD CONSTRAINT import_sources_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;
ALTER TABLE import_source_items DROP CONSTRAINT import_source_items_episode_id_fkey,
  ADD CONSTRAINT import_source_items_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
