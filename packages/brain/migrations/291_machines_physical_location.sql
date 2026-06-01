-- Migration 291: 给 8 台机器的 metadata 加 physical_location（实际地理位置）
-- 与 effective_country（流量出口国家）区分，Dashboard 按 physical_location 分组

UPDATE system_registry SET metadata = metadata || '{"physical_location":"US"}'::jsonb
WHERE type = 'machine' AND name IN ('mac-mini-m4-us', 'vps-us');

UPDATE system_registry SET metadata = metadata || '{"physical_location":"HK"}'::jsonb
WHERE type = 'machine' AND name = 'vps-hk';

UPDATE system_registry SET metadata = metadata || '{"physical_location":"Xian"}'::jsonb
WHERE type = 'machine' AND name IN ('mac-mini-m1-xian', 'mac-mini-m4-xian', 'xian-pc', 'xian-rog', 'zenithjoy-nas');

INSERT INTO schema_version (version, description)
VALUES ('291', '给 machines 加 physical_location 字段')
ON CONFLICT (version) DO NOTHING;
