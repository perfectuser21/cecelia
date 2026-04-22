# Brain 迁 Docker + OrbStack（2026-04-22）

## 做了什么

把 Brain 从 launchd 裸跑 macOS 迁进 OrbStack Docker 容器，享受 Docker cgroup 硬预留 + 和 macOS jetsam 完全隔离。

核心改动：
- `docker-compose.yml` node-brain service 适配 macOS/OrbStack（移除 `network_mode:host`+`pid:host`，加端口 forward + docker.sock 挂载 + /Users/administrator 路径）
- `packages/brain/Dockerfile` 重写支持 npm workspaces monorepo（从仓库根构建，`npm ci --workspace=packages/brain --omit=dev`）+ 加 `docker-cli` apk 包 + USER root
- `scripts/brain-build.sh` context 从 brain dir 改到 repo root，`-f packages/brain/Dockerfile`
- 新建 `scripts/brain-docker-up.sh` / `scripts/brain-docker-down.sh` 一键切换 + 回滚
- 新建 `.env.docker`（gitignored），配 `EXECUTOR_BRIDGE_URL=http://host.docker.internal:3457`

### 根本原因

Brain 裸跑 macOS 被 jetsam 杀的根因：`runningboardd` 明确标 Brain 为 "not jetsam managed"，当系统内存压力大时按 RSS 排序，Brain 250-600 MB 是一等候选。12 小时内 launchd 重启 Brain 6 次（Brain log 里 108 次 self-check）。

### 下次预防

- [ ] 长驻 orchestrator daemon 在 macOS 上默认容器化，不裸跑
- [ ] npm workspaces monorepo 的 Dockerfile 必须从 repo root 作为 build context（否则 deps hoisted 到 root 但容器看不到）
- [ ] Alpine base image 要手动 `apk add docker-cli` 才能调 dockerd（默认不带）
- [ ] macOS 下 LaunchDaemons（system scope）+ LaunchAgents（user scope）可能同时配同一 plist，切换脚本必须两个 scope 都 unload
- [ ] `docker kill` 不会触发 `restart:unless-stopped`（该 policy 认为是用户主动停）。要测自愈用 `kill -TERM 1` 从容器内发信号给 tini

## 技术要点

- **host.docker.internal**：OrbStack 原生代理，容器内访问此地址等价连宿主 127.0.0.1。postgres trust auth（pg_hba 127.0.0.1/32 trust）直接通，不需要密码。
- **npm workspaces**：root 有 `workspaces:['packages/*','apps/*']`，deps hoist 到 `root/node_modules`。Brain Dockerfile 必须从 root context 构建，`COPY package.json package-lock.json ./` + `COPY packages/brain/package.json packages/brain/`，然后 `npm ci --workspace=packages/brain`。
- **docker CLI in container**：`apk add --no-cache docker-cli` 给 Alpine 装 docker 客户端。挂 `/var/run/docker.sock` 后容器内 `docker ps` 能看到宿主所有容器（包括自己）。
- **EXECUTOR_BRIDGE_URL**：Brain 需要一个 localhost:3457 的 bridge（裸跑宿主）spawn 任务。容器内必须换成 `host.docker.internal:3457`。
- **USER root vs cecelia**：原 Dockerfile USER cecelia (uid 1001)，但 macOS 宿主没 docker group，cecelia 无权读 docker.sock。直接 root 最简单；安全边界靠 compose `read_only: true` + 凭据 `:ro` 挂载 + tmpfs `/tmp:100M`。
- **StartedAt vs RestartCount**：`docker kill` 不更新 StartedAt 也不涨 RestartCount（用户主动停）；`kill -TERM 1` 从容器内发给 tini → tini 优雅退出 → 容器 exit → Docker auto-restart，StartedAt 更新，RestartCount+1。

## 冒烟验证

```bash
# 1. 切换裸跑 → 容器
bash scripts/brain-docker-up.sh
# Expected: "✅ Brain 容器 healthy (6s)"

# 2. HTTP 5221 通
curl -fs localhost:5221/api/brain/tick/status
# Expected: JSON with enabled:true, loop_running:true

# 3. 内存稳态
docker stats --no-stream cecelia-node-brain
# Expected: MEM 50-150 MB / 1 GB (< 15%)

# 4. 容器内 docker CLI + 能 spawn 兄弟容器
docker exec cecelia-node-brain docker ps
# Expected: 看到 cecelia-node-brain + sibling cecelia-task-* 容器

# 5. 自愈（kill -TERM PID 1）
docker exec cecelia-node-brain kill -TERM 1
sleep 15
# Expected: StartedAt 变，RestartCount=1，Health 1-10s 恢复 healthy

# 6. 紧急回滚
bash scripts/brain-docker-down.sh
# Expected: 裸跑 Brain 30s 内恢复（launchctl load 两 scope）
```

实测结果：全部通过。Brain 容器内存 ~50 MB（vs 裸跑峰值 608 MB），Dispatch 链路（Brain→bridge→executor）贯通，sibling pipeline 容器 spawn 正常。
