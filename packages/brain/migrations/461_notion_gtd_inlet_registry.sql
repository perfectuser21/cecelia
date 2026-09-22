-- 461: 秋米中文 GTD 表与英文 Tasks 库登记进 notion_projection_map（三面模型，决策 297ffee5 / b8abd28c）
-- 中文表 = 入口（人写、Brain 收，Brain 只回写 状态/OpenClaw任务号/OpenClaw结果/已完成/完成日期 五列）；
-- 英文库 = 入口兼镜（legacy pullNotionTasks + notion-gtd-sync 共用入账函数）。幂等：已登记不改。
-- 冲突目标取 453 建的唯一索引表达式 (notion_db_id, COALESCE(brain_table, ''))——本表无主键。
INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
('c69c40c2-ba63-8271-badf-01c5410d8929','秋米 任务（中文 GTD）','inlet','tasks','both','notion-gtd-sync.runGtdSyncOnce','active','private','列级分权：状态/OpenClaw任务号/OpenClaw结果/已完成/完成日期 由 Brain 回写；收集/下一个行动/阻塞/淘汰 人工专属'),
('d5bc40c2-ba63-82ef-965a-8153b7ad81a0','Tasks（英文，主理人排单）','inlet','tasks','both','notion-push-sync.ingestDelegatedPage + notion-gtd-sync','active','system','Delegated=交给 Brain；[zh:]/[en-native] 标记行→qiumi_task，其余→legacy dev 分支')
ON CONFLICT (notion_db_id, COALESCE(brain_table, '')) DO NOTHING;

-- executor_kind 扩 'openclaw-agent'：秋米入账（ingestQiumiPage）给任务打的执行体标记不在
-- 387 定下的七值白名单里，真库 smoke 实测 100% 撞 tasks_executor_kind_check（单元测试 mock 了
-- createRoutedTask 所以照不出来）。与 387 同因同治：只放宽约束，不回填历史行。
--
-- 照 PR1 459 的拆法：ADD CONSTRAINT ... NOT VALID 只做目录项登记（毫秒级，不扫存量行），
-- 新写入立即受约束；"确认全表已合规"挪到 462 的 VALIDATE CONSTRAINT（SHARE UPDATE
-- EXCLUSIVE 锁，不挡并发读写），与本文件的 ACCESS EXCLUSIVE 分处两个事务。
-- tasks 是高频写表，DROP+ADD 在同一事务里扫全表会挡住派发/回写。
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
      'codex-review-local',
      'openclaw-agent'
    )) NOT VALID;

INSERT INTO schema_version (version, description)
VALUES ('461', 'notion_projection_map 登记秋米中文 GTD 表 + 英文 Tasks 库（face=inlet）+ executor_kind 扩 openclaw-agent')
ON CONFLICT (version) DO NOTHING;
