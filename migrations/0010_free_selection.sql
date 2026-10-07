ALTER TABLE users
  ADD COLUMN free_selection_series_ids uuid[];

COMMENT ON COLUMN users.free_selection_series_ids IS
  'NULL means no saved free selection (default all active series); an empty array means explicitly no series.';
