-- 540: 获客业务数据三张 Notion 镜子库登记进注册表（任务 f6ad056e，决策 a029a7a7：PG 为真身，Notion 内部看，飞书给客户）
--
-- 真身在 hk-vps zenithjoy 库（zenithjoy.leadgen_videos / leadgen_comments / leadgen_leads），不在 cecelia 库，
-- 所以 brain_table 留空（先例：设备清单 / OPC 经营对象——真身在脚本/外部库的镜子）。
-- 血管 = zenithjoy-workspace services/phone-adb-controller/leadgen-notion-mirror.js，MMV launchd 每 5 分钟一轮：
-- hk-vps PG 只监听 127.0.0.1，us-vps Brain 无通道；MMV 已有常驻隧道 com.zenithjoy.pg-tunnel-hk。
-- 登记后：probeMirrorDbs 每轮探活（回收站/归档/404 进晨报）；notion-mirror-labels 因无 brain_table 跳过（库描述已由同步脚本写来源标记）。
-- 三库挂在「数据落脚总台账 › 获客业务数据（PG 镜像）」页下。重跑是空操作（唯一索引 notion_db_id + COALESCE(brain_table,'')）。
BEGIN;

SET LOCAL lock_timeout = '10s';

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('3f5c40c2-ba63-814c-ac06-e557331075f6', '获客·视频', 'mirror', NULL, 'push',
   'zenithjoy-workspace leadgen-notion-mirror.js（MMV launchd com.zenithjoy.leadgen-notion-mirror 每 5 分）', 'active', 'system',
   '真身 hk-vps zenithjoy.leadgen_videos；页身份=源ID列，指纹增量；飞书视频池照旧由 push-videos.js 写（客户交付）'),
  ('3f5c40c2-ba63-8187-a9e8-d3a4376ce622', '获客·评论', 'mirror', NULL, 'push',
   'zenithjoy-workspace leadgen-notion-mirror.js（MMV launchd com.zenithjoy.leadgen-notion-mirror 每 5 分）', 'active', 'system',
   '真身 hk-vps zenithjoy.leadgen_comments；页身份=源ID列，指纹增量；飞书原始评论池照旧由 push-raw-comments.js 写（客户交付）'),
  ('3f5c40c2-ba63-81bc-9613-cd71f15fdec5', '获客·线索', 'mirror', NULL, 'push',
   'zenithjoy-workspace leadgen-notion-mirror.js（MMV launchd com.zenithjoy.leadgen-notion-mirror 每 5 分）', 'active', 'system',
   '真身 hk-vps zenithjoy.leadgen_leads（意向等级/来源视频链接取评论池同昵称最近一条）；飞书线索表照旧由 push-leads.js / next-outreach.js 写（客户交付）')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('540', '获客·视频/评论/线索三张 Notion 镜子库登记 notion_projection_map（真身 hk-vps zenithjoy.leadgen_*）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
