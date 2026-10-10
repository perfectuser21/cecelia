-- Migration 541: coding workflow 登记为框架里的一条流程 + 12 个 Activity（决策 b34e346a，审计 #24/#26）
--
-- 目的：runner 每个活动结束上报 span（POST /api/brain/spans，activity_id 必须是真实存在的 activities.id），
--   经 runs 触发器汇总，同步 Notion「最近执行」。
-- 挂载：能力「工厂 · F1 开发闭环」（e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29，迁移 398），与 harness_relay_pipeline 同级的新流程。
-- 照迁移 533 的做法：固定 id、WHERE EXISTS(能力) + ON CONFLICT DO NOTHING（测试库无该能力时整段空操作），
--   source_repo 留空（契约同步只认 zenithjoy-workspace，留空不会被它接管）。
-- 第一阶段只登记 Activity、不登记 Step：只报 Activity 级 span 时自动裁判判 no_data 不落库，格子不会被判红；
--   以后 runner 逐步上报 Step 级 span 再加 Step。
-- 活动 id 与 runner 上报用的 packages/brain/scripts/coding-workflow/runner/lib/spans.mjs 必须一致（有测试核对）。
-- 回滚：rollback/541_coding_workflow_activities.down.sql 按 id 删除。

BEGIN;

INSERT INTO workflows (id, capability_id, key, name, channel, form, version, status)
SELECT 'c0de0000-0000-4000-8000-000000000001'::uuid, 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'::uuid,
       'coding_workflow', 'Coding Workflow（需求→规格→合同对抗→开发→自测→PR→QA→裁判→合并）', 'internal', 'pipeline', '1.0', 'active'
 WHERE EXISTS (SELECT 1 FROM capabilities WHERE id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29')
ON CONFLICT (id) DO NOTHING;

INSERT INTO activities (id, name, description, status, executor_kind, promise, inputs, outputs, readback, backbone_version)
SELECT v.id::uuid, v.name, v.description, 'done', v.executor, v.promise, v.inputs::jsonb, v.outputs::jsonb, v.readback::jsonb, '3.0'
  FROM (VALUES
  ('c0de0000-0000-4000-8000-000000000101', '需求', 'coding workflow intent 活动：Brain 任务 → 01-intent.md + 01-invariants.md', 'code',
   '每个任务都有可验收的需求条目 I-n 和完整的铁律清单',
   '[{"type":"Task","fields":["id","title","description","payload.acceptance"]},{"type":"Decision","cardinality":"many","fields":["category=invariant","status=active"]}]',
   '[{"type":"SprintFile","effect":"create","fields":["01-intent.md","01-invariants.md"]}]',
   '[{"probe":"intent_ids_present","asserts":"01 至少一条 I-n"}]'),
  ('c0de0000-0000-4000-8000-000000000102', '规格', 'coding workflow spec 活动：写 02-spec.md（S-n 规格 + Q-n QA 场景 + 铁律对照 + 未覆盖真实链路）', 'agent',
   '规格覆盖全部 I-n，QA 场景自带数据可在空库复现',
   '[{"type":"SprintFile","fields":["01-intent.md","01-invariants.md"]}]',
   '[{"type":"SprintFile","effect":"create","fields":["02-spec.md"]}]',
   '[{"probe":"spec_check_pass","asserts":"02 通过程序校验（spec-check）"}]'),
  ('c0de0000-0000-4000-8000-000000000103', '合同对抗', 'coding workflow spec_review 活动：QA 立场评审 ⇄ 开发采纳/驳回，代码判分，按走势收敛', 'agent',
   '合同在 5 维评分全部达标且无开着的阻断/重要问题时通过；发散/震荡强制通过并升级',
   '[{"type":"SprintFile","fields":["02-spec.md"]}]',
   '[{"type":"SprintFile","effect":"create","cardinality":"many","fields":["02-review-rN.md","02-response-rN.md","02-review.md"]},{"type":"Decision","effect":"create","cardinality":"many","fields":["category=judgment"]}]',
   '[{"probe":"gan_verdict","asserts":"outputs.gan.verdict 为 APPROVED 或 FORCED（FORCED 必有升级）"}]'),
  ('c0de0000-0000-4000-8000-000000000104', '开发', 'coding workflow build 活动：按规格 TDD 开发并提交，本地跑 CI 门禁预检', 'agent',
   '实现覆盖全部 S-n，提交在分支上，CI 门禁预检通过或带失败交下游',
   '[{"type":"SprintFile","fields":["02-spec.md"]}]',
   '[{"type":"Commit","effect":"create","cardinality":"many"},{"type":"SprintFile","effect":"create","fields":["03-build.md"]}]',
   '[{"probe":"build_commits","asserts":"至少一个代码提交"}]'),
  ('c0de0000-0000-4000-8000-000000000105', '自测', 'coding workflow verify 活动：逐条 I-n 真跑命令取证，执行记录核对', 'agent',
   '每条 I-n 都有真实执行过的命令与输出，全部 PASS 才进 PR',
   '[{"type":"SprintFile","fields":["01-intent.md","02-spec.md"]}]',
   '[{"type":"SprintFile","effect":"create","fields":["04-evidence.md"]}]',
   '[{"probe":"evidence_verified","asserts":"04 每条证据在执行记录里查得到"}]'),
  ('c0de0000-0000-4000-8000-000000000106', '链路校验', 'coding workflow chain_check 活动：md 链上下游引用完整', 'code',
   '01→02→03→04 每一跳的 upstream 都覆盖上一级全部锚点',
   '[{"type":"SprintFile","cardinality":"many"}]',
   '[{"type":"ChainReport","effect":"create"}]',
   '[{"probe":"chain_complete","asserts":"没有断链"}]'),
  ('c0de0000-0000-4000-8000-000000000107', '开 PR', 'coding workflow publish 活动：推分支、开草稿 PR，正文带合同对抗、未覆盖真实链路与验收摘要', 'code',
   '每次交付都有一个 PR，正文能看出合同、未真验链路与验收结论',
   '[{"type":"Branch"}]',
   '[{"type":"PullRequest","effect":"create","fields":["url","branch"]}]',
   '[{"probe":"pr_url_present","asserts":"outputs.pr_url 非空"}]'),
  ('c0de0000-0000-4000-8000-000000000108', '回写', 'coding workflow report 活动：交付信息回写 Brain 任务 result.coding_workflow', 'code',
   'Brain 任务能看到 PR、链文件、合同对抗摘要与升级记录',
   '[{"type":"PullRequest","fields":["url"]}]',
   '[{"type":"Task","effect":"update","fields":["result.coding_workflow"]}]',
   '[{"probe":"brain_result_written","asserts":"Brain 任务 result.coding_workflow 带 pr_url"}]'),
  ('c0de0000-0000-4000-8000-000000000109', 'CI 修复', 'coding workflow runner：PR 必需检查红了按日志修复推送，修不动升级', 'agent',
   'CI 红的 PR 要么被修绿，要么升级给 coding commander，不会静默挂着',
   '[{"type":"PullRequest","fields":["number","head"]},{"type":"CheckRun","cardinality":"many","fields":["name","bucket=fail"]}]',
   '[{"type":"Commit","effect":"create","cardinality":"many"}]',
   '[{"probe":"ci_fix_outcome","asserts":"每次尝试都有 pushed/no_commit/失败原因记录"}]'),
  ('c0de0000-0000-4000-8000-00000000010a', '真人 QA', 'coding workflow runner：预览环境里按 Q-n 黑盒验收 + 探索测试，证据核对', 'agent',
   '在部署了 PR head 的预览环境里验完全部 Q-n，结论 PASS/FAIL/验不了 有真实证据',
   '[{"type":"PreviewEnvironment","fields":["url","git_sha=PR head"]},{"type":"SprintFile","fields":["01-intent.md","02-spec.md"]}]',
   '[{"type":"SprintFile","effect":"create","fields":["05-qa-report-rN.md","qa-rN/*.png"]}]',
   '[{"probe":"qa_evidence_verified","asserts":"报告每条命令在执行记录里查得到、没有恒真断言、没碰生产"}]'),
  ('c0de0000-0000-4000-8000-00000000010b', '独立裁判', 'coding workflow runner：异构模型对照需求、合同、QA 报告与代码改动给结论', 'agent',
   'QA PASS 的轮次都有独立裁判结论，产品/QA/合同三类问题分流处理',
   '[{"type":"SprintFile","fields":["01-intent.md","02-spec.md","05-qa-report-rN.md"]},{"type":"Diff"}]',
   '[{"type":"SprintFile","effect":"create","fields":["06-judge-rN.md"]}]',
   '[{"probe":"judge_verdict","asserts":"裁决 PASS/FAIL 带分类问题"}]'),
  ('c0de0000-0000-4000-8000-00000000010c', '合并', 'coding workflow runner 合并门：只合并 QA+裁判批准的那个 head，汇总花费、写交付复盘', 'code',
   '只有被批准的 head 能合并；合并后 Brain 有合并记录、全链花费与交付复盘',
   '[{"type":"PullRequest","fields":["number","head=approved head"]},{"type":"CheckRun","cardinality":"many","fields":["required=true","bucket=pass"]}]',
   '[{"type":"PullRequest","effect":"update","fields":["state=MERGED"]},{"type":"Task","effect":"update","fields":["result.merge","result.cost_usd"]},{"type":"Learning","effect":"create","cardinality":"many"}]',
   '[{"probe":"merged_head_matches","asserts":"合并的 head 等于批准的 head"}]')
  ) AS v(id, name, description, executor, promise, inputs, outputs, readback)
 WHERE EXISTS (SELECT 1 FROM capabilities WHERE id = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, active)
SELECT 'c0de0000-0000-4000-8000-000000000001'::uuid, r.slot_key, r.activity_id::uuid, r.seq, true
  FROM (VALUES
  ('intent',      'c0de0000-0000-4000-8000-000000000101', 1),
  ('spec',        'c0de0000-0000-4000-8000-000000000102', 2),
  ('spec_review', 'c0de0000-0000-4000-8000-000000000103', 3),
  ('build',       'c0de0000-0000-4000-8000-000000000104', 4),
  ('verify',      'c0de0000-0000-4000-8000-000000000105', 5),
  ('chain_check', 'c0de0000-0000-4000-8000-000000000106', 6),
  ('publish',     'c0de0000-0000-4000-8000-000000000107', 7),
  ('report',      'c0de0000-0000-4000-8000-000000000108', 8),
  ('ci_fix',      'c0de0000-0000-4000-8000-000000000109', 9),
  ('qa',          'c0de0000-0000-4000-8000-00000000010a', 10),
  ('judge',       'c0de0000-0000-4000-8000-00000000010b', 11),
  ('merge',       'c0de0000-0000-4000-8000-00000000010c', 12)
  ) AS r(slot_key, activity_id, seq)
 WHERE EXISTS (SELECT 1 FROM workflows WHERE id = 'c0de0000-0000-4000-8000-000000000001')
   AND EXISTS (SELECT 1 FROM activities WHERE id = r.activity_id::uuid)
ON CONFLICT DO NOTHING;

COMMIT;
