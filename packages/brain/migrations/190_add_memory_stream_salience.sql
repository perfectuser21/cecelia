-- Migration 186: Add salience_score and emotion_tag to memory_stream
-- Purpose: Enable conversation records to carry salience weight and emotional context
-- This supports the memory system redesign where conversation_turn records
-- are prioritized by RPE (reward prediction error) and emotional intensity.

ALTER TABLE memory_stream ADD COLUMN IF NOT EXISTS salience_score FLOAT
  CHECK (salience_score >= 0 AND salience_score <= 1);

ALTER TABLE memory_stream ADD COLUMN IF NOT EXISTS emotion_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_stream_conversation_turn
  ON memory_stream(created_at DESC)
  WHERE source_type = 'conversation_turn';
