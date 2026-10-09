-- 445: OpenClaw 账本 host_alias 迁移 hk-vps → us-vps（2026-09-14）
-- 容器 09-12 已迁 us-vps；UPDATE 保 notion_id/历史，先清可能的同名冲突行。
DELETE FROM ops_source_heartbeats WHERE source='openclaw' AND host_alias='us-vps';
UPDATE ops_source_heartbeats SET host_alias='us-vps' WHERE source='openclaw' AND host_alias='hk-vps';
DELETE FROM ops_agents a USING ops_agents b
 WHERE a.source='openclaw' AND a.host_alias='us-vps'
   AND b.source='openclaw' AND b.host_alias='hk-vps' AND a.name=b.name;
UPDATE ops_agents SET host_alias='us-vps' WHERE source='openclaw' AND host_alias='hk-vps';
