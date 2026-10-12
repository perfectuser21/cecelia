-- 迁移 553（任务 c5f6e683，派发总闸 G）：统一领单租约 + 设备池。
--
-- 1) task_leases：外部执行者经 POST /api/brain/tasks/:id/claim 带 lease_seconds 领单时落一行，
--    POST /tasks/:id/heartbeat 续约；Brain 自派 openclaw-agent 时按「超时 + 余量」落 Brain 租约（claimer 为空）。
--    scheduler job task-lease-reaper 每 60s 收过期租约：按任务类型的现有语义回队（requeue）或判 lost（failed），
--    并释放该任务持有的设备锁。单独成表不给 tasks 加列（tasks 是宽表，投影/同步面多）。
-- 2) 设备锁跟租约走：device-lock-helpers 的占用判据改为「持有任务 in_progress 且租约未过期」，
--    无租约的旧持有者最多保护到 locked_at + 240 分钟（TTL 上限），不再被 in_progress 无限压住。
-- 3) device_pools / device_pool_members：手机按池（同平台 + 同账号类型）登记，派发时按 priority 依次试锁，
--    不可用（锁被占 / 资源不健康 / 未注册）自动换下一台。种子只放「抖音·内部号」池里当前真实在用的一台
--    （小彩 / Ai办公室）；把其他手机加进池要主理人确认账号属内部号再加（加行即可，不需迁移）。
-- 回滚：rollback/553_task_leases_device_pools.down.sql

CREATE TABLE IF NOT EXISTS task_leases (
  task_id          UUID        PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  claimer          TEXT,
  source           TEXT        NOT NULL DEFAULT 'claim',
  on_expire        TEXT        NOT NULL DEFAULT 'auto',
  lease_seconds    INTEGER     NOT NULL,
  lease_until      TIMESTAMPTZ NOT NULL,
  claimed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at     TIMESTAMPTZ,
  heartbeat_count  INTEGER     NOT NULL DEFAULT 0,
  extend_count     INTEGER     NOT NULL DEFAULT 0,
  released_at      TIMESTAMPTZ,
  release_reason   TEXT,
  CONSTRAINT task_leases_on_expire_check CHECK (on_expire IN ('auto', 'requeue', 'fail')),
  CONSTRAINT task_leases_source_check CHECK (source IN ('claim', 'brain')),
  CONSTRAINT task_leases_seconds_check CHECK (lease_seconds > 0)
);

CREATE INDEX IF NOT EXISTS idx_task_leases_active_until
  ON task_leases (lease_until) WHERE released_at IS NULL;

COMMENT ON TABLE task_leases IS
  '统一领单租约（任务 c5f6e683）：claim 带 lease_seconds 落行、heartbeat 续约、task-lease-reaper 收过期（回队或判 lost）并放设备锁；source=brain 为 Brain 自派 openclaw-agent 的超时租约';
COMMENT ON COLUMN task_leases.on_expire IS
  'auto=按任务类型现有语义（执行者合同 onStale：requeue/release-claim-and-alert→回队，其余→判 lost）；requeue/fail=领单方显式指定';

CREATE TABLE IF NOT EXISTS device_pools (
  pool_key      TEXT        PRIMARY KEY,
  platform      TEXT        NOT NULL,
  account_kind  TEXT        NOT NULL,
  description   TEXT,
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_pools_key_check CHECK (pool_key ~ '^[a-z0-9_]+\.[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS device_pool_members (
  pool_key     TEXT        NOT NULL REFERENCES device_pools(pool_key) ON DELETE CASCADE,
  serial       TEXT        NOT NULL,
  account_ref  TEXT        NOT NULL,
  priority     INTEGER     NOT NULL DEFAULT 100,
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_key, serial)
);

COMMENT ON TABLE device_pools IS
  '设备池（任务 c5f6e683）：同平台 + 同账号类型的手机一池，pool_key=<平台>.<账号类型>；派发从池里按 priority 选可用的一台';
COMMENT ON TABLE device_pool_members IS
  '池成员：serial 对 phone_registry/device_locks，account_ref=该机在此池用的账号（调度单 biz）；机器/profile 取 phone_registry';

INSERT INTO device_pools (pool_key, platform, account_kind, description)
VALUES ('douyin.internal', 'douyin', 'internal', '抖音·内部号（公司号=内部，决策 3df71dd4）：抖音视频发布 workflow 从此池选机')
ON CONFLICT (pool_key) DO NOTHING;

INSERT INTO device_pool_members (pool_key, serial, account_ref, priority, note)
VALUES ('douyin.internal', 'ANGYVB4311010223', 'Ai办公室', 10, '小彩 / 抖音号 90915521618；原 factory-workflows.json 抖音发布固定机')
ON CONFLICT (pool_key, serial) DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('553', '统一领单租约 task_leases + 设备池 device_pools/device_pool_members（派发总闸 G，任务 c5f6e683）')
ON CONFLICT (version) DO NOTHING;
