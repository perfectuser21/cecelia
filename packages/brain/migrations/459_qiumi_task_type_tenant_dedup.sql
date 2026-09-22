-- Migration 459: qiumi_task 任务类型 + tasks.tenant_id + 去重索引豁免 Notion 来源
--
-- 秋米中文 GTD 表接入 Brain 统一调度·PR1 地基（task 15f42776，决策 b8abd28c）。
--
-- 【终审 I1】本文件原把 CHECK 重建（DROP+ADD 需扫全表验证）、tenant_id 单条大 UPDATE
-- 回填、去重索引 DROP+CREATE 四类重活挤进同一个事务（migrate.js 每文件一个 BEGIN/
-- COMMIT），生产 tasks 是高频写表，长事务持锁会挡住派发/回写。拆法：
--   ① 这里的 ADD CONSTRAINT 改 NOT VALID——只做目录项登记，不扫存量行，毫秒级；
--   ② 存量行验证挪到独立文件 460_validate_task_type_check.sql 的
--      VALIDATE CONSTRAINT（SHARE UPDATE EXCLUSIVE 锁，不挡并发读写），跟本文件
--      的 ACCESS EXCLUSIVE 操作分处两个事务，460 开始时 459 的锁已经释放；
--   ③ tenant_id 回填改分批循环（见下），仍在本事务内但避免单条超大 UPDATE 的
--      一次性 work_mem/WAL 峰值与长时间不可中断扫描；
--   ④ 去重索引仍是 DROP+CREATE（未用 CONCURRENTLY，见下方"事务安全"节），保留
--      ACCESS EXCLUSIVE，头部标注建议维护窗口执行。
--
-- 一、tasks_task_type_check 纳入 qiumi_task
--     qiumi_task = 中文 GTD 表来的非编码任务，Brain 经 ssh 在 MMV 起 openclaw agent 执行。
--     列表 = 457 的全量 83 值（实测核对，457 自己的注释写"82 个"有误差；本 459 = 457
--     的 83 值 + 'qiumi_task' 共 84 值）。ADD CONSTRAINT ... NOT VALID：新写入立即受约束
--     （目录项已生效），存量行是否合规留给 460 的 VALIDATE 去扫描确认——两步之间若有
--     不合规存量行，新 INSERT/UPDATE 仍被挡，只是"确认全表已合规"这件事延后、且不占
--     本事务的锁。lib/task-type-registry.js 的 DB_WHITELISTED_TASK_TYPES 与此列表由
--     测试机械对账。
--
-- 二、tasks.tenant_id
--     tasks 表此前没有租户列，租户只躺在 payload.tenant_id（routes/task-tasks.js 读
--     x-tenant-id 头写入）。中文表三人现为悦升云端，金诺盛源与后续客户各自一个值。
--     回填 payload->>'tenant_id'（分批循环，见下）；建 (tenant_id, status) 索引供按
--     租户过滤。
--
-- 三、idx_tasks_dedup_active 豁免 Notion 来源
--     077 的唯一索引 (title, goal_id, project_id) WHERE 活跃 会把同名的 Notion 行
--     （"朋友圈点赞测试" ×4 这种）吞掉。豁免键用专用的 payload.dedup_by_notion_page='true'，
--     **不能用 payload.notion_page_id**：notion-push-sync.js 现有的 pullNotionTasks
--     （source='notion_tasks_db'）建单时就把 metadata:{notion_page_id: page.id} 传给
--     createRoutedTask，而 work-routing-store.js 的 payload = {...request.metadata, ...}
--     在 INSERT（:213/:308-318）时把 metadata 整体 spread 进 payload——也就是说生产里
--     **现在**就有活跃任务的 payload 带 notion_page_id。若拿它当豁免键，本迁移一上线，
--     全部既有 Notion 排单任务会立刻集体退出 title 去重，属真实行为变化，PR1"零行为
--     变化"不成立。dedup_by_notion_page 是 PR2 才会显式写的新键（qiumi_task 专用），
--     PR1 期间没有任何任务带它，索引行为不变。不能用 notion_id 列：它是建单后才
--     UPDATE 的，且 pushTasks 给所有投影任务都写它，同样不能当豁免键。
--
--     【终审 I7】这条豁免只是"解除 tasks.title 唯一索引对 dedup_by_notion_page='true'
--     任务的拦截"，**不建立任何新的唯一性保证**，本迁移也不新建唯一索引。同一 Notion
--     页重复排单不撞出重复 task，靠的是应用层 `createRoutedTask`（work-routing-store.js
--     :167-179）：按 `(source, source_id, router_version)` 取 `pg_advisory_xact_lock`
--     + 查 `work_routing_receipts`（其 `UNIQUE(source, source_id, router_version)`，
--     见迁移 413）是否已有记录，命中则直接返回既有 task（`deduplicated: true`），不会
--     再 INSERT 一行。PR2 里 `source_id` 会填 Notion 页 id，同一页第二次经
--     `pullNotionTasks` 处理时天然幂等，与 `tasks.title` 索引豁免与否无关——这条 title
--     索引本来防的是"同名但来源不同、彼此独立的任务"互相打架，不是防"同一来源重复
--     处理"，两件事职责不同，本迁移只处理前者。
--
--     事务安全（Task 4 审查 Important #1）：本文件的 DROP INDEX 与 CREATE UNIQUE INDEX
--     之间**不需要**自己包 BEGIN/COMMIT——packages/brain/src/migrate.js:67-76 的
--     runMigrations() 已经把每个迁移文件整体包在一个事务里
--     （`await client.query('BEGIN')` → `await client.query(sql)` 执行本文件全部内容 →
--     成功 `COMMIT`，抛错则 `ROLLBACK` 并把错误上抛，见 :79-83），CI 全部迁移 job
--     （.github/workflows/ci.yml 的 brain-integration/real-env-smoke 等）统一走
--     `node src/migrate.js`，不存在裸 `psql -f` 逐语句自动提交的路径。077/457 同样不
--     自带 BEGIN/COMMIT，保持一致不重复包（`CREATE INDEX CONCURRENTLY` 才不能在事务
--     内用，本迁移未用 CONCURRENTLY，仍需 ACCESS EXCLUSIVE 锁全表——**建议在维护窗口
--     执行**，避免与生产高频写入撞车；457/077 的去重索引重建同样未加 CONCURRENTLY，
--     沿用既有做法不新增风险面）。
--     已实测验证：在 459 的 DROP INDEX 与 CREATE UNIQUE INDEX 之间插入一条必错语句
--     （引用不存在的列），经 `node src/migrate.js` 跑对 cecelia_test 后整份文件被
--     ROLLBACK——`idx_tasks_dedup_active` 索引仍在、schema_version 未写入 459 行，
--     证明中途失败不会留下"索引已删、未重建"的空窗；随后用未修改的原始 459 文件重新
--     跑通过，`ALL PASS`。
--
-- 全部 DDL 幂等：CI 会重放全部 migration。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory', 'explore', 'knowledge',
    'qa', 'audit', 'decomp_review', 'codex_qa', 'codex_dev', 'codex_test_gen', 'pr_review',
    'code_review', 'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced', 'architecture_design',
    'architecture_scan', 'arch_review', 'strategy_session', 'intent_expand', 'cto_review',
    'spec_review', 'code_review_gate', 'prd_review', 'initiative_review', 'scope_plan',
    'project_plan', 'okr_initiative_plan', 'okr_scope_plan', 'okr_project_plan',
    'content-pipeline', 'content-research', 'content-generate', 'content-review',
    'content-export', 'content_publish', 'content-copywriting', 'content-copy-review',
    'content-image-review', 'pipeline_rescue', 'crystallize', 'crystallize_scope',
    'crystallize_forge', 'crystallize_verify', 'crystallize_register', 'sprint_planner',
    'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate',
    'sprint_evaluate', 'sprint_fix', 'sprint_report', 'cecelia_event', 'harness_planner',
    'harness_contract_propose', 'harness_contract_review', 'harness_generate',
    'harness_generator', 'harness_ci_watch', 'harness_evaluate', 'harness_fix',
    'harness_deploy_watch', 'harness_report', 'platform_scraper', 'harness_initiative',
    'harness_task', 'harness_final_e2e', 'trigger_backup', 'harness_intervention',
    'staging_e2e', 'skill_eval', 'ci_patrol', 'golden_path_proposal',
    'strategist_decision', 'workflow_run', 'device_job',
    'qiumi_task'
  )
) NOT VALID;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id TEXT;
-- 分批回填（Task 终审 Important #1）：单条覆盖全表的 UPDATE 会在一次语句里锁住并
-- 改写所有匹配行；改成按 id 分批循环，每批 5000 行，降低单条语句的 work_mem/WAL
-- 峰值与一次性长时间扫描。仍在本迁移事务内（同一 COMMIT 前不可见），批量只为
-- 控制单条语句体量，不改变最终一致性。
DO $$
DECLARE
  updated_count integer;
