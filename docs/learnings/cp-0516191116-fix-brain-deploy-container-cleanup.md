# Brain Deploy 容器命名冲突修复

## 问题描述

`brain-deploy.sh` 第 7 步 `docker compose up -d` 会遇到容器命名冲突：旧容器 `cecelia-node-brain` 停了但未删除，新容器创建时名字被占 → 变成 `Created` 状态卡住 → Brain 起不来。

### 根本原因

`docker compose down` / `docker stop` 只停容器不删容器。下次 `docker compose up -d` 尝试创建同名容器时，Docker 发现同名容器已存在（即使处于 exited/created 状态），导致新容器卡在 Created 状态无法启动。

### 下次预防

- [ ] 在任何 `docker compose up -d` 前，先清理 exited/created 状态的同名容器
- [ ] 部署脚本中的容器生命周期管理：stop/start 替换为 rm + create 的完整循环
- [ ] 监控 `docker ps -a` 中 created 状态的容器，作为部署失败的早期信号
