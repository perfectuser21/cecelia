# Brain Dockerize on OrbStack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Brain 从裸跑 macOS 迁进 OrbStack 容器，用 Docker cgroup 替代 macOS jetsam 保护，让 Brain 不再被系统内存压力误杀。

**Architecture:** 改 `docker-compose.yml` 的 Brain service：Linux 路径 → macOS 路径、`network_mode: host` → 端口 forward、`pid: host` 移除、加 docker.sock 挂载让 Brain 能 spawn sibling pipeline 容器。新增 up/down 切换脚本，launchctl unload → `docker-compose up -d`，可一键回滚。

**Tech Stack:** OrbStack（代替 colima）、Docker Compose、cecelia-brain:latest 镜像（基于 node:20-alpine）、Postgres 仍裸跑宿主、launchd plist 保留用作回滚。

---

## File Structure

### 改动

**`docker-compose.yml`** — 单一 compose 文件，macOS 路径
- 本次全部改 node-brain service：路径、网络、端口、内存、docker.sock 挂载
- frontend service 不动（后续任务）

**`packages/brain/Dockerfile`** — 改 USER 行
- `USER cecelia` 改 `USER root`（让容器内能用 /var/run/docker.sock，避免 gid 错配）
- 容器仍 `read_only: true` + 只读挂载 credentials，root 风险受控

### 新建

**`scripts/brain-docker-up.sh`** — 切换到 Docker 运行的脚本
- launchctl unload 裸跑 → 等端口释放 → docker-compose up → 等 healthy

**`scripts/brain-docker-down.sh`** — 紧急回滚到裸跑
- docker-compose down → launchctl load 裸跑 Brain

**`docs/learnings/cp-0422122621-brain-dockerize-orbstack.md`** — 迁移 Learning（Task 6 写）

### 保留（不动，供回滚用）

- `/Library/LaunchDaemons/com.cecelia.brain.plist` — launchd 裸跑配置，unload 后不删

---

## Task 1: 改 docker-compose.yml 的 Brain service

**Files:**
- Modify: `docker-compose.yml` (Brain service 部分)

- [ ] **Step 1.1: 改 Brain service 网络 + 端口**

`docker-compose.yml` 第 7-15 行（node-brain 配置段头）改为：

```yaml
services:
  node-brain:
    image: cecelia-brain:${BRAIN_VERSION:-latest}
    container_name: cecelia-node-brain
    ports:
      - "5221:5221"
    read_only: true
    tmpfs:
      - /tmp:size=100M
```

删除这两行（macOS 不支持）：
```yaml
    network_mode: host
    pid: host  # Required: watchdog.js reads /proc/<hostpid>/statm ...
```

- [ ] **Step 1.2: 改 volumes 段 Linux → macOS 路径 + 加 docker.sock**

整个 `volumes:` 段替换成：

```yaml
    volumes:
      # Docker socket: Brain 调 dockerd spawn 兄弟 pipeline 容器
      - /var/run/docker.sock:/var/run/docker.sock
      # Skills + cecelia-run (read-only)
      - /Users/administrator/.claude:/Users/administrator/.claude:ro
      # Credentials (read-only, mapped to container user homedir)
      - /Users/administrator/.credentials:/home/cecelia/.credentials:ro
      # Claude account credentials for account-usage API (homedir mapping)
      - /Users/administrator/.claude-account1:/home/cecelia/.claude-account1:ro
      - /Users/administrator/.claude-account2:/home/cecelia/.claude-account2:ro
      - /Users/administrator/.claude-account3:/home/cecelia/.claude-account3:ro
      # Workflows: staff + skills + agents
      - /Users/administrator/perfect21/cecelia/packages/workflows:/Users/administrator/perfect21/cecelia/packages/workflows:ro
      # Config: OKR validation spec
      - /Users/administrator/perfect21/cecelia/packages/config:/config:ro
      # HEARTBEAT.md (read-write)
      - /Users/administrator/perfect21/cecelia/HEARTBEAT.md:/HEARTBEAT.md:rw
      # workers.config.json (read-write)
      - /Users/administrator/perfect21/cecelia/packages/workflows/staff/workers.config.json:/Users/administrator/perfect21/cecelia/packages/workflows/staff/workers.config.json:rw
      # Worktree 根目录（Brain spawn harness/pipeline 容器时要 mount 宿主 worktree）
      - /Users/administrator/perfect21/cecelia/.claude/worktrees:/Users/administrator/perfect21/cecelia/.claude/worktrees:rw
      - /Users/administrator/worktrees:/Users/administrator/worktrees:rw
      # Timezone (read-only)
      - /etc/localtime:/etc/localtime:ro
```

