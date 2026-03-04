-- Migration 118: 扩展 person_signals.signal_type，支持 preference 和 correction

-- 删除旧约束，添加新约束（支持 preference / correction 两种新类型）
ALTER TABLE person_signals
  DROP CONSTRAINT IF EXISTS person_signals_signal_type_check;

ALTER TABLE person_signals
  ADD CONSTRAINT person_signals_signal_type_check
  CHECK (signal_type IN ('mood', 'availability', 'workload', 'sentiment', 'location', 'preference', 'correction', 'other'));
