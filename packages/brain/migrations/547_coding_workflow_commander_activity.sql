-- Migration 547: coding workflow 第 13 个 Activity「coding commander」（决策 c167d6e3）
-- runner 在 QA 门 / CI 修复升级后起 Opus 会话裁决并解除，每次介入上报 span（occurrence commander:<pr>:c<n>）。
-- 照迁移 542：固定 id、WHERE EXISTS(流程) + ON CONFLICT DO NOTHING（测试库无该流程时空操作）。
-- 活动 id 与 runner/lib/spans.mjs 的 ACTIVITY_IDS.commander 一致（有测试核对）。
-- 回滚：rollback/547_coding_workflow_commander_activity.down.sql。

BEGIN;

INSERT INTO activities (id, name, description, status, executor_kind, promise, inputs, outputs, readback, backbone_version)
SELECT 'c0de0000-0000-4000-8000-00000000010d'::uuid, 'coding commander',
       'coding workflow runner：PR 升级后起 Opus 会话按规格逐条裁决——维持/追加规格裁决节、TDD 修代码、追加 CI 额度，程序核对后解除升级；不能处理的 Bark 主理人',
       'done', 'agent',
       '升级了的 PR 要么被 commander 裁决解除并继续自动流程，要么带原因通知主理人，不会静默挂着',
       '[{"type":"Escalation","fields":["type","pr"]},{"type":"SprintFile","cardinality":"many","fields":["01-intent.md","02-spec.md","05-qa-report-rN.md","06-judge-rN.md"]}]'::jsonb,
       '[{"type":"SprintFile","effect":"create","fields":["07-commander-rN.md"]},{"type":"Commit","effect":"create","cardinality":"many"},{"type":"Task","effect":"update","fields":["result.commander_overrides"]}]'::jsonb,
       '[{"probe":"escalation_released_or_human","asserts":"升级被解除（有裁决记录）或 commander_human 带原因"}]'::jsonb,
       '3.0'
 WHERE EXISTS (SELECT 1 FROM workflows WHERE id = 'c0de0000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, active)
SELECT 'c0de0000-0000-4000-8000-000000000001'::uuid, 'commander', 'c0de0000-0000-4000-8000-00000000010d'::uuid, 13, true
 WHERE EXISTS (SELECT 1 FROM workflows WHERE id = 'c0de0000-0000-4000-8000-000000000001')
   AND EXISTS (SELECT 1 FROM activities WHERE id = 'c0de0000-0000-4000-8000-00000000010d')
ON CONFLICT DO NOTHING;

COMMIT;