- [ ] **Step 1.3: 改 environment 段 DB_HOST 和 HOST_HOME**

在 `environment:` 段中找到这 4 行并替换：

```yaml
      - DB_HOST=${DB_HOST:-host.docker.internal}   # 原 localhost → 容器内访问宿主
      ...
      - CECELIA_RUN_PATH=/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh
      - HOST_HOME=/Users/administrator
```

- [ ] **Step 1.4: 改 deploy.resources 内存上限**

`deploy:` 段改成：

```yaml
    deploy:
      resources:
        limits:
          memory: 1G       # 原 4G → 1G（实际峰值 608MB，1.5x buffer）
          cpus: '2'        # 新增：CPU 限 2 核
        reservations:
          memory: 512M
```

- [ ] **Step 1.5: 校验 yaml 合法性**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
docker compose config 2>&1 | head -30
```

Expected: 输出解析后的 compose 配置，无 yaml 语法错误。如失败看输出定位错行。

- [ ] **Step 1.6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
git add docker-compose.yml
git commit -m "feat(compose): node-brain service 适配 macOS/OrbStack

- 路径 /home/xx → /Users/administrator
- 移除 network_mode:host 和 pid:host（Mac 不支持）
- 加 ports: 5221:5221 端口 forward
- 加 /var/run/docker.sock 挂载，让 Brain 能 spawn 兄弟容器
- 加 worktrees 目录挂载（harness initiative runner 要用）
- DB_HOST localhost → host.docker.internal（OrbStack 原生支持）
- memory limit 4G → 1G（峰值 608MB，1.5x buffer）
- 新增 cpus:'2' CPU 限额

Task: 6c0d5ac9-d4bb-46ea-8c70-0f68dab27c2f

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dockerfile 改 USER root

**Files:**
- Modify: `packages/brain/Dockerfile`

- [ ] **Step 2.1: 改 USER 指令**

在 `packages/brain/Dockerfile` 里找：
```dockerfile
# Non-root user
USER cecelia
```

改为：
```dockerfile
# Root user: 容器内需要访问 /var/run/docker.sock 调 dockerd spawn 兄弟容器
# macOS gid 和容器内 docker group gid 可能错配，用 root 最简单可靠
# 安全边界：read_only filesystem + 只读凭据挂载 + tmpfs /tmp 只 100MB
USER root
```

- [ ] **Step 2.2: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
git add packages/brain/Dockerfile
git commit -m "fix(brain-dockerfile): USER cecelia → root 让容器访问 docker.sock

macOS gid 和 Linux docker group gid 错配（macOS 没 docker group），用户侧加
group 不稳。容器仍 read_only + 凭据只读挂载 + tmpfs 100M，安全边界足够。

Task: 6c0d5ac9-d4bb-46ea-8c70-0f68dab27c2f

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 创建 brain-docker-up.sh 切换脚本

**Files:**
- Create: `scripts/brain-docker-up.sh`

- [ ] **Step 3.1: 写脚本**

Create `scripts/brain-docker-up.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="/Library/LaunchDaemons/com.cecelia.brain.plist"

echo "=== Brain Docker 切换：从裸跑 → 容器 ==="

# 1. 卸 launchd 裸跑 Brain
if sudo launchctl list com.cecelia.brain 2>/dev/null | grep -q PID; then
  echo "→ 卸 launchd 裸跑 Brain"
  sudo launchctl unload "$PLIST"
else
  echo "→ launchd Brain 已未加载，跳过"
fi

# 2. 等端口 5221 释放（最多 15 秒）
echo "→ 等端口 5221 释放..."
for i in {1..15}; do
  if ! lsof -i :5221 -t >/dev/null 2>&1; then
    echo "  ✅ 端口已释放 ($(( i ))s)"
    break
  fi
  sleep 1
  if [ "$i" -eq 15 ]; then
    echo "  ❌ 端口 5221 15 秒内没释放，其他进程占用"
    lsof -i :5221 | head
    exit 1
  fi
done

# 3. 起 Docker Brain 容器
echo "→ docker-compose up -d node-brain"
cd "$ROOT_DIR"
docker-compose up -d node-brain

