-- Migration 382: initiative_runs_phase_check 补 'judge' 值。
--
-- 根因：kernel-phase-persist 修复（cp-08041000-kernel-phase-persist）里
-- loop.js 在 decision.phase ∈ {planning,gan,generate,evaluate,judge} 时会调用
-- persistKernelRunPhase() 独立单语句 UPDATE initiative_runs SET phase=$2。
-- derive.js 对 spawn:judge 决策返回 { phase: 'judge', ... }，但 367 版本的
-- initiative_runs_phase_check 枚举里没有 'judge'，导致该 UPDATE 每次都因
-- CHECK 约束违反而失败——按设计降级为告警日志，不炸 loop，但等价于 judge
-- 相位永远静默持久化不到 DB。
--
-- 修法：照 367 的 DROP+ADD 模式重建约束，在现有全部枚举值基础上追加 'judge'，
-- 不删除/不改动任何既有合法值。

ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_phase_check;
ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_phase_check
  CHECK (phase IN (
    'A_planning','A_contract','B_task_loop','C_final_e2e',
    'done','failed','paused',
    'planning','gan','generate','evaluate','judge'
  ));

INSERT INTO schema_version (version, description, applied_at)
VALUES ('382', 'Allow judge phase on initiative_runs.phase (kernel-phase-persist judge write)', NOW())
ON CONFLICT (version) DO NOTHING;
