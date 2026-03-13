-- Migration 152: 初始化 ZenithJoy 2026 Q1 OKR 种子数据
--
-- 背景：zenithjoy 部门派发冻结，原因是 goals 表中无 metadata->>'dept' = 'zenithjoy' 的 goal，
-- 导致 lookupDeptPrimaryGoal() 返回 null，heartbeat 任务 goal_id=null。
-- 本 migration 插入 Q1 OKR + 3 KR，恢复 zenithjoy 部门正常调度。
--
-- 幂等：ON CONFLICT (id) DO NOTHING，可重复执行无副作用。

DO $$
DECLARE
  v_vision_id uuid := 'bb000001-2026-4000-8000-000000000001';
  v_kr1_id    uuid := 'bb000002-2026-4000-8000-000000000002';
  v_kr2_id    uuid := 'bb000003-2026-4000-8000-000000000003';
  v_kr3_id    uuid := 'bb000004-2026-4000-8000-000000000004';
BEGIN

  -- Vision: ZenithJoy 2026 Q1 OKR（带 dept 标记，供 lookupDeptPrimaryGoal 检索）
  INSERT INTO goals (id, title, type, status, priority, progress, weight, metadata, created_at, updated_at)
  VALUES (
    v_vision_id,
    'ZenithJoy 2026 Q1 - 多平台内容创作自动化',
    'vision',
    'in_progress',
    'P0',
    0,
    1.0,
    '{"dept": "zenithjoy", "quarter": "2026Q1", "description": "zenithjoy 部门 Q1 核心目标：发布/采集/内容生成全链路自动化"}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- KR1: 发布自动化（当前 30% → 目标 100%）
  INSERT INTO goals (id, parent_id, title, type, status, priority, progress, weight, metadata, created_at, updated_at)
  VALUES (
    v_kr1_id,
    v_vision_id,
    'KR1：多平台发布全自动化（发布成功率 30% → 100%）',
    'area_okr',
    'in_progress',
    'P0',
    30,
    1.0,
    '{"dept": "zenithjoy", "kr_index": 1, "metric_from": 30, "metric_to": 100, "metric_unit": "%", "category": "publish_automation"}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- KR2: 数据采集（当前 0% → 目标 100%）
  INSERT INTO goals (id, parent_id, title, type, status, priority, progress, weight, metadata, created_at, updated_at)
  VALUES (
    v_kr2_id,
    v_vision_id,
    'KR2：全平台数据自动采集（采集覆盖率 0% → 100%）',
    'area_okr',
    'in_progress',
    'P0',
    0,
    1.0,
    '{"dept": "zenithjoy", "kr_index": 2, "metric_from": 0, "metric_to": 100, "metric_unit": "%", "category": "data_collection"}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- KR3: 内容生成（当前 20% → 目标 100%）
  INSERT INTO goals (id, parent_id, title, type, status, priority, progress, weight, metadata, created_at, updated_at)
  VALUES (
    v_kr3_id,
    v_vision_id,
    'KR3：AI 内容自动生成（自动化率 20% → 100%）',
    'area_okr',
    'in_progress',
    'P0',
    20,
    1.0,
    '{"dept": "zenithjoy", "kr_index": 3, "metric_from": 20, "metric_to": 100, "metric_unit": "%", "category": "content_generation"}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

END $$;

INSERT INTO schema_version (version, description)
VALUES ('152', 'seed ZenithJoy 2026 Q1 OKR + 3 KRs to restore dept dispatch (metadata.dept=zenithjoy)')
ON CONFLICT (version) DO NOTHING;