# 4. 等容器 healthy（最多 90 秒 — 含 40s start_period + migration 时间）
echo "→ 等容器 healthy..."
for i in {1..90}; do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' cecelia-node-brain 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    echo "  ✅ Brain 容器 healthy ($(( i ))s)"
    docker ps --filter name=cecelia-node-brain --format '{{.Names}}\t{{.Status}}'
    exit 0
  fi
  if [ "$STATUS" = "unhealthy" ]; then
    echo "  ❌ Brain 容器 unhealthy"
    docker logs --tail 50 cecelia-node-brain
    exit 1
  fi
  sleep 1
done

echo "❌ 容器 90s 内没 healthy，当前状态: $STATUS"
docker logs --tail 30 cecelia-node-brain
exit 1
```

- [ ] **Step 3.2: 赋可执行 + 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
chmod +x scripts/brain-docker-up.sh
git add scripts/brain-docker-up.sh
git commit -m "feat(scripts): brain-docker-up.sh 一键切到容器运行

- launchctl unload 裸跑 Brain
- 等端口 5221 释放（15s timeout）
- docker-compose up -d node-brain
- 等容器 healthy（90s timeout，含 40s start_period + migration）
- 失败打 docker logs tail 30 便于排错

Task: 6c0d5ac9-d4bb-46ea-8c70-0f68dab27c2f

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 创建 brain-docker-down.sh 回滚脚本

**Files:**
- Create: `scripts/brain-docker-down.sh`

- [ ] **Step 4.1: 写脚本**

Create `scripts/brain-docker-down.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="/Library/LaunchDaemons/com.cecelia.brain.plist"

echo "=== Brain 紧急回滚：从容器 → 裸跑 ==="

# 1. 停容器
echo "→ docker-compose down node-brain"
cd "$ROOT_DIR"
docker-compose stop node-brain 2>/dev/null || true
docker-compose rm -f node-brain 2>/dev/null || true

# 2. 等 5221 释放
for i in {1..10}; do
  ! lsof -i :5221 -t >/dev/null 2>&1 && break
  sleep 1
done

# 3. 拉起 launchd 裸跑
echo "→ launchctl load 裸跑 Brain"
sudo launchctl load "$PLIST"

# 4. 等端口就绪（最多 30 秒）
for i in {1..30}; do
  if curl -fs http://localhost:5221/api/brain/tick/status >/dev/null 2>&1; then
    echo "  ✅ 裸跑 Brain 已恢复 ($(( i ))s)"
    ps -ef | grep 'brain/server.js' | grep -v grep | head -1
    exit 0
  fi
  sleep 1
done

echo "❌ 裸跑 Brain 30s 内没起来，手动排查"
exit 1
```

- [ ] **Step 4.2: 赋可执行 + 提交**

```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
chmod +x scripts/brain-docker-down.sh
git add scripts/brain-docker-down.sh
git commit -m "feat(scripts): brain-docker-down.sh 紧急回滚到裸跑 Brain

灾难场景：Docker Brain 挂了恢复不了 / 配置有 bug。
脚本：stop 容器 → launchctl load plist → 等 curl 通。

Task: 6c0d5ac9-d4bb-46ea-8c70-0f68dab27c2f

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 构建 cecelia-brain:latest 镜像

**Files:** (只本地 docker 动作，不改文件)

- [ ] **Step 5.1: 运行 brain-build.sh**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
bash scripts/brain-build.sh
```

Expected 输出末尾：
```
=== Build complete ===
  cecelia-brain:<version>
  cecelia-brain:latest
  Size: ~200-300MB
```

- [ ] **Step 5.2: 验证镜像存在**

Run:
```bash
docker images cecelia-brain --format '{{.Repository}}:{{.Tag}} {{.Size}}'
```

Expected:
```
cecelia-brain:<version> <size>
cecelia-brain:latest    <size>
```

- [ ] **Step 5.3: 冒烟 — 不启动 Brain，只检查镜像能跑**

Run:
```bash
docker run --rm cecelia-brain:latest node --version
```

Expected: `v20.x.x` 输出，容器秒退。

- [ ] **Step 5.4: 不需要 commit（镜像在 docker 里，不在仓库）**

---

## Task 6: 执行切换 + 冒烟验证

**Files:** (只执行，不改文件)

- [ ] **Step 6.1: 确认当前裸跑 Brain 活着**

Run:
```bash
curl -fs http://localhost:5221/api/brain/tick/status | head -c 100
echo ""
ps -ef | grep 'brain/server' | grep -v grep | head -1
```

Expected: 200 响应 JSON + 看到 node 进程。

- [ ] **Step 6.2: 执行切换脚本**

Run:
```bash
bash /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack/scripts/brain-docker-up.sh
```

Expected 输出：
```
=== Brain Docker 切换：从裸跑 → 容器 ===
→ 卸 launchd 裸跑 Brain
→ 等端口 5221 释放...
  ✅ 端口已释放 (1s)
