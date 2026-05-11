-- Add Opus 7-day quota tracking (Opus quota nicknamed "omelette" in our PRD/decisions).
-- Anthropic OAuth usage API may expose this as `seven_day_opus.utilization` (TBD);
-- fallback computed as `seven_day - seven_day_sonnet` (≈ Opus + other models) when absent.
ALTER TABLE account_usage_cache
  ADD COLUMN IF NOT EXISTS seven_day_omelette_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seven_day_omelette_resets_at timestamptz;
