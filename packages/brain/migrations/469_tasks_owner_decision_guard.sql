-- Migration 469: tasks.blocked_reason='owner_decision' 协议触发器（链 bf5088a3 棒5，任务 3fad28e0，决策 105a5868 ②）
--
-- 病根：09-23 五把刀 blocked=owner_decision 却没写等什么，真因其实是机器故障，主理人被迫每天来问进度。
-- 应用层入口（blockTask / POST /tasks / createRoutedTask）已用 lib/owner-decision.js 校验；
-- 本触发器兜 psql / 任意 SQL 直写这条最后的门——SQL 侧镜像同一份协议：
--   blocked_detail 必带 question(非空串) / options(数组≥2) / default(非空) / deadline(可解析时间) /
--   reversible(布尔) / waiting_on(human|machine)，缺任一项抛 23514（路由层已有 23514→400 映射）。
--
-- 只拦「新写入」：INSERT，或 UPDATE 时 blocked_reason / blocked_detail 相对旧值有变。
-- 存量 blocked 行不回填、不报错——对它们改别的列 / 变终态 / 解除阻塞都不触发。
-- WHEN 子句让触发器只在 NEW.blocked_reason='owner_decision' 时进函数，tasks 热表其余写入零开销。

CREATE OR REPLACE FUNCTION tasks_owner_decision_protocol_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d jsonb;
  bad text[] := ARRAY[]::text[];
  ts timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.blocked_reason IS NOT DISTINCT FROM NEW.blocked_reason
     AND OLD.blocked_detail IS NOT DISTINCT FROM NEW.blocked_detail THEN
    RETURN NEW;
  END IF;

  d := NEW.blocked_detail;
  IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN
    d := '{}'::jsonb;
  END IF;

  IF NOT (CASE WHEN jsonb_typeof(d->'question') = 'string' THEN btrim(d->>'question') <> '' ELSE false END) THEN
    bad := bad || 'question'::text;
  END IF;
  IF NOT (CASE WHEN jsonb_typeof(d->'options') = 'array' THEN jsonb_array_length(d->'options') >= 2 ELSE false END) THEN
    bad := bad || 'options'::text;
  END IF;
  IF NOT (CASE
            WHEN d->'default' IS NULL OR jsonb_typeof(d->'default') = 'null' THEN false
            WHEN jsonb_typeof(d->'default') = 'string' THEN btrim(d->>'default') <> ''
            ELSE true
          END) THEN
    bad := bad || 'default'::text;
  END IF;
  IF jsonb_typeof(d->'deadline') = 'string' THEN
    BEGIN
      ts := (d->>'deadline')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      bad := bad || 'deadline'::text;
    END;
  ELSE
    bad := bad || 'deadline'::text;
  END IF;
  IF jsonb_typeof(d->'reversible') IS DISTINCT FROM 'boolean' THEN
    bad := bad || 'reversible'::text;
  END IF;
  IF NOT (jsonb_typeof(d->'waiting_on') = 'string' AND (d->>'waiting_on') IN ('human', 'machine')) THEN
    bad := bad || 'waiting_on'::text;
  END IF;

  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'owner_decision_protocol_violation: blocked_detail 缺/非法字段 ' || array_to_string(bad, ','),
      HINT = 'blocked_reason=owner_decision 必带 blocked_detail{question,options[2+],default,deadline,reversible,waiting_on:human|machine}（决策 105a5868）';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_owner_decision_protocol ON tasks;
CREATE TRIGGER trg_tasks_owner_decision_protocol
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW
  WHEN (NEW.blocked_reason = 'owner_decision')
  EXECUTE FUNCTION tasks_owner_decision_protocol_guard();

INSERT INTO schema_version (version, description)
VALUES ('469', 'tasks.blocked_reason=owner_decision 协议触发器（blocked_detail 必带 question/options/default/deadline/reversible/waiting_on；只拦新写入）')
ON CONFLICT (version) DO NOTHING;