→ docker-compose up -d node-brain
[+] Running 1/1
 ✔ Container cecelia-node-brain  Started
→ 等容器 healthy...
  ✅ Brain 容器 healthy (35s)
cecelia-node-brain  Up 35 seconds (healthy)
```

- [ ] **Step 6.3: 冒烟 1 — HTTP 接口通**

Run:
```bash
curl -fs http://localhost:5221/api/brain/tick/status | python3 -m json.tool | head -20
```

Expected: JSON 输出含 `"enabled":true`, `"loop_running":true`, `"tick_running":false`。

- [ ] **Step 6.4: 冒烟 2 — tick dispatch 能 spawn 兄弟容器**

Run:
```bash
# 触发 tick，看是否能派一个任务
curl -s -X POST http://localhost:5221/api/brain/tick | python3 -c "import sys,json;d=json.load(sys.stdin);l=d.get('dispatch',{}).get('last',{});print('task:',l.get('task_id'),'| success:',l.get('success'))"
# 等 10 秒看容器出来
sleep 10
docker ps --filter "name=cecelia-task-" --format '{{.Names}} {{.Status}}'
```

Expected: 如果有 queued 任务，会看到 `cecelia-task-xxxxx Up ...` 行。如果没任务就 `task: None`，也 OK（说明 dispatch 路径活着）。

- [ ] **Step 6.5: 冒烟 3 — 容器内存稳态**

Run:
```bash
docker stats --no-stream cecelia-node-brain
```

Expected: `MEM USAGE` < 700MB（目标 < 1GB limit）。

- [ ] **Step 6.6: 冒烟 4 — 自愈（kill 后 Docker 自动重启）**

Run:
```bash
# 记下当前 container ID
CONTAINER_ID_BEFORE=$(docker inspect -f '{{.Id}}' cecelia-node-brain | head -c 12)
echo "Before: $CONTAINER_ID_BEFORE"
# 强杀容器
docker kill cecelia-node-brain
# 等 15 秒让 Docker 重启（restart=unless-stopped）
sleep 15
# 新 container ID 不同
CONTAINER_ID_AFTER=$(docker inspect -f '{{.Id}}' cecelia-node-brain | head -c 12)
echo "After:  $CONTAINER_ID_AFTER"
# healthcheck 恢复
for i in {1..60}; do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' cecelia-node-brain)
  [ "$STATUS" = "healthy" ] && echo "✅ 自愈 ${i}s" && break
  sleep 1
done
# HTTP 恢复
curl -fs http://localhost:5221/api/brain/tick/status | head -c 100
```

Expected: Container ID 变化，60 秒内 healthy，curl 通。

- [ ] **Step 6.7: 不需要 commit（Task 6 是验证步骤，没文件改动）**

---

## Task 7: 写 DoD + Learning + 更新 .dev-mode

**Files:**
- Create: `docs/learnings/cp-0422122621-brain-dockerize-orbstack.md`
- Modify: `.dod`

- [ ] **Step 7.1: 写 DoD**

覆盖写 `.dod`（可能有其他分支残留）：

```markdown
# DoD — cp-0422122621-brain-dockerize-orbstack

## Artifact

- [x] [ARTIFACT] docker-compose.yml node-brain 适配 macOS（移除 host 网络/pid，加 docker.sock 挂载）
  - Test: manual:node -e "const c=require('fs').readFileSync('docker-compose.yml','utf8');if(c.includes('network_mode: host'))process.exit(1);if(!c.includes('/var/run/docker.sock'))process.exit(1);if(!c.includes('/Users/administrator'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] packages/brain/Dockerfile 改 USER root
  - Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!c.includes('USER root'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] scripts/brain-docker-up.sh 存在且可执行
  - Test: manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/brain-docker-up.sh');if(!(s.mode & 0o111))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] scripts/brain-docker-down.sh 存在且可执行
  - Test: manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/brain-docker-down.sh');if(!(s.mode & 0o111))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] 设计 + Learning 已提交
  - Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-22-brain-dockerize-orbstack-design.md');require('fs').accessSync('docs/learnings/cp-0422122621-brain-dockerize-orbstack.md')"

## Behavior

- [x] [BEHAVIOR] compose config 语法合法
  - Test: manual:bash -c "docker compose config > /dev/null 2>&1"

