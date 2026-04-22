# Brain 迁 Docker + OrbStack 设计

**日期**: 2026-04-22
**分支**: cp-0422122621-brain-dockerize-orbstack
**Task**: 6c0d5ac9-d4bb-46ea-8c70-0f68dab27c2f

## 背景

### 现状

Brain 裸跑 macOS，由 `/Library/LaunchDaemons/com.cecelia.brain.plist`（system-scope launchd）管控。`KeepAlive=true` + `ThrottleInterval=10`。

实测 12 小时内 system launchd 记录 6 次 `service inactive` 事件（Brain 异常退出后 launchd 重启），Brain.log 里累计 36 次 startup self-check。每次 Brain 重启在内存里的状态全丢（PR #2519 给 Phase A GAN 加了 PostgresSaver 续跑，但 tick dispatch / slot allocator / circuit breaker 等状态仍全内存）。

### 根因

`[osservice<com.cecelia.brain(501)>:19882] is not RunningBoard jetsam managed` —— macOS 明确不给 Brain jetsam 优先级保护，当系统内存紧张按 RSS 大小排序杀。

macOS 内存压力历史记录：System available 常年 272-646 MB（colima VM 以前 10GB，macOS 本体没多少空间）。

### 已做的前置工作

1. **PR #2519**：Phase A GAN → LangGraph + PostgresSaver checkpoint（Brain 挂也能续跑 GAN）
2. **OrbStack 替换 colima**：VM RSS 7.4 GB → 0.8 GB，释放 6.6 GB 给宿主
3. **colima 彻底卸载**：释放 ~100 GB 磁盘

当前 macOS 内存压力已大幅缓解（1+ GB free），但 Brain 仍裸跑，jetsam 风险仍在。

## 目标

把 Brain 从裸跑 macOS 迁进 OrbStack 容器，享受 **Docker cgroup 硬预留 + 和 macOS jetsam 完全隔离**。Brain 不再是 macOS jetsam 的候选者。

## 架构

### 层级模型（Sibling Containers 模式）

```
OrbStack Linux VM（6 GB / 6 CPU）
 ├─ cecelia-node-brain 容器          ← 新增（本次工程）
 │   └─ node server.js (Brain)        1 GB 上限，512 MB 预留
 │       └─ docker CLI                挂 host docker.sock 调 dockerd
 │           └─ spawn sibling containers ↓
 │
 └─ cecelia-task-xxxxx（临时）        ← Pipeline runner（已在跑）
     └─ Claude CLI / Node / etc.        cecelia/runner:latest
```

**关键**：Brain 和 Pipeline 容器是 VM 里的**同级兄弟**（sibling），不是 Docker-in-Docker。Brain 通过挂载 `/var/run/docker.sock` 直接调 dockerd，所有容器共享同一个 OrbStack VM 的内核。

### 对外接口（和裸跑完全一致）

| 外部调用方 | 地址 | 到达方式 |
|-----------|------|---------|
| macOS 本机 curl / gh 工具 | `localhost:5221` | OrbStack 自动 port forward 5221 |
| Host postgres | 容器内 `host.docker.internal:5432` | OrbStack 原生支持 |
| Host ~/.credentials、claude 凭据 | 只读挂载 | bind mount |
| Host docker.sock | `/var/run/docker.sock` | bind mount（在 OrbStack 里是 `/Users/administrator/.orbstack/run/docker.sock`） |

### 不兼容的 Linux-only 特性 + 替代方案

现有 `docker-compose.yml` 是为 Linux VPS 设计的，以下特性在 macOS/OrbStack 无法用：

| Linux 特性 | 原目的 | Mac 替代 |
|-----------|--------|---------|
| `network_mode: host` | 容器直接用宿主网络栈 | **bridge 网络 + 端口 forward `5221:5221`** |
| `pid: host` | watchdog 读 `/proc/<hostpid>/statm` 监控宿主进程 | **移除**。watchdog 降级为只看容器内自己的 PID namespace |
| `/home/xx/...` 路径 | Linux 用户 home | **`/Users/administrator/...`** |

