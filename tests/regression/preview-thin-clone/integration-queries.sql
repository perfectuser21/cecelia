-- BEHAVIOR-03: 排除表 schema 必须存在（期望 count = 7）
SELECT count(*) AS schema_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'memory_stream', 'cecelia_events', 'alertness_metrics',
    'checkpoint_writes', 'checkpoint_blobs', 'checkpoints', 'captures'
  );

-- BEHAVIOR-04: 排除表数据必须为空（每张期望 count = 0）
SELECT count(*) FROM memory_stream;
SELECT count(*) FROM cecelia_events;
SELECT count(*) FROM alertness_metrics;
SELECT count(*) FROM checkpoint_writes;
SELECT count(*) FROM checkpoint_blobs;
SELECT count(*) FROM checkpoints;
SELECT count(*) FROM captures;
