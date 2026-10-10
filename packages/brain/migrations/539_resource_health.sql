-- 539: 资源健康进仓库（决策 de6dff5d 五块模型第 5 步，任务 5bf2512a）
-- 仓库 warehouse_items（8 货架）只登记「有什么」；本迁移补「现在能不能用」：
--   resource_health        每个资源一行当下健康（账号/手机/机器/仓库物件…），五态 + 原因 + 证据 + 来源 + 观测时间
--   resource_health_events 状态变化历史（触发器写，psql 直改也留痕）
--   v_warehouse_item_health 按仓库物件汇总最差状态
-- 不另造设备表：手机键 = device_locks / phone_registry 的 serial，账号键 = <平台>:<账号 id>，
-- 仓库物件键 = warehouse_items.key；warehouse_item_id 可选挂到仓库货架上的那件物件。
-- 观测时间一律取库时钟 now()（时钟死规矩：不收执行体自报时间戳），执行端自报时间只留在 reported_at。
BEGIN;

CREATE TABLE IF NOT EXISTS resource_health (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type     text NOT NULL CHECK (resource_type IN ('account', 'phone', 'machine', 'warehouse_item', 'service', 'other')),
  resource_key      text NOT NULL CHECK (length(resource_key) BETWEEN 1 AND 200),
  warehouse_item_id uuid REFERENCES warehouse_items(id) ON DELETE SET NULL,
  platform          text,
  status            text NOT NULL CHECK (status IN ('healthy', 'degraded', 'offline', 'restricted', 'unknown')),
  reason            text,
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source            text NOT NULL,
  observed_at       timestamptz NOT NULL DEFAULT now(),
  reported_at       timestamptz,
  status_since      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_key)
);
CREATE INDEX IF NOT EXISTS idx_resource_health_unhealthy ON resource_health (status) WHERE status <> 'healthy';
CREATE INDEX IF NOT EXISTS idx_resource_health_item ON resource_health (warehouse_item_id) WHERE warehouse_item_id IS NOT NULL;

COMMENT ON TABLE resource_health IS '资源当下健康（决策 de6dff5d 第 5 步）：一资源一行；offline/restricted 挡派发；变化历史见 resource_health_events';
COMMENT ON COLUMN resource_health.resource_key IS '手机=serial（同 device_locks/phone_registry），账号=<平台>:<账号 id>，仓库物件=warehouse_items.key';
COMMENT ON COLUMN resource_health.observed_at IS '最近一次观测（库时钟）；执行端自报时间在 reported_at';
COMMENT ON COLUMN resource_health.status_since IS '当前状态从何时开始（状态变化时 = 那次的 observed_at）';

CREATE TABLE IF NOT EXISTS resource_health_events (
  id                 bigserial PRIMARY KEY,
  resource_health_id uuid NOT NULL REFERENCES resource_health(id) ON DELETE CASCADE,
  resource_type      text NOT NULL,
  resource_key       text NOT NULL,
  from_status        text CHECK (from_status IS NULL OR from_status IN ('healthy', 'degraded', 'offline', 'restricted', 'unknown')),
  to_status          text NOT NULL CHECK (to_status IN ('healthy', 'degraded', 'offline', 'restricted', 'unknown')),
  reason             text,
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,
  source             text NOT NULL,
  observed_at        timestamptz NOT NULL DEFAULT now(),
  reported_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resource_health_events_resource ON resource_health_events (resource_type, resource_key, observed_at DESC);
COMMENT ON TABLE resource_health_events IS '资源健康状态变化历史（触发器写，状态不变不记）';

CREATE OR REPLACE FUNCTION resource_health_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_since := NEW.observed_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS resource_health_touch ON resource_health;
CREATE TRIGGER resource_health_touch BEFORE UPDATE ON resource_health
  FOR EACH ROW EXECUTE FUNCTION resource_health_touch();

CREATE OR REPLACE FUNCTION resource_health_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO resource_health_events
    (resource_health_id, resource_type, resource_key, from_status, to_status, reason, evidence, source, observed_at, reported_at)
  VALUES
    (NEW.id, NEW.resource_type, NEW.resource_key, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
     NEW.reason, NEW.evidence, NEW.source, NEW.observed_at, NEW.reported_at);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS resource_health_history ON resource_health;
CREATE TRIGGER resource_health_history AFTER INSERT OR UPDATE OF status ON resource_health
  FOR EACH ROW EXECUTE FUNCTION resource_health_record_change();

CREATE OR REPLACE VIEW v_warehouse_item_health AS
SELECT w.id AS warehouse_item_id, w.key, w.name, w.shelf,
       count(h.id)::int AS resources,
       count(h.id) FILTER (WHERE h.status = 'healthy')::int    AS healthy,
       count(h.id) FILTER (WHERE h.status = 'degraded')::int   AS degraded,
       count(h.id) FILTER (WHERE h.status = 'offline')::int    AS offline,
       count(h.id) FILTER (WHERE h.status = 'restricted')::int AS restricted,
       count(h.id) FILTER (WHERE h.status = 'unknown')::int    AS unknown,
       CASE max(CASE h.status WHEN 'restricted' THEN 5 WHEN 'offline' THEN 4 WHEN 'degraded' THEN 3
                              WHEN 'unknown' THEN 2 WHEN 'healthy' THEN 1 END)
         WHEN 5 THEN 'restricted' WHEN 4 THEN 'offline' WHEN 3 THEN 'degraded'
         WHEN 2 THEN 'unknown' WHEN 1 THEN 'healthy' END AS worst_status,
       max(h.observed_at) AS last_observed_at
  FROM warehouse_items w
  LEFT JOIN resource_health h ON h.warehouse_item_id = w.id
 GROUP BY w.id, w.key, w.name, w.shelf;
COMMENT ON VIEW v_warehouse_item_health IS '仓库物件健康汇总：挂在该物件上的资源各态计数与最差状态（无资源时 worst_status 为空）';

INSERT INTO schema_version (version, description)
VALUES ('539', '资源健康进仓库：resource_health 当下五态 + resource_health_events 状态变化历史（触发器）+ v_warehouse_item_health 汇总')
ON CONFLICT (version) DO NOTHING;

COMMIT;
