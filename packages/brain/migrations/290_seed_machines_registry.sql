-- Migration 290: 种入 8 台常驻机器到 system_registry
-- 使用 ON CONFLICT (name, type) DO UPDATE 确保幂等

INSERT INTO system_registry (name, type, location, description, metadata) VALUES

('mac-mini-m4-us', 'machine', '38.23.47.81',
 '美国 Mac mini M4，主力研发机',
 '{"hardware":"Mac mini M4","os":"macOS","tailscale_name":"mac-mini-m4-us","tailscale_ip":"100.71.151.105","public_ip":"38.23.47.81","ssh_alias":"mmv","ssh_user":"administrator","exit_node":null,"effective_country":"US","offers_exit_node":false,"role":"主力研发机","tags":["brain","claude-code","codex"],"accounts":["codex-team1","codex-team2"],"services":[{"name":"Brain API","port":5221,"type":"orbstack","needs_cn_ip":false,"description":"核心任务调度 API"},{"name":"Cecelia Bridge","port":3457,"type":"launchd","needs_cn_ip":false,"description":"本机 Codex 调度桥"},{"name":"PostgreSQL","port":5432,"type":"orbstack","internal":true}],"deprecated":[],"notes":"Brain + Claude Code 主机"}'),

('mac-mini-m1-xian', 'machine', '100.88.166.55',
 '西安 Mac mini M1，RPA 执行机（Tailscale 命名有误含 us）',
 '{"hardware":"Mac mini M1","os":"macOS","tailscale_name":"mac-mini-m1-us","tailscale_ip":"100.88.166.55","public_ip":"117.36.7.184","ssh_alias":"xian-m1","ssh_user":"xx-macmini","exit_node":null,"effective_country":"CN","offers_exit_node":false,"role":"RPA 执行机（社媒发布）","tags":["rpa","xian","chrome"],"accounts":[],"services":[{"name":"Chrome XHS","type":"launchd","needs_cn_ip":true,"description":"小红书 RPA 浏览器"},{"name":"Chrome Douyin","type":"launchd","needs_cn_ip":true,"description":"抖音 RPA 浏览器"},{"name":"L4 Monitor","type":"launchd","needs_cn_ip":false,"description":"网络层监控"},{"name":"SOCKS Proxy","port":1080,"type":"launchd","description":"SSH tunnel → vps-hk"}],"ssh_tunnels":["vps-hk"],"deprecated":[],"notes":"Tailscale 命名含 us 但实际在西安，走中国直连"}'),

('mac-mini-m4-xian', 'machine', '100.86.57.69',
 '西安 Mac mini M4，Codex 执行机',
 '{"hardware":"Mac mini M4","os":"macOS","tailscale_name":"mac-mini-m4-xian","tailscale_ip":"100.86.57.69","public_ip":"117.36.7.184","ssh_alias":"xian-mac","ssh_user":"jinnuoshengyuan","exit_node":"vps-us","exit_node_ip":"134.199.234.147","effective_country":"US","offers_exit_node":false,"socks_proxy":"127.0.0.1:1080","ssh_tunnels":["vps-hk"],"role":"Codex 执行机","tags":["codex","xian"],"accounts":["codex-team3","codex-team4","codex-team5"],"services":[{"name":"Codex Bridge","port":3457,"type":"launchd","needs_cn_ip":false,"description":"接收 Brain 任务，调用 Codex CLI"},{"name":"PostgreSQL","port":5432,"type":"homebrew","internal":true}],"deprecated":[{"name":"clawdbot","reason":"小龙虾项目暂停，待卸载"}],"notes":"exit node 走美国，Codex 访问 OpenAI 正常"}'),

('xian-pc', 'machine', '100.97.242.124',
 '西安 PC，Windows RPA 执行机',
 '{"hardware":"PC","os":"Windows","tailscale_name":"XIAN-PC","tailscale_ip":"100.97.242.124","ssh_alias":"xian-pc","exit_node":null,"effective_country":"CN","offers_exit_node":false,"role":"Windows RPA 执行机","tags":["rpa","xian","windows"],"accounts":[],"services":[],"deprecated":[],"notes":""}'),

