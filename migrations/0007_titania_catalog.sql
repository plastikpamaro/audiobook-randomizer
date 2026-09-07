ALTER TABLE import_sources DROP CONSTRAINT import_sources_kind_check;
ALTER TABLE import_sources DROP CONSTRAINT import_sources_check;
ALTER TABLE import_sources ADD CONSTRAINT import_sources_kind_check CHECK (
  kind IN ('drei_fragezeichen', 'tkkg', 'van_dusen', 'van_dusen_neue', 'point_whitmark', 'pater_brown', 'sherlock_titania', 'csv', 'json', 'rss')
);
ALTER TABLE import_sources ADD CONSTRAINT import_sources_check CHECK (
  (kind IN ('drei_fragezeichen', 'tkkg', 'van_dusen', 'van_dusen_neue', 'point_whitmark', 'pater_brown', 'sherlock_titania') AND url IS NULL)
  OR (kind IN ('csv', 'json', 'rss') AND url IS NOT NULL)
);
