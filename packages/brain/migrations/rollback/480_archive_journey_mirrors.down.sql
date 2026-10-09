-- 回滚 480：AI Journey / AI Feature 两登记行还原 push/active。
-- 回滚后两库仍在回收站，推送照旧 404——这是回滚到"已知坏"状态，不是修复；notes 不还原（留痕）。
BEGIN;
UPDATE notion_projection_map
   SET status = 'active', direction = 'push', vessel = 'notion-push-sync.pushJourneys', updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a' AND brain_table = 'journeys';
UPDATE notion_projection_map
   SET status = 'active', direction = 'push', vessel = 'notion-push-sync.pushJourneyFeatures', updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-81e3-96c5-d762b3d34dff' AND brain_table = 'journey_features';
DELETE FROM schema_version WHERE version = '480';
COMMIT;
