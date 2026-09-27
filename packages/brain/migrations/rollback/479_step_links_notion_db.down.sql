-- 回滚 479：删「承诺地图格子」登记、旧 Backbone-Step Map 行还原 push/active。
-- 记账列不回填：旧 notion_id 指向回收站页、种子 synced_at 本就是假同步，回填只会把假象抬回来；
-- 回滚后旧库仍在回收站，推送照旧 404——这是回滚到"已知坏"状态，不是修复。
BEGIN;
DELETE FROM notion_projection_map WHERE notion_db_id = '3e8c40c2-ba63-8194-a47c-dcf5f4b508bb' AND brain_table = 'journey_step_links';
UPDATE notion_projection_map
   SET status = 'active', direction = 'push', vessel = 'notion-push-sync.pushJourneyStepLinks', updated_at = NOW()
 WHERE notion_db_id = '369c40c2-ba63-81e2-b95a-e5e3d0592676' AND brain_table = 'journey_step_links';
DELETE FROM schema_version WHERE version = '479';
COMMIT;
