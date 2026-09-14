## Brain {VERSION} — OpenClaw 采集腿改本机直取（容器已迁 us-vps）

- 旧命令 ssh hk-vps 找 openclaw-gateway 在 09-12 容器迁移后必然 No such container，腿常年 unreachable
- 改经挂载 docker.sock 本机 docker exec 直取；host_alias 账随 migration 445 迁 us-vps（保 notion_id）
