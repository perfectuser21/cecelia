-- 回滚 488：删补登记行；部门日报推送方回「待核」；两视图别名行回 453 原样 pending_vessel。
BEGIN;
DELETE FROM notion_projection_map
 WHERE notion_db_id IN ('3d6c40c2-ba63-811f-a83e-f981a044617d', '3dbc40c2-ba63-81eb-b0c8-c571370b0f68',
                        '684c40c2-ba63-83a7-b6ba-8161f110a18c', '3b7c40c2-ba63-814b-b713-c350e5c5e356',
                        '3b7c40c2-ba63-8101-a1d1-e48a975a4204');
UPDATE notion_projection_map
   SET vessel = '(推送方待核)',
       notes = NULLIF(regexp_replace(COALESCE(notes, ''), '(；)?推送方迁移 488 核实（数据源=飞书经营对象表，非 Brain）$', ''), ''),
       updated_at = NOW()
 WHERE notion_db_id = '3dbc40c2-ba63-8168-8ec5-ea3aba0f25b9' AND vessel LIKE '%opc-daily-page.py upsert_dept_rows%';
UPDATE notion_projection_map
   SET status = 'pending_vessel', direction = 'none', vessel = '(有 notion_id 列无血管)',
       notes = '验收判据表；生产 2026-09-19 守夜 dryRun 揪出', updated_at = NOW()
 WHERE notion_db_id = 'unmapped:acceptance_criteria';
UPDATE notion_projection_map
   SET status = 'pending_vessel', direction = 'none', vessel = '(有 notion_id 列无血管)',
       notes = 'migration 249 旧特征注册表；同上', updated_at = NOW()
 WHERE notion_db_id = 'unmapped:features_registry';
DELETE FROM schema_version WHERE version = '488';
COMMIT;
