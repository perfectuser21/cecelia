-- Migration 065: Device Locks - 设备锁表
--
-- 功能：部门主管架构中，脚本员工独占设备时的互斥锁
-- 设备：win-pc（浏览器发布）、mac-mini（本地计算）、nas-write（NAS 写操作）
--
-- 先到先得，用完释放，超时自动失效。
-- Brain 提供 acquire/release API，部门主管在派脚本员工前调用。

-- ============================================================
-- 1. Create device_locks table
-- ============================================================
CREATE TABLE IF NOT EXISTS device_locks (
  device_name  TEXT        PRIMARY KEY,
  locked_by    TEXT,                          -- task_id 或 run_id
  locked_at    TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ                    -- 超时后视为空闲，可被抢占
);

-- ============================================================
-- 2. Seed known devices (unlocked by default)
-- ============================================================
INSERT INTO device_locks (device_name, locked_by, locked_at, expires_at)
VALUES
  ('win-pc',    NULL, NULL, NULL),
  ('mac-mini',  NULL, NULL, NULL),
  ('nas-write', NULL, NULL, NULL)
ON CONFLICT (device_name) DO NOTHING;

-- ============================================================
-- 3. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('065', 'Device Locks - 脚本员工设备互斥锁')
ON CONFLICT (version) DO NOTHING;
