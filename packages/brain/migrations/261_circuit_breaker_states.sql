-- Migration 261: circuit_breaker_states — 熔断器状态持久化
-- 问题：circuit-breaker.js 仅维护内存 Map（breakers），Brain 重启后所有熔断器
-- 状态（OPEN/HALF_OPEN/失败计数）瞬间清零，正在熔断的 worker 重启即"复活"派发，
-- 不断循环触发同样的失败。
-- 修复：状态写入 circuit_breaker_states 表，Brain 启动时从 DB 恢复内存 Map。

CREATE TABLE IF NOT EXISTS circuit_breaker_states (
  key             TEXT        PRIMARY KEY,
  state           TEXT        NOT NULL CHECK (state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  failures        INTEGER     NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_states_state
  ON circuit_breaker_states(state)
  WHERE state IN ('OPEN', 'HALF_OPEN');

COMMENT ON TABLE  circuit_breaker_states IS '熔断器状态持久化（重启后从 DB 恢复内存 Map），SSOT 仍是内存，DB 是恢复源';
COMMENT ON COLUMN circuit_breaker_states.key             IS 'worker 标识（cecelia-run / 具体 worker 名 / default）';
COMMENT ON COLUMN circuit_breaker_states.failures        IS '连续失败计数，达到 FAILURE_THRESHOLD(8) 触发 OPEN';
COMMENT ON COLUMN circuit_breaker_states.last_failure_at IS '最后失败时间（保留观测，运行时不读）';
COMMENT ON COLUMN circuit_breaker_states.opened_at       IS 'OPEN 时刻，用于计算 OPEN→HALF_OPEN 冷却（5min）';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('261', 'circuit_breaker_states: persist circuit-breaker state across Brain restarts', NOW())
ON CONFLICT DO NOTHING;
