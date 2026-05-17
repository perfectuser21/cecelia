-- Migration 158: link ZenithJoy Q1 OKR to Vision parent node
-- The OKR (33a45167) was missing its parent_id link to the Vision goal (4911164a)
-- This fixes has_vision: false in intent_expand pipeline

UPDATE goals
SET parent_id = '4911164a-1088-44fb-a442-44a2e66a537f'
WHERE id = '33a45167-f12e-4972-a33a-9553626363c1'
  AND parent_id IS NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('158', 'link ZenithJoy Q1 OKR to Vision parent node', NOW())
ON CONFLICT (version) DO NOTHING;
