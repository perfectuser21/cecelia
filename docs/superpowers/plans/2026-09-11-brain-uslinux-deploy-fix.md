# Brain us-vps(Linux) 部署适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `scripts/brain-deploy.sh` 在 Linux（us-vps）上能选到一份不含 macOS 专属路径的 compose 文件，为后续人工完成的 us-vps 容器切换扫清代码层面的障碍。

**Architecture:** 新增 `docker-compose.us-vps.yml`（`node-brain` 服务的 Linux 版）；`brain-deploy.sh` 的 Docker 模式分支根据 `uname -s` 自动选择用哪份 compose 文件（`COMPOSE_FILE` 变量，允许环境变量显式覆盖，便于测试）；`packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh`（F2 部署闭环既有 smoke 守卫）追加断言覆盖以上两点。

**Tech Stack:** Bash、Docker Compose v2、既有 smoke 测试框架（纯 bash + `ok()`/`fail()` 计数器）

---

## 文件清单

- Create: `docker-compose.us-vps.yml`（已在设计阶段起草并用 `docker compose config` 验证过语法，本计划里当作 Task 2 的产物重新走一遍 TDD 顺序）
- Modify: `scripts/brain-deploy.sh:264-296`（插入 COMPOSE_FILE 选择逻辑）、`scripts/brain-deploy.sh:437-457, 700-709`（5 处 `docker-compose.yml` 硬编码改用 `${COMPOSE_FILE}`）
- Modify: `packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh`（追加断言，文件末尾 `echo "结果..."` 之前插入）

---

### Task 1: smoke 断言先行（commit-1，预期全红）

**Files:**
- Modify: `packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh`

- [ ] **Step 1: 在文件末尾 `echo "结果: PASS=$PASS FAIL=$FAIL"` 这一行之前插入以下断言块**

```bash
# ── us-vps(Linux) 部署适配（GP 199ae170 加厚，decisions category=deployment）──

# [结构] docker-compose.us-vps.yml 存在
[ -f docker-compose.us-vps.yml ] \
  && ok "[结构] docker-compose.us-vps.yml 存在" || fail "docker-compose.us-vps.yml 缺失"

# [结构] Linux compose 文件不含账号绑定类挂载（引擎-机器绑定铁律：Claude/Codex 只在 mmv 跑）
if [ -f docker-compose.us-vps.yml ]; then
  if grep -qE '\.claude-account[0-9]|\.codex-team[0-9]|/\.grok:' docker-compose.us-vps.yml; then
    fail "docker-compose.us-vps.yml 仍含账号绑定类挂载（claude-account/codex-team/grok）"
  else
    ok "[结构] docker-compose.us-vps.yml 不含账号绑定类挂载"
  fi
  grep -q "REPO_ROOT=/root/cecelia" docker-compose.us-vps.yml \
    && ok "[结构] docker-compose.us-vps.yml REPO_ROOT 指向 Linux 路径 /root/cecelia" \
    || fail "docker-compose.us-vps.yml 未把 REPO_ROOT 改指 /root/cecelia"
  grep -q "/var/run/docker.sock:/var/run/docker.sock" docker-compose.us-vps.yml \
    && ok "[结构] docker-compose.us-vps.yml 保留 docker.sock 挂载" \
    || fail "docker-compose.us-vps.yml 丢失 docker.sock 挂载（非账号相关，不该被裁剪）"
else
  fail "docker-compose.us-vps.yml 不存在，跳过内容断言"
fi

# [结构] brain-deploy.sh 按 uname -s 自动选择 compose 文件，且允许 COMPOSE_FILE 覆盖
grep -q 'COMPOSE_FILE' scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 定义 COMPOSE_FILE 变量" || fail "brain-deploy.sh 未定义 COMPOSE_FILE 变量"
grep -qE 'uname -s.*Linux|Linux.*uname -s' scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 含 uname -s 探测 Linux 分支" || fail "brain-deploy.sh 缺 uname -s 探测"
grep -q 'docker-compose.us-vps.yml' scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 引用 docker-compose.us-vps.yml" || fail "brain-deploy.sh 未引用 docker-compose.us-vps.yml"

# [运行时] --dry-run 配合 COMPOSE_FILE 覆盖，验证选择逻辑真的生效（而不只是字符串存在于脚本里）
DRY_OUT_LINUX=$(cd "$(git rev-parse --show-toplevel)" && COMPOSE_FILE=docker-compose.us-vps.yml bash scripts/brain-deploy.sh --dry-run 2>&1) || true
echo "$DRY_OUT_LINUX" | grep -q "docker-compose.us-vps.yml" \
  && ok "[运行时] COMPOSE_FILE=docker-compose.us-vps.yml 覆盖后 dry-run 引用该文件" \
  || fail "COMPOSE_FILE 覆盖未生效于 dry-run 输出"

DRY_OUT_DEFAULT=$(cd "$(git rev-parse --show-toplevel)" && bash scripts/brain-deploy.sh --dry-run 2>&1) || true
if echo "$DRY_OUT_DEFAULT" | grep -q "docker-compose.us-vps.yml"; then
  fail "未覆盖 COMPOSE_FILE 时 dry-run 默认引用了 Linux compose 文件（macOS 现有行为回归）"
else
  ok "[运行时] 未覆盖 COMPOSE_FILE 时 dry-run 默认行为不变（不引用 docker-compose.us-vps.yml）"
fi
```

