ALTER TABLE users
  ADD COLUMN active_preset_id uuid REFERENCES presets(id) ON DELETE SET NULL;

CREATE INDEX users_active_preset_idx ON users (active_preset_id)
  WHERE active_preset_id IS NOT NULL;
