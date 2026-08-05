-- Migration 387: executor_kind 增加 'codex-review-local'
--
-- 背景：决策 9befa9c3 / issue f1d6840f —— REVIEW_TASK_TYPES 任务（spec_review /
-- code_review_gate / arch_review 等）由 triggerCodexReview 直接 spawn detached
-- codex 进程，三条既有进程信号（activeProcesses / current_run_id / ps 扫描）全无，
-- 曾被恒判死（10~30 分钟审查跑不完）。修复引入 lock 文件活性 SSOT
-- （packages/brain/src/lib/codex-review-liveness.js），并在派发时
-- setExecutorKind(task.id, 'codex-review-local') 打标，供合同层
-- EXECUTOR_CONTRACTS['codex-review-local']（onStale=requeue, staleMinutes=90）识别。
--
-- 365 的 CHECK 只列了六类，'codex-review-local' 不在其中 —— 生产上打标必违反
-- 约束、被 catch 静默吞掉，合同层整层变死代码。这里把七值补进去。
-- 存量行不动：本 migration 仅放宽约束，不回填历史数据。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_executor_kind_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_executor_kind_check
    CHECK (executor_kind IS NULL OR executor_kind IN (
      'brain-local',
      'relay-container',
      'kernel-process',
      'headed-session',
      'bridge',
      'external-worker',
      'codex-review-local'
    ));

INSERT INTO schema_version (version, description)
VALUES ('387', 'Allow codex-review-local in tasks.executor_kind (决策 9befa9c3 / issue f1d6840f)')
ON CONFLICT (version) DO NOTHING;