**`pid: host` 移除影响**：watchdog.js 里有"监控宿主 node 进程 RSS/CPU"的逻辑。迁 Docker 后 Brain 看不到宿主 PID，此能力失效。但 Brain 自己在容器内（cgroup 硬限）就不需要自己盯自己，让 Docker daemon 管就够了。副作用：`/api/brain/resources` 返回的宿主 CPU/内存数据可能变空或显示容器内数据。可接受。

## 配置改动

### docker-compose.yml

主改动项：

```diff
 services:
   node-brain:
     image: cecelia-brain:${BRAIN_VERSION:-latest}
     container_name: cecelia-node-brain
-    network_mode: host
-    pid: host
+    ports:
+      - "5221:5221"
     read_only: true
     tmpfs:
       - /tmp:size=100M
     volumes:
-      - /home/xx/.claude:/home/xx/.claude:ro
-      - /home/xx/bin:/home/xx/bin:ro
-      - /home/xx/.credentials:/home/cecelia/.credentials:ro
-      - /home/xx/.claude-account1:/home/cecelia/.claude-account1:ro
-      - /home/xx/.claude-account2:/home/cecelia/.claude-account2:ro
-      - /home/xx/.claude-account3:/home/cecelia/.claude-account3:ro
-      - /home/xx/perfect21/cecelia/packages/workflows:/home/xx/perfect21/cecelia/packages/workflows:ro
-      - /home/xx/perfect21/cecelia/packages/config:/config:ro
-      - /home/xx/perfect21/cecelia/HEARTBEAT.md:/HEARTBEAT.md:rw
-      - /home/xx/perfect21/cecelia/packages/workflows/staff/workers.config.json:/home/xx/perfect21/cecelia/packages/workflows/staff/workers.config.json:rw
+      # docker.sock: Brain 要 spawn pipeline 兄弟容器
+      - /var/run/docker.sock:/var/run/docker.sock
+      # Skills + credentials
+      - /Users/administrator/.claude:/Users/administrator/.claude:ro
+      - /Users/administrator/.credentials:/home/cecelia/.credentials:ro
+      - /Users/administrator/.claude-account1:/home/cecelia/.claude-account1:ro
+      - /Users/administrator/.claude-account2:/home/cecelia/.claude-account2:ro
+      - /Users/administrator/.claude-account3:/home/cecelia/.claude-account3:ro
+      # Workflows + config
+      - /Users/administrator/perfect21/cecelia/packages/workflows:/Users/administrator/perfect21/cecelia/packages/workflows:ro
+      - /Users/administrator/perfect21/cecelia/packages/config:/config:ro
+      - /Users/administrator/perfect21/cecelia/HEARTBEAT.md:/HEARTBEAT.md:rw
+      - /Users/administrator/perfect21/cecelia/packages/workflows/staff/workers.config.json:/Users/administrator/perfect21/cecelia/packages/workflows/staff/workers.config.json:rw
+      # 宿主 worktrees 根目录（Brain spawn pipeline 容器时要 mount 宿主的 worktree 进去）
+      - /Users/administrator/perfect21/cecelia/.claude/worktrees:/Users/administrator/perfect21/cecelia/.claude/worktrees:rw
+      - /Users/administrator/worktrees:/Users/administrator/worktrees:rw
       - /etc/localtime:/etc/localtime:ro
-      - /etc/timezone:/etc/timezone:ro
     environment:
       - TZ=Asia/Shanghai
-      - DB_HOST=${DB_HOST:-localhost}
+      # host.docker.internal: OrbStack 原生支持，容器内这个地址到宿主 127.0.0.1
+      - DB_HOST=${DB_HOST:-host.docker.internal}
       - DB_PORT=${DB_PORT:-5432}
       ...
-      - CECELIA_RUN_PATH=/home/xx/bin/cecelia-run
-      - HOST_HOME=/home/xx
+      - CECELIA_RUN_PATH=/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh
+      - HOST_HOME=/Users/administrator
     deploy:
       resources:
         limits:
-          memory: 4G
+          memory: 1G
+          cpus: '2'
         reservations:
           memory: 512M
```