- [x] [BEHAVIOR] brain-docker-up.sh 脚本能解析（bash -n）
  - Test: manual:bash -c "bash -n scripts/brain-docker-up.sh && bash -n scripts/brain-docker-down.sh"
```

- [ ] **Step 7.2: 写 Learning**

Create `docs/learnings/cp-0422122621-brain-dockerize-orbstack.md`:

```markdown
# Brain 迁 Docker + OrbStack（2026-04-22）

## 做了什么

把 Brain 从 launchd 裸跑 macOS 迁进 OrbStack Docker 容器：
- `docker-compose.yml` 的 node-brain service 去 Linux 专属特性（network_mode:host / pid:host / /home/xx 路径），换成 macOS 兼容的 bridge 网络 + 端口 forward + /Users/administrator 路径
- 加 `/var/run/docker.sock` 挂载，Brain 在容器内仍能 spawn 兄弟 pipeline 容器
- 内存 4GB→1GB limit（实际峰值 608MB），加 cpus:'2' 限额
- 新增 `brain-docker-up.sh` / `brain-docker-down.sh` 一键切换
- Dockerfile USER cecelia → root（解决 macOS docker group gid 错配）

### 根本原因

Brain 裸跑 macOS 被 jetsam 杀的根因：macOS runningboardd 明确标 Brain 为"not jetsam managed"，当系统内存压力大时按 RSS 大小排序，Brain（250-600MB RSS）是一等候选。12 小时内 launchd 重启 6 次，丢 in-flight dispatch 状态。

### 下次预防

- [ ] 长驻服务（orchestrator、daemon）在 macOS 上跑，默认容器化，不裸跑
- [ ] docker-compose.yml 里 `network_mode: host` / `pid: host` 都是 Linux-only，写 Mac 兼容 compose 要先移除
- [ ] 任何 `/home/xx` 路径在 macOS 要换 `/Users/administrator`
- [ ] 容器内访问宿主服务用 `host.docker.internal`，不是 `localhost`

## 技术要点

- OrbStack 自动把 `/var/run/docker.sock` 符号链接到 `~/.orbstack/run/docker.sock`，兼容 Linux 硬编码路径的工具
- OrbStack 原生支持 `host.docker.internal`（docs.orbstack.dev/docker/network），容器内访问宿主 127.0.0.1 免配置
- `read_only: true` + tmpfs `/tmp:100M` 让容器文件系统不可写，凭据挂 `:ro`，即使 USER root 攻击面也有限
- LaunchDaemons plist 不删，留作 `brain-docker-down.sh` 回滚路径
- healthcheck `start_period: 40s` 覆盖 Brain 启动 migration + self-check 时间

## 冒烟验证

```bash
# 1. 切换
bash scripts/brain-docker-up.sh

# 2. HTTP 通
curl -fs http://localhost:5221/api/brain/tick/status | head -c 100

# 3. 内存稳
docker stats --no-stream cecelia-node-brain    # 应 < 700MB

# 4. 自愈
docker kill cecelia-node-brain
sleep 15
curl -fs http://localhost:5221/api/brain/tick/status   # 10-15s 内恢复

# 5. 回滚
bash scripts/brain-docker-down.sh
```
```

- [ ] **Step 7.3: 提交 DoD + Learning**

```bash
cd /Users/administrator/worktrees/cecelia/brain-dockerize-orbstack
git add .dod docs/learnings/cp-0422122621-brain-dockerize-orbstack.md
git commit -m "docs: DoD + Learning for brain-dockerize-orbstack

Task: 6c0d5ac9-d4bb-46ea-8c70-0f68dab27c2f

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

### Spec 覆盖检查

- SC-001 (容器 healthy) → Task 6 Step 6.2 验证
- SC-002 (curl 200) → Task 6 Step 6.3 验证
- SC-003 (tick dispatch + spawn) → Task 6 Step 6.4 验证
- SC-004 (RSS < 700MB) → Task 6 Step 6.5 验证
- SC-005 (docker kill 自愈) → Task 6 Step 6.6 验证
- SC-006 (brain-docker-down.sh 回滚) → Task 4 的脚本 + 未来紧急使用

### Placeholder 扫描

- 所有 shell 脚本含完整命令
- 所有 YAML diff 含具体路径和值
- 无 TBD/TODO

### 命名一致性

- `brain-docker-up.sh` / `brain-docker-down.sh` 两个脚本 + DoD 引用 + Learning 引用一致
- `cecelia-node-brain` 容器名一致（compose `container_name` + 所有 docker 命令）
- 路径 `/Users/administrator/...` 在 compose + scripts + DoD 全部一致