BEGIN
  LOOP
    UPDATE tasks SET tenant_id = payload->>'tenant_id'
    WHERE id IN (
      SELECT id FROM tasks
      WHERE tenant_id IS NULL AND payload ? 'tenant_id' AND payload->>'tenant_id' <> ''
      LIMIT 5000
    );
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    EXIT WHEN updated_count = 0;
  END LOOP;
END
$$;
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks (tenant_id, status);
COMMENT ON COLUMN tasks.tenant_id IS
  '租户标识（如 yueshengyun / jinoshengyuan）。Notion 来源由 NOTION_TENANT_MAP 映射；API 来源由 x-tenant-id 头。NULL = 未标租户的历史任务。';

-- 去重索引重建（建议维护窗口执行）：DROP+CREATE UNIQUE INDEX 需要 ACCESS EXCLUSIVE
-- 锁全表，期间阻塞并发读写；未用 CONCURRENTLY 是因为本文件其余语句已在事务内，
-- CONCURRENTLY 不能在事务块中执行（同 077/457 既有做法）。
DROP INDEX IF EXISTS idx_tasks_dedup_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup_active
ON tasks (
  title,
  COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(project_id, '00000000-0000-0000-0000-000000000000')
)
WHERE status IN ('queued', 'in_progress')
  AND COALESCE(payload->>'dedup_by_notion_page', 'false') <> 'true';