### Brain Dockerfile 不动

当前 Dockerfile 是 node:20-alpine，已正确。不改。

### 镜像构建

保留 `scripts/brain-build.sh`，不改。

### 启动/停止脚本

新增 `scripts/brain-docker-up.sh` / `scripts/brain-docker-down.sh`：
- up 脚本：`launchctl unload` 裸跑 Brain → `docker-compose up -d node-brain` → 健康检查
- down 脚本：`docker-compose down` → `launchctl load` 恢复裸跑（紧急回滚）

这两个脚本让切换操作原子、可逆。

## 组件

### 1. `docker-compose.yml`（改）

唯一一份 compose 文件。macOS 是 production 环境，Linux 路径历史遗留，直接覆盖。如未来要跑 Linux VPS，届时分叉 `docker-compose.linux.yml`。

### 2. `scripts/brain-docker-up.sh`（新）

```bash
#!/usr/bin/env bash
set -euo pipefail
# 1. 停 launchd Brain
sudo launchctl unload /Library/LaunchDaemons/com.cecelia.brain.plist 2>&1 | tail -1
# 2. 等 5221 端口释放（最多 15 秒）
for i in {1..15}; do
  lsof -i :5221 -t >/dev/null 2>&1 || break
  sleep 1
done
# 3. 用 compose 启 Brain
cd /Users/administrator/perfect21/cecelia
docker-compose up -d node-brain
# 4. 等容器 healthy（最多 60 秒）
for i in {1..60}; do
  if docker inspect --format '{{.State.Health.Status}}' cecelia-node-brain 2>/dev/null | grep -q healthy; then
    echo "✅ Brain container healthy"
    exit 0
  fi
  sleep 1
done
echo "❌ Brain container not healthy after 60s"
docker logs --tail 30 cecelia-node-brain
exit 1
```

### 3. `scripts/brain-docker-down.sh`（新）

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /Users/administrator/perfect21/cecelia
docker-compose down node-brain
sudo launchctl load /Library/LaunchDaemons/com.cecelia.brain.plist
echo "✅ Rolled back to bare-metal launchd Brain"
```

## 数据流

### 启动流

```
brain-docker-up.sh
  ├─ launchctl unload → 裸跑 Brain 进程退出
  ├─ docker-compose up -d node-brain
  │    └─ OrbStack 拉起 cecelia-brain:latest 容器
  │        ├─ mount docker.sock / credentials / workflows
  │        ├─ expose port 5221
  │        └─ 跑 node server.js（entrypoint tini + node）
  ├─ Brain 在容器内启动：
  │    ├─ DB 连 host.docker.internal:5432（postgres 仍在宿主）
  │    ├─ Migrations 幂等（已跑过的 SKIP）
  │    ├─ Self-check 6/6
  │    └─ Tick loop 起来
  └─ Healthcheck 轮询 curl localhost:5221/api/brain/tick/status
       ├─ PASS → ✅ 完成切换
       └─ FAIL → 手动 brain-docker-down.sh 回滚
```

### Brain 派 Pipeline 容器

```
Brain 容器内 tick dispatch
  └─ docker-executor.executeInDocker(...)
       └─ spawn 'docker', ['run', '--rm', '--name=cecelia-task-xxx', ...]
            └─ docker CLI 走挂载的 /var/run/docker.sock
                 └─ dockerd 在同一 OrbStack VM 里起兄弟容器 cecelia-task-xxx
                      └─ mount worktree（宿主路径 /Users/administrator/.claude/worktrees/...）
```

### 宿主到 Brain 的请求

```
curl localhost:5221/api/brain/tick/status (macOS shell)
  └─ OrbStack port forward 5221 → 容器内 5221
       └─ Brain 返回 JSON