('xian-rog', 'machine', '100.98.253.95',
 '西安 ROG，Windows RPA 备用机',
 '{"hardware":"ROG 台式机","os":"Windows","tailscale_name":"XX-ROG","tailscale_ip":"100.98.253.95","ssh_alias":"xian-rog","exit_node":null,"effective_country":"CN","offers_exit_node":false,"role":"Windows RPA 备用机","tags":["rpa","xian","windows"],"accounts":[],"services":[],"deprecated":[],"notes":""}'),

('zenithjoy-nas', 'machine', '100.110.241.76',
 '西安 NAS，文件存储 & 内容同步',
 '{"hardware":"NAS","os":"Linux","tailscale_name":"ZenithJoy_NAS","tailscale_ip":"100.110.241.76","ssh_alias":"nas","exit_node":null,"effective_country":"CN","offers_exit_node":false,"role":"文件存储 & 内容同步","tags":["nas","xian","storage"],"accounts":[],"services":[{"name":"文件存储","description":"内容素材、视频文件存储"},{"name":"NAS Content Manager","description":"内容同步脚本"}],"deprecated":[],"notes":""}'),

('vps-hk', 'machine', '124.156.138.116',
 '香港 VPS，公网入口 & AI 执行节点',
 '{"hardware":"VPS 4核8GB","os":"Linux","tailscale_name":"VM-0-8-ubuntu","tailscale_ip":"100.86.118.99","public_ip":"124.156.138.116","ssh_alias":"hk-vps","exit_node":null,"effective_country":"HK","offers_exit_node":true,"role":"公网入口 & AI 执行节点","tags":["vps","hk","exit-node","docker"],"accounts":[],"services":[{"name":"Cecelia Bridge (HK)","port":5225,"type":"systemd","needs_cn_ip":false,"description":"HK 节点任务桥"},{"name":"MiniMax Executor","port":5226,"type":"systemd","needs_cn_ip":false,"description":"MiniMax API 执行器 v2.0"},{"name":"Brain Proxy","port":5221,"type":"socat","description":"转发到美国 M4 Brain API"},{"name":"Cecelia Core","port":5211,"type":"docker","description":"Cecelia 核心服务"},{"name":"Cecelia Frontend","port":5212,"type":"docker","description":"Cecelia 前端"},{"name":"Autopilot Dashboard","port":80,"type":"docker","description":"自动驾驶仪 dashboard"},{"name":"Autopilot Dev","port":520,"type":"docker"},{"name":"Xray Reality","port":8443,"type":"docker","description":"VPN 入口节点"},{"name":"Xray Relay","port":18443,"type":"docker","description":"VPN 中继"},{"name":"VPN Subscription","port":8080,"type":"docker","description":"VPN 订阅服务"},{"name":"Feishu Login","type":"docker","description":"飞书登录服务"},{"name":"Cloudflare Tunnel","type":"docker","description":"Cloudflare 内网穿透"},{"name":"流量密码 Data Deck","port":8899,"type":"python","description":"流量分析 dashboard"}],"deprecated":[],"notes":"提供 Tailscale exit node，是 HK 出口"}'),

('vps-us', 'machine', '134.199.234.147',
 '美国 VPS，Tailscale Exit Node & ZenithJoy 生产',
 '{"hardware":"VPS 1核2GB","os":"Linux","tailscale_name":"sf-vps","tailscale_ip":"100.79.41.61","public_ip":"134.199.234.147","ssh_alias":"us-vps","exit_node":null,"effective_country":"US","offers_exit_node":true,"role":"Tailscale Exit Node & ZenithJoy 生产","tags":["vps","us","exit-node","zenithjoy"],"accounts":[],"services":[{"name":"ZenithJoy API","port":5200,"type":"docker","internal":true,"description":"ZenithJoy 后端 API"},{"name":"ZenithJoy PostgreSQL","type":"docker","internal":true},{"name":"Xray Reality","port":443,"type":"docker","description":"VPN 出口节点"},{"name":"VPN Subscription","port":8080,"type":"docker"},{"name":"Cloudflare Tunnel","type":"docker"}],"deprecated":[],"notes":"西安 M4 的 Tailscale exit node"}')

ON CONFLICT (name, type) DO UPDATE SET
  location = EXCLUDED.location,
  description = EXCLUDED.description,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO schema_version (version, description)
VALUES ('290', '种入 8 台常驻机器数据到 system_registry')
ON CONFLICT (version) DO NOTHING;
