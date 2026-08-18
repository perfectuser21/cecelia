-- Rollback 431: 收回 publisher 角色。
-- 注意：回滚前必须确认没有 role='publisher' 的存量行，否则约束加不回去。

ALTER TABLE harness_attempts
  DROP CONSTRAINT IF EXISTS harness_attempts_role_check;

ALTER TABLE harness_attempts
  ADD CONSTRAINT harness_attempts_role_check
  CHECK (role IN (
    'planner',
    'proposer',
    'reviewer',
    'generator',
    'evaluator',
    'judge',
    'reporter',
    'commander'
  ));