```

## 错误处理

| 故障 | 现象 | 恢复 |
|------|------|------|
| docker-compose 启动失败 | 容器没起来 | 脚本 timeout 退出，`launchctl load` 回滚 |
| Brain 内部挂了 | 容器退出 | `restart: unless-stopped` + Docker daemon 10 秒内重启 |
| 容器到 host postgres 连不上 | Self-check 失败 | healthcheck 失败 → 容器 restart，log 查 `host.docker.internal:5432` |
| Sibling 容器 spawn 失败 | docker.sock 挂载问题 | 检查挂载路径，OrbStack 是 `~/.orbstack/run/docker.sock`，被 symlink 到 `/var/run/docker.sock` |
| 内存超限被 cgroup kill | Brain exit=137 | 说明 1GB 不够（实际历史峰值 608MB），拉到 2GB |
| docker.sock 权限 denied | 容器内 non-root user | 容器里 cecelia user (uid 1001) 需在 docker group，或用 root 跑（简单安全起见用 root） |

## 范围限定

**在范围内**：
- 改 `docker-compose.yml` 路径/端口/网络模式（Linux → macOS）
- 新增 `brain-docker-up.sh` / `brain-docker-down.sh` 切换脚本
- 构建 `cecelia-brain:latest` 镜像
- 执行切换（launchctl unload + compose up）
- 冒烟验证（curl, tick, pipeline spawn）

**不在范围内**：
- Brain 代码层改动（watchdog.js `pid:host` 的降级行为，后续 Sprint 处理）
- 迁 Postgres 进 Docker（让它留宿主，最稳）
- 真机跑完整 Initiative 2303a935 Phase A（独立验证，不在本 Sprint）
- 迁 frontend / Dashboard 容器（独立任务）

## 成功标准

- **SC-001**: `docker-compose up -d node-brain` 后 `docker inspect cecelia-node-brain` 显示 `healthy`
- **SC-002**: `curl -f localhost:5221/api/brain/tick/status` 返回 200 OK
- **SC-003**: `curl -X POST localhost:5221/api/brain/tick` 能触发一次 dispatch，log 里能看到 `docker-executor spawn ...`（验证 sibling 容器能起）
- **SC-004**: 容器 RSS 稳态 < 700MB（`docker stats cecelia-node-brain`）
- **SC-005**: 任意时刻 `docker kill cecelia-node-brain` 后容器在 10 秒内自动 restart 且健康
- **SC-006**: `brain-docker-down.sh` 能回滚到裸跑 Brain 并正常工作（灾难演练）

## 假设

- [ASSUMPTION: OrbStack 的 host.docker.internal 地址是稳定的](https://docs.orbstack.dev/docker/network) —— 官方支持特性
- [ASSUMPTION: postgres 继续跑在宿主，端口 5432 监听](OK)
- [ASSUMPTION: ~/.credentials 路径不变](已验证在 /Users/administrator/.credentials)
- [ASSUMPTION: cecelia-brain:latest 镜像 build 成功](由 brain-build.sh 保证)

## 边界情况

- **端口冲突**：launchctl unload 后 5221 释放，docker-compose 再拿。如果第三方占了 5221，up 脚本里 timeout 15s 就退出报错，不静默失败。
- **docker.sock 权限**：macOS 下 `/var/run/docker.sock` 是 OrbStack symlink，用户 administrator 可读写。容器内 cecelia user 需要访问，Dockerfile 里要么把 cecelia 加 docker group（group gid 可能不匹配），要么直接 `USER root` 跑。简单起见让 Brain 容器以 **root** 跑（权衡：mount 出来的只读 credentials 仍受保护，容器 read_only filesystem，攻击面有限）。
- **Brain 写 worktrees 目录**：Harness worktree 在宿主 `/Users/administrator/.claude/worktrees`，需要 `rw` 挂载（不是 `ro`），且容器内以 root 跑能写。
- **Migrations 幂等**：Brain 启动会跑 `241_` 系列 SQL，都已 `IF NOT EXISTS` 保护。

## 预期受影响文件

```
docker-compose.yml                                      (改 Brain service 主体)
scripts/brain-docker-up.sh                              (新建)
scripts/brain-docker-down.sh                            (新建)
packages/brain/Dockerfile                               (可能改 USER root)
docs/superpowers/specs/2026-04-22-brain-dockerize-orbstack-design.md  (本文档)
docs/learnings/cp-0422122621-brain-dockerize-orbstack.md             (Ship 时写)
```
