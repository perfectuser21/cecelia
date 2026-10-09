UPDATE ops_agents SET host_alias='hk-vps' WHERE source='openclaw' AND host_alias='us-vps';
UPDATE ops_source_heartbeats SET host_alias='hk-vps' WHERE source='openclaw' AND host_alias='us-vps';
