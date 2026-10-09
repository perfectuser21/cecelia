-- 448: device_locks 纳管安卓手机（管家 G5 横切件，task 104ab89f）
--
-- 加 host/device_type 两列：本期仅登记元数据（手机会换宿主，锁按 serial 键），
-- 派发不做主机路由校验。种子 4 台手机 = 2026-09-16 xian-m1/xian-m4 adb 实采。
-- 释放/抢占语义见 src/device-lock-helpers.js。

ALTER TABLE device_locks ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE device_locks ADD COLUMN IF NOT EXISTS device_type TEXT;

UPDATE device_locks SET device_type = 'machine' WHERE device_type IS NULL;

INSERT INTO device_locks (device_name, host, device_type)
VALUES
  ('ANGYVB4311010223', 'xian-m1', 'phone'),
  ('e6c7ef34',         'xian-m1', 'phone'),
  ('ANGYVB4227006983', 'xian-m4', 'phone'),
  ('ANGYVB4402004137', 'xian-m4', 'phone')
ON CONFLICT (device_name) DO UPDATE
  SET host = EXCLUDED.host, device_type = EXCLUDED.device_type;

INSERT INTO schema_version (version, description)
VALUES ('448', 'device_locks 纳管安卓手机: host/device_type 列 + 4 台手机种子')
ON CONFLICT (version) DO NOTHING;
