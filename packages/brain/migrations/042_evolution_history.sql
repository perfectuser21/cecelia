-- Migration 042: Add evolution_history table with before/after snapshots and effectiveness tracking
-- Tracks strategy evolution: what changed, how it performed, whether it was rolled back

CREATE TABLE IF NOT EXISTS evolution_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  learning_id uuid REFERENCES learnings(id),
  evolution_type character varying(50) NOT NULL,
  description text,
  snapshot_before jsonb,
  snapshot_after jsonb,
  metrics_before jsonb,
  metrics_after jsonb,
  evaluation_window_days integer DEFAULT 7,
  evaluation_start_date timestamp with time zone DEFAULT now(),
  evaluation_end_date timestamp with time zone,
  effectiveness_score double precision,
  effectiveness_evaluated_at timestamp with time zone,
  rollback_applied boolean DEFAULT false,
  rollback_at timestamp with time zone,
  rollback_reason text,
  created_by character varying(100),
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evolution_history_type ON evolution_history USING btree (evolution_type);
CREATE INDEX IF NOT EXISTS idx_evolution_history_learning_id ON evolution_history USING btree (learning_id) WHERE learning_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_history_created_at ON evolution_history USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evolution_history_effectiveness_score ON evolution_history USING btree (effectiveness_score) WHERE effectiveness_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_history_evaluation_end ON evolution_history USING btree (evaluation_end_date) WHERE evaluation_end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_history_rollback ON evolution_history USING btree (rollback_applied) WHERE rollback_applied = true;
CREATE INDEX IF NOT EXISTS idx_evolution_history_snapshot_before ON evolution_history USING gin (snapshot_before);
CREATE INDEX IF NOT EXISTS idx_evolution_history_snapshot_after ON evolution_history USING gin (snapshot_after);
CREATE INDEX IF NOT EXISTS idx_evolution_history_metrics_before ON evolution_history USING gin (metrics_before);
CREATE INDEX IF NOT EXISTS idx_evolution_history_metrics_after ON evolution_history USING gin (metrics_after);

INSERT INTO schema_version (version, description)
VALUES ('042', 'Add evolution_history table with before/after snapshots and effectiveness tracking')
ON CONFLICT (version) DO NOTHING;
