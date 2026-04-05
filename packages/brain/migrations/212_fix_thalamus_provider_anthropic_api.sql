-- Migration 212: Fix thalamus provider in profile-anthropic to use anthropic-api (direct REST)
-- instead of anthropic (bridge via claude -p).
-- Bridge is unreliable: claude -p exits code 1 in <1s, causing all content pipeline LLM calls
-- to silently fall back to static templates and produce empty content.
-- anthropic-api uses direct REST API which is stable (same as cortex).

UPDATE model_profiles
SET config = jsonb_set(
  config,
  '{thalamus,provider}',
  '"anthropic-api"'
),
updated_at = NOW()
WHERE id = 'profile-anthropic'
  AND config->'thalamus'->>'provider' = 'anthropic';