- [ ] **Step 2: 运行 smoke 脚本，确认新增断言全部失败（此时 docker-compose.us-vps.yml 还不存在、brain-deploy.sh 还没改）**

Run: `cd /Users/administrator/worktrees/cecelia/brain-uslinux-deploy-fix && bash packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh 2>&1 | grep -A2 "us-vps(Linux)"`
Expected: 看到多条 `❌` 输出（docker-compose.us-vps.yml 缺失、brain-deploy.sh 未定义 COMPOSE_FILE 等），脚本因 FAIL>0 以非 0 退出。已有的其它断言（drain 相关等）可能因为本机没有本地 Brain 实例而报错/跳过，属预期噪音，只关注本次新增的几条。

- [ ] **Step 3: Commit（红）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-uslinux-deploy-fix
git add packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh
git commit -m "test(brain): us-vps(Linux) 部署适配 smoke 断言（先红）

追加断言覆盖 docker-compose.us-vps.yml 存在性/挂载裁剪范围、
brain-deploy.sh 的 compose 文件自动选择逻辑。此时实现还未写，
断言预期全部失败，下一个 commit 补实现让它们转绿。"
```

---

### Task 2: 新建 docker-compose.us-vps.yml（commit-2 之一）

**Files:**
- Create: `docker-compose.us-vps.yml`

- [ ] **Step 1: 写入文件**

完整内容（已在设计阶段用 `docker compose config` 验证过语法与变量解析正确）：

```yaml
# == us-vps (Linux) Production Environment ==
# docker-compose.yml 的 Linux 专属版本（决策：Brain us-vps(Linux)部署-compose策略，
# 拍板"为 Linux 单建 docker-compose.us-vps.yml，与 macOS 的 docker-compose.yml 互不牵连"）。
# 只砍掉账号绑定类挂载（.claude / .claude-account1~3 / .codex-team1~5 / .grok ——
# 按「引擎-机器绑定铁律」Claude/Codex 只在 mmv 跑，us-vps 不需要这些账号挂载，
# 且这些宿主路径在 Linux 上本来就不存在）。其余挂载全部保留，只是把宿主路径
# 从 /Users/administrator/... 改指 Linux 路径 /root/...（决策：...凭据挂载裁剪范围细化）。
#
# Build first: bash scripts/brain-build.sh
# Deploy:      bash scripts/brain-deploy.sh（会按 uname -s 自动选到本文件）

name: cecelia

