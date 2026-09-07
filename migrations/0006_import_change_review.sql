-- JSONB compares object contents independently of key order. Remove the
-- false positives produced by hashing a JSONB round-trip as raw JSON text.
DELETE FROM import_proposals p USING import_source_items i
WHERE p.source_id=i.source_id AND p.external_id=i.external_id
  AND p.status='pending' AND p.proposal_type='update'
  AND (p.source_payload - 'priorityOnRelease' - 'canonicalUrl') =
      (i.source_payload - 'priorityOnRelease' - 'canonicalUrl');

-- Give existing real proposals the same complete before/after display as new
-- ones, including links. A missing source value never clears a library value.
WITH comparisons AS (
  SELECT p.id, p.source_payload,
    jsonb_build_object('title',e.title,'numberLabel',e.number_label,
      'sortOrder',e.sort_order,'releaseDate',e.release_date,
      'durationMinutes',e.duration_minutes,
      'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',l.label,'url',l.url) ORDER BY l.url,l.label)
        FROM episode_links l WHERE l.episode_id=e.id AND l.import_source_id=p.source_id),'[]'::jsonb)) AS current_payload
  FROM import_proposals p JOIN episodes e ON e.id=p.candidate_episode_id
  WHERE p.status='pending' AND p.proposal_type='update'
), changes AS (
  SELECT c.id, COALESCE((SELECT jsonb_object_agg(v.key,jsonb_build_object('from',v.value,'to',c.source_payload->v.key))
    FROM jsonb_each(c.current_payload) v
    WHERE c.source_payload->v.key IS NOT NULL AND c.source_payload->v.key <> 'null'::jsonb
      AND v.value IS DISTINCT FROM c.source_payload->v.key),'{}'::jsonb) AS fields
  FROM comparisons c
)
UPDATE import_proposals p SET field_changes=c.fields FROM changes c WHERE p.id=c.id;

DELETE FROM import_proposals WHERE status='pending' AND proposal_type='update' AND field_changes='{}'::jsonb;
UPDATE import_sources SET etag=NULL,last_modified=NULL;
