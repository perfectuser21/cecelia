-- Migration 173: 清理 memory_stream 过期记录
-- 删除 expires_at < NOW() 的记录（约 68k 条），减少向量搜索噪声
-- 保留 expires_at IS NULL 的永久记录

DELETE FROM memory_stream
WHERE expires_at IS NOT NULL
  AND expires_at < NOW();

-- 统计清理结果（记录到日志）
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'migration 173: 清理 memory_stream 过期记录 % 条', deleted_count;
END $$;