services:
  node-brain:
    image: cecelia-brain:${BRAIN_VERSION:-latest}
    container_name: cecelia-node-brain
    ports:
      - "5221:5221"
      # Acceptance 公网 listener（刀1，决策 c08c2173/4303a326）：容器内 0.0.0.0:5223，
      # 宿主侧 pf 封 en0/en1 公网网卡，仅 cloudflared(brain-acceptance.zenjoymedia.media)→localhost:5223 可达。
      # env 注入走 env_file(.env.docker)：ACCEPTANCE_API_TOKEN（缺省=listener 不启动 fail-closed）+ ACCEPTANCE_PUBLIC_HOST=0.0.0.0
      - "5223:5223"
      # 预览 Brain 端口范围（per-PR preview environments，由 preview-env-start.sh 在容器内启动）
      # 容器内的预览 Brain 进程绑定到 5300-5399，需对外暴露才能被 GitHub Actions 健康检查到（via Tailscale）
      - "5300-5399:5300-5399"
    read_only: true
    tmpfs:
      - /tmp:size=100M
    volumes:
      # Docker socket: Brain 调 dockerd spawn 兄弟 pipeline 容器
      - /var/run/docker.sock:/var/run/docker.sock
      # Skills SSOT（B57/B58）：.claude/skills/* 是指向这里的 symlink，不 mount 则容器内
      # symlink 悬空 → harness SKILL 加载失败（loadSkillContent 全 miss）；dist 未 mount 则
      # Brain 无法 dispatch relay。us-vps 上需要这两个仓库分别 clone 到 /root/ 下。
      - /root/zenithjoy-skills:/root/zenithjoy-skills:ro
      - /root/zenithjoy-skills-dist:/root/zenithjoy-skills-dist:ro
      # 凭据：DB/内部服务凭据 SSOT。HOST_HOME=/root + Dockerfile ENV HOME 对齐宿主路径，
      # 这样 Brain os.homedir() 和 docker-executor 构造的子容器 mount 源都能解析。
      - /root/.credentials:/root/.credentials:ro
      # Workflows: staff + skills + agents (read-only for staff/skills-registry API)
      - /root/cecelia/packages/workflows:/root/cecelia/packages/workflows:ro
      # Config: OKR validation spec (read-only, mounted at /config for validate-okr-structure.js)
      - /root/cecelia/packages/config:/config:ro
      # HEARTBEAT.md (read-write for GET/PUT API)
      - /root/cecelia/HEARTBEAT.md:/HEARTBEAT.md:rw
      # workers.config.json (read-write for PUT /staff/workers API)
      - /root/cecelia/packages/workflows/staff/workers.config.json:/root/cecelia/packages/workflows/staff/workers.config.json:rw
      # Worktree 根目录（Brain spawn harness/pipeline 容器时要 mount 宿主 worktree）
      - /root/cecelia/.claude/worktrees:/root/cecelia/.claude/worktrees:rw
      - /root/worktrees:/root/worktrees:rw
      # Content pipeline 产物目录（docker-executor existsFn 检查要求 Brain 可见宿主该路径，
      # 否则不挂给 pipeline container，产物写到 ephemeral 空间 --rm 丢失。见 PR #2527 后续修）
      - /root/content-output:/root/content-output:rw
      - /root/claude-output:/root/claude-output:rw
      # SSH：pipeline-export.sh 跑 "ssh nas" 上传 NAS，docker-executor 挂给 pipeline container
      - /root/.ssh:/root/.ssh:ro
      # Git + gh config（harness / pipeline container 做 git commit / gh pr 需要）
      - /root/.gitconfig:/root/.gitconfig:ro
      - /root/.config/gh:/root/.config/gh:ro
      # 部署根：us-vps 只有一份 checkout（不像 macOS 区分"活人主仓"和"CD 专用部署根"，
      # us-vps 上没有交互式开发，单一 checkout 同时充当主仓库挂载和 REPO_ROOT）。
      - /root/cecelia:/root/cecelia:rw
      # Prompt 文件目录：Brain 写 prompt 文件这里（docker-executor writePromptFile），
      # 子容器 mount 源必须由宿主 docker daemon 解析 → 必须宿主路径。
      - /root/claude-output/cecelia-prompts:/tmp/cecelia-prompts:rw
      # Timezone (read-only)
      - /etc/localtime:/etc/localtime:ro
    env_file:
      - .env.docker
      # 所有 checkout / cron / 蓝绿部署共用宿主凭据 SSOT；首次部署自动生成。
      - path: ${CECELIA_INTERNAL_ENV_FILE:-/root/.credentials/cecelia-internal.env}
        required: false
    environment:
      - NODE_ENV=production
      - TZ=Asia/Shanghai
      - ENV_REGION=${ENV_REGION:-us}
      # Universal Map repo→scope 身份绑定；拒绝仅 basename 相同的跨仓证据冒用。
      - CECELIA_MAP_REPO_SCOPES=${CECELIA_MAP_REPO_SCOPES:-perfectuser21/cecelia=cecelia,cecelia=cecelia}
      # Kernel controller 固定留在 US M4；Docker hostname 不是可调度机器身份。
      - CECELIA_MACHINE_ID=${CECELIA_MACHINE_ID:-us-mac-m4}
      # Fleet Node admission is mandatory. Brain accepts only these canonical
      # server-owned Worker endpoints and caches their evidence for at most 90s.
      - FLEET_WORKER_US_MAC_M4_URL=${FLEET_WORKER_US_MAC_M4_URL:-http://host.docker.internal:5231}
      - FLEET_WORKER_XIAN_MAC_M4_URL=${FLEET_WORKER_XIAN_MAC_M4_URL:-http://100.86.57.69:5231}
      - FLEET_WORKER_XIAN_MAC_M1_URL=${FLEET_WORKER_XIAN_MAC_M1_URL:-http://100.88.166.55:5231}
      - FLEET_NODE_ADMISSION_CACHE_TTL_MS=${FLEET_NODE_ADMISSION_CACHE_TTL_MS:-1000}
      # Phase 4B: all canonical machines use the authenticated Fleet Worker
      # Attempt API. An absent/short token remains fail-closed in the transport.
      - KERNEL_FLEET_REMOTE_ENABLED=${KERNEL_FLEET_REMOTE_ENABLED:-true}
      # KERNEL_FLEET_BRIDGE_TOKEN 只来自 env_file(.env.docker)——不要在这里写
      # `${KERNEL_FLEET_BRIDGE_TOKEN:-}`：environment 优先级高于 env_file，任何不带
      # --env-file 的 compose up 都会把 token 盖成空串（2026-08-16 09:38Z 生产实证，
      # 守卫 scripts/smoke/brain-compose-envfile-authority-smoke.sh）。
      # Workspace + PostgreSQL + stopped Runner preparation is intentionally
      # heavier than inspect/start/cancel, so it has an independent budget.
      - KERNEL_FLEET_PREPARE_TIMEOUT_MS=${KERNEL_FLEET_PREPARE_TIMEOUT_MS:-180000}
      # Xian Workers must be able to call the US Brain over Tailscale.
      - KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL=${KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL:-http://100.71.151.105:5221}
      # host.docker.internal: Linux Docker 需要 --add-host 或 extra_hosts 才能解析，见下方 extra_hosts
      - DB_HOST=${DB_HOST:-host.docker.internal}
      - DB_PORT=${DB_PORT:-5432}
      - DB_NAME=${DB_NAME:-cecelia}
      - DB_USER=${DB_USER:-cecelia}
      - DB_PASSWORD=${DB_PASSWORD:-cecelia}
      # review 门审批 token（issue afc50c30）：只注入 Brain 本容器，relay/harness 执行体
      # 容器不挂载——执行体物理上无法伪造人工批准。值从部署机根 .env（gitignored）/
      # ~/.credentials/cecelia-brain.env 注入；缺省空 → 路由 503 fail-closed。
      - HARNESS_REVIEW_APPROVER_TOKEN=${HARNESS_REVIEW_APPROVER_TOKEN:-}
      - BRAIN_PORT=5221
      - CECELIA_TICK_ENABLED=${CECELIA_TICK_ENABLED:-true}
      # Concurrency: auto-calculated from hardware (CPU/memory) via slot-allocator.js
      # CECELIA_MAX_SEATS: hard cap on concurrent slots (overrides auto-calc, set 0 to disable)
      - CECELIA_MAX_SEATS=10
      # CECELIA_BUDGET_SLOTS: budget-layer cap (< MAX_SEATS), reserves 3 slots for burst buffer + INTERACTIVE_RESERVE
      - CECELIA_BUDGET_SLOTS=7
      - CECELIA_TICK_INTERVAL_MS=${CECELIA_TICK_INTERVAL_MS:-5000}
      - DISPATCH_TIMEOUT_MINUTES=${DISPATCH_TIMEOUT_MINUTES:-60}
      - FEISHU_BOT_WEBHOOK=${FEISHU_BOT_WEBHOOK:-}
      # Bark 告警推送 token（source ~/.credentials/bark.env 后由宿主 shell 展开）
      - BARK_TOKEN=${BARK_TOKEN:-}
      # us-vps 上没有交互式 Claude Code（引擎-机器绑定铁律），此路径不会被真正调用，
      # 保留字段结构一致性，值指向本机 REPO_ROOT 对应位置。
      - CECELIA_RUN_PATH=/root/cecelia/packages/brain/scripts/cecelia-run.sh
      - HOST_HOME=/root
      # 部署根：us-vps 单一 checkout 同时充当 REPO_ROOT（见上方 volumes 注释）
      - REPO_ROOT=/root/cecelia
      # 专用部署根，deploy-local.sh 守卫自愈到 origin/main（脏/落后时硬 reset 而非静默降级）
      - CECELIA_DEPLOY_AUTORESET=1
      # Codex CLI 容器内位置（由 Dockerfile npm install -g @openai/codex 装到 /usr/local/bin/codex）
      # us-vps 上不会有 codex relay 子容器被派发（Codex 只在 mmv 跑），保留常量避免代码里
      # 读取 undefined 路径；CODEX_HOME/CODEX_RELAY_HOME 因对应挂载已裁剪，不注入。
      - CODEX_BIN=/usr/local/bin/codex
      # Brain 容器里 /tmp/cecelia-prompts 对应的宿主路径（docker-executor 用它构造子容器 mount 源）
      - HOST_PROMPT_DIR=/root/claude-output/cecelia-prompts
      # ZenithJoy API — harness-sprint-state skill 写 sprint_states/journey_steps 用
      - BRAIN_API=http://host.docker.internal:5200
      # ZenithJoy 蓝绿护栏：staging-e2e-runner.js 健康检查 :5201，需指向宿主（容器内 localhost 不通宿主端口）
      - ZJ_STAGING_HOST=host.docker.internal
      # P0-fix: Brain 写发布回执到独立 zenithjoy 库（zenithjoy-db.js 依赖此变量）
      # 未设 → 静默落回 cecelia.zenithjoy schema（拆库目的失效）
      - ZENITHJOY_DB_NAME=zenithjoy
      # Notion Inbox 采集凭据（F6加厚，notion-capture-ingest.js）
      # 未配置时静默跳过，不影响其他 job（fail-open，非关键路径）
      - NOTION_INBOX_TOKEN=${NOTION_INBOX_TOKEN:-}
      - NOTION_INBOX_DB_ID=${NOTION_INBOX_DB_ID:-b45ca2cb-9c90-83f1-bc41-81ad0b86c1b1}
      # OPENAI_API_KEY is provided via env_file (.env.docker) — do NOT override here
      # FEISHU_OWNER_OPEN_IDS is provided via env_file (.env.docker) — same reason, do NOT override here
    # Linux Docker 默认不解析 host.docker.internal（macOS/OrbStack 原生支持），显式加映射。
    extra_hosts:
      - "host.docker.internal:host-gateway"
    # compose standalone cgroup 限额（deploy.resources 只在 Docker Swarm 模式生效）
    # 容器 memory cap 必须 ≥ 运行时 node 堆上限 + 容器开销余量。
    # Dockerfile CMD: node --max-old-space-size=3072 → 3G 堆；4G = 3G 堆 + ~1G 容器/native 开销。
    mem_limit: 4g
    mem_reservation: 1g
    cpus: 2.0
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'
        reservations:
          memory: 1G
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5221/api/brain/tick/status"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 2: 语法验证（本地需要 `.env.docker`，用仓库自带模板临时验证，不提交）**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/brain-uslinux-deploy-fix
cp .env.docker.example .env.docker
docker compose -f docker-compose.us-vps.yml config >/dev/null && echo "YAML_OK"
rm -f .env.docker
```
Expected: 打印 `YAML_OK`，无报错

- [ ] **Step 3: 跑 smoke 里本任务新增的断言，确认与 docker-compose.us-vps.yml 相关的几条转绿（brain-deploy.sh 相关的几条此时仍红，留给 Task 3）**

Run: `bash packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh 2>&1 | grep -E "docker-compose.us-vps.yml|COMPOSE_FILE|uname -s"`
Expected: `docker-compose.us-vps.yml 存在`/`不含账号绑定类挂载`/`REPO_ROOT 指向`/`保留 docker.sock 挂载` 四条 ✅；`COMPOSE_FILE 变量`/`uname -s 探测`/`引用 docker-compose.us-vps.yml`（脚本里，非文件本身）/两条运行时断言 仍 ❌

- [ ] **Step 4: Commit**

```bash
git add docker-compose.us-vps.yml
git commit -m "feat(brain): 新增 docker-compose.us-vps.yml — us-vps(Linux) 专属 compose

只砍账号绑定类挂载(.claude-account1~3/.codex-team1~5/.grok，
按引擎-机器绑定铁律 Claude/Codex 只在 mmv 跑)，其余挂载全部保留，
宿主路径从 /Users/administrator/... 改指 Linux 路径 /root/...。
REPO_ROOT 改指 /root/cecelia，新增 host.docker.internal 的
extra_hosts 映射（Linux Docker 不像 OrbStack 原生解析这个域名）。"
```

---

### Task 3: brain-deploy.sh 加 compose 文件自动选择（commit-2 之二）

**Files:**
- Modify: `scripts/brain-deploy.sh:264-296`（插入选择逻辑）
- Modify: `scripts/brain-deploy.sh:437-457`（3 处硬编码 `docker-compose.yml`）
- Modify: `scripts/brain-deploy.sh:700-709`（2 处硬编码 `docker-compose.yml`）

- [ ] **Step 1: 在第 275 行（`fi` 结束 DEPLOY_MODE 探测，第 276 空行）之后插入 COMPOSE_FILE 选择逻辑**

原文（第266-278行）：
```bash
# ── 部署模式检测：Docker vs launchd ─────────────────────────────────────────
DEPLOY_MODE="docker"
LAUNCHD_SERVICE="com.cecelia.brain"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_SERVICE}.plist"

if ! docker info >/dev/null 2>&1 || ! docker inspect cecelia-node-brain >/dev/null 2>&1; then
    if [[ -f "$LAUNCHD_PLIST" ]]; then
        DEPLOY_MODE="launchd"
    fi
fi

echo "=== Deploying cecelia-brain v${VERSION} (region=${ENV_REGION}, mode=${DEPLOY_MODE}) ==="
echo ""
```

改为（新增一段 `# ── Compose 文件选择 ──` 注释块 + `COMPOSE_FILE` 变量，紧接在 DEPLOY_MODE 探测之后、echo 之前）：
```bash
# ── 部署模式检测：Docker vs launchd ─────────────────────────────────────────
DEPLOY_MODE="docker"
LAUNCHD_SERVICE="com.cecelia.brain"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_SERVICE}.plist"

if ! docker info >/dev/null 2>&1 || ! docker inspect cecelia-node-brain >/dev/null 2>&1; then
    if [[ -f "$LAUNCHD_PLIST" ]]; then
        DEPLOY_MODE="launchd"
    fi
fi

# ── Compose 文件选择：Linux(us-vps) 用专属文件，其余(macOS/mmv)用默认文件 ────
# COMPOSE_FILE 允许环境变量显式覆盖（测试/未来手动指定用），缺省按 uname -s 自动探测。
if [[ -z "${COMPOSE_FILE:-}" ]]; then
    if [[ "$(uname -s)" == "Linux" ]]; then
        COMPOSE_FILE="docker-compose.us-vps.yml"
    else
        COMPOSE_FILE="docker-compose.yml"
    fi
fi

echo "=== Deploying cecelia-brain v${VERSION} (region=${ENV_REGION}, mode=${DEPLOY_MODE}, compose=${COMPOSE_FILE}) ==="
echo ""
```

- [ ] **Step 2: 把 `[dry-run] DEPLOY_MODE=...` 那段也带上 COMPOSE_FILE（方便 dry-run 输出里能看见，供 smoke 断言抓取）**

原文（第283-288行）：
```bash
if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] DEPLOY_MODE=${DEPLOY_MODE}"
    echo "[dry-run] ROOT_DIR=${ROOT_DIR}"
    echo "[dry-run] HOST_HOME=${HOST_HOME}"
    echo ""
fi
```

改为：
```bash
if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] DEPLOY_MODE=${DEPLOY_MODE}"
    echo "[dry-run] COMPOSE_FILE=${COMPOSE_FILE}"
    echo "[dry-run] ROOT_DIR=${ROOT_DIR}"
    echo "[dry-run] HOST_HOME=${HOST_HOME}"
    echo ""
fi
```

- [ ] **Step 3: 把 Docker 模式分支里 3 处硬编码 `-f "$ROOT_DIR/docker-compose.yml"` 改成 `-f "$ROOT_DIR/${COMPOSE_FILE}"`**

原文（第437-457行）：
```bash
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker compose up -d node-brain (cecelia-brain:${VERSION})"
    elif ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose --env-file "$ROOT_DIR/.env.docker" \
        -f "$ROOT_DIR/docker-compose.yml" up -d node-brain; then
        echo ""
        echo "[FAIL] docker compose up -d failed. Rolling back..."
        if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
            PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
            echo "  Rolling back to v${PREV_VERSION}..."
            BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
              docker compose --env-file "$ROOT_DIR/.env.docker" \
                -f "$ROOT_DIR/docker-compose.yml" up -d node-brain || true
            echo "  Rolled back to v${PREV_VERSION}"
        else
            echo "  No previous version found. Stopping container."
            docker compose --env-file "$ROOT_DIR/.env.docker" \
              -f "$ROOT_DIR/docker-compose.yml" stop node-brain || true
        fi
        exit 1
    fi
```

改为（只改 `-f` 那 3 行，其余不动）：
```bash
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker compose -f ${COMPOSE_FILE} up -d node-brain (cecelia-brain:${VERSION})"
    elif ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose --env-file "$ROOT_DIR/.env.docker" \
        -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain; then
        echo ""
        echo "[FAIL] docker compose up -d failed. Rolling back..."
        if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
            PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
            echo "  Rolling back to v${PREV_VERSION}..."
            BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
              docker compose --env-file "$ROOT_DIR/.env.docker" \
                -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain || true
            echo "  Rolled back to v${PREV_VERSION}"
        else
            echo "  No previous version found. Stopping container."
            docker compose --env-file "$ROOT_DIR/.env.docker" \
              -f "$ROOT_DIR/${COMPOSE_FILE}" stop node-brain || true
        fi
        exit 1
    fi
```

- [ ] **Step 4: 把健康检查失败后的回滚分支（第700-709行）里 2 处硬编码同样改掉**

原文：
```bash
        BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
          docker compose --env-file "$ROOT_DIR/.env.docker" \
            -f "$ROOT_DIR/docker-compose.yml" up -d node-brain
        echo "  Rolled back to v${PREV_VERSION}"
    else
        echo "  No previous version found. Stopping container."
        docker compose --env-file "$ROOT_DIR/.env.docker" \
          -f "$ROOT_DIR/docker-compose.yml" stop node-brain
    fi
```

改为：
```bash
        BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
          docker compose --env-file "$ROOT_DIR/.env.docker" \
            -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain
        echo "  Rolled back to v${PREV_VERSION}"
    else
        echo "  No previous version found. Stopping container."
        docker compose --env-file "$ROOT_DIR/.env.docker" \
          -f "$ROOT_DIR/${COMPOSE_FILE}" stop node-brain
    fi
```

- [ ] **Step 5: bash 语法检查**

Run: `bash -n scripts/brain-deploy.sh`
Expected: 无输出（语法通过）

- [ ] **Step 6: dry-run 验证默认行为不变（macOS/未设置 COMPOSE_FILE 时防回归）**

Run: `cd /Users/administrator/worktrees/cecelia/brain-uslinux-deploy-fix && bash scripts/brain-deploy.sh --dry-run 2>&1 | grep -E "COMPOSE_FILE|docker-compose"`
Expected: 输出包含 `[dry-run] COMPOSE_FILE=docker-compose.yml`（本机是 Darwin，走默认分支），不出现 `docker-compose.us-vps.yml`

- [ ] **Step 7: dry-run 验证 COMPOSE_FILE 覆盖生效**

Run: `cd /Users/administrator/worktrees/cecelia/brain-uslinux-deploy-fix && COMPOSE_FILE=docker-compose.us-vps.yml bash scripts/brain-deploy.sh --dry-run 2>&1 | grep -E "COMPOSE_FILE|docker-compose"`
Expected: 输出包含 `[dry-run] COMPOSE_FILE=docker-compose.us-vps.yml` 及后续 `docker compose -f docker-compose.us-vps.yml up -d node-brain` 字样

- [ ] **Step 8: 跑完整 smoke，确认 Task 1 新增的全部断言（含 Task 2 遗留的两条）转绿**

Run: `bash packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh 2>&1 | grep -E "us-vps|COMPOSE_FILE|uname -s|结果:"`
Expected: 本任务相关的所有行都是 ✅，脚本末尾 `结果: PASS=N FAIL=0`（若原有 drain 相关断言因本机没有本地 Brain 实例而失败，属既有环境依赖问题，不在本次改动范围，`FAIL` 计数里如混有它们属预期噪音——重点确认新增的几条都是 ✅）

- [ ] **Step 9: Commit**

```bash
git add scripts/brain-deploy.sh
git commit -m "feat(brain): brain-deploy.sh 按 uname -s 自动选择 compose 文件

Docker 模式分支的 5 处 docker-compose.yml 硬编码统一改用 \${COMPOSE_FILE}，
默认按 uname -s 探测(Linux→docker-compose.us-vps.yml，其余→docker-compose.yml)，
允许 COMPOSE_FILE 环境变量显式覆盖。不改 DEPLOY_MODE(docker/launchd)探测逻辑。"
```

---

## Self-Review 结论

- **spec 覆盖**：设计文档三点（compose 文件新建、brain-deploy.sh 选择逻辑、smoke 断言）Task 2/3/1 分别对应，无遗漏
- **占位符扫描**：无 TBD/TODO，所有 diff 均为完整代码
- **类型一致性**：`COMPOSE_FILE` 变量名在 Task 3 的所有 step 及 Task 1 的断言里保持一致；文件名 `docker-compose.us-vps.yml` 在三个任务里拼写一致
- **边界确认**：全程不执行真实 `docker compose up`，不重启/操作任何生产容器；`.env.docker` 验证用临时文件且不提交（已在 Step 里显式 `rm -f`）
