-- Migration 392: 验收一体两面数据层地基（D1，GP 7790f728，决策 fdeb48aa/8640ef58）
-- 四件结构改动合成一支：CHECK 扩容与 routes/acceptance.js 的 run 状态计算必须同批上线，
-- 拆开会制造「CHECK 已扩、代码仍写 failed」的中间态窗口。
-- 回滚脚本在 migrations/rollback/392_acceptance_two_column.down.sql（不放本目录：
-- migrate.js 按文件名排序会让 *.down.sql 抢在 *.sql 之前执行）。

-- 1. AI 四列（J6-A）。全部 nullable：ai_verdict IS NULL 是 Q0′「AI 列缺格」的机械载体，
--    也是哑火判据条件③ 的取数口径，给默认值会让「没跑」和「跑了没结论」不可区分。
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS ai_verdict TEXT;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS ai_evidence JSONB;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS ai_run_at TIMESTAMPTZ;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS adjudication JSONB;

ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS acceptance_checks_ai_verdict_check;
ALTER TABLE acceptance_checks ADD CONSTRAINT acceptance_checks_ai_verdict_check
  CHECK (ai_verdict IS NULL OR ai_verdict IN ('通过','不通过','无法验证'));

-- 2. acceptance_runs.detail：承载单头全部可变附属信息（backend_sha/frontend_sha/spec_sha、
--    tenant_account/device_model/scenarios_observed[]、ai_status/ai_incomplete、
--    abandoned_*、review_closed_*/review_acks[]、force_*、bypass_used、unverifiable_adjudicated[]）。
--    不给子键建独立列——它们不是查询主键；A2 的读侧裁剪按列白名单做，detail 整列默认不出现。
ALTER TABLE acceptance_runs ADD COLUMN IF NOT EXISTS detail JSONB;

-- 3. 状态机 4 值 → 7 值 + 2 个只读历史兼容值。
--    三个非活跃终态（stale/expired/abandoned）是 status 取值，不是 detail 旗标（A10④）。
--    passed/failed 保留在 CHECK 里仅为兼容存量行，新 run 永不产生（A10⑤-c 断言）。
ALTER TABLE acceptance_runs DROP CONSTRAINT IF EXISTS acceptance_runs_status_check;
ALTER TABLE acceptance_runs ADD CONSTRAINT acceptance_runs_status_check
  CHECK (status IN ('pending','in_review','human_complete','adjudicated',
                    'stale','expired','abandoned',
                    'passed','failed'));

-- 4. UNIQUE 换绑（J5-A）：全局 check_key 唯一 → run 内唯一，让同 gp 第二轮 run 的 S3-c1
--    不再撞 23505。存量 21 行（旧 {run_key}:{NNN} 流水号格式）在新约束下天然成立，
--    无需回填/改写/删除——强行映射成 S{n}-c{m} 等于伪造历史判定记录。
--    也不给 check_key 加格式 CHECK：会当场挡死这 21 行；格号规范由建单生成器在写入侧保证。
ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS acceptance_checks_check_key_key;
ALTER TABLE acceptance_checks DROP CONSTRAINT IF EXISTS uq_acceptance_checks_run_key;
ALTER TABLE acceptance_checks ADD CONSTRAINT uq_acceptance_checks_run_key
  UNIQUE (run_id, check_key);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('392', 'acceptance two-column data layer: AI columns + runs.detail + 7-value status + per-run check_key unique', NOW())
ON CONFLICT (version) DO NOTHING;
