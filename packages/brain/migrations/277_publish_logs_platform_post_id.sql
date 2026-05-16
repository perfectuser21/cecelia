-- Migration 277: zenithjoy.publish_logs 添加 platform_post_id 字段
-- 存储各平台发布后返回的文章/消息 ID（微信 media_id/msg_id、其他平台同理）
-- 用途：KR2 数据回流验收，发布成功率统计关联实测数据

ALTER TABLE zenithjoy.publish_logs
  ADD COLUMN IF NOT EXISTS platform_post_id TEXT;

COMMENT ON COLUMN zenithjoy.publish_logs.platform_post_id
  IS '平台侧发布 ID，如微信 msg_id/media_id，由发布任务 result 字段回流';
