ALTER TABLE draws
  ADD COLUMN replaced_draw_id uuid REFERENCES draws(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX draws_replaced_draw_unique ON draws (replaced_draw_id)
  WHERE replaced_draw_id IS NOT NULL;
