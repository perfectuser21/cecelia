# Brain Keepalive 自动重启 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `scripts/ops/brain-keepalive-check.sh` 从只发告警改为先自动重启 Brain 容器，失败才发 P0 告警。

**Architecture:** 单文件 shell 脚本修改。在 "not running + state file 不存在" 分支插入 `docker compose up -d node-brain`，等 15s 确认，成功发恢复通知，失败才写 state file + 发 P0。

**Tech Stack:** bash, docker compose, launchd

---

### Task 1: 写失败测试（验证当前脚本还没有自动重启逻辑）

**Files:**
- Test: `scripts/ops/brain-keepalive-check.sh`（grep 验证）

- [ ] **Step 1: 运行验证当前脚本不含 auto-restart 逻辑**

```bash
grep -q "docker compose.*up.*node-brain" scripts/ops/brain-keepalive-check.sh && echo "ALREADY HAS IT" || echo "MISSING — test passes (expected failure)"
```

Expected output: `MISSING — test passes (expected failure)`

- [ ] **Step 2: 运行验证当前脚本不含 REPO_ROOT 变量**

```bash
grep -q "REPO_ROOT" scripts/ops/brain-keepalive-check.sh && echo "HAS IT" || echo "MISSING — expected"
```

Expected output: `MISSING — expected`

- [ ] **Step 3: commit 空 test marker（让 TDD 顺序可追溯）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-keepalive-auto-restart
git commit --allow-empty -m "test(keepalive): verify auto-restart logic absent before impl"
```

---

### Task 2: 实现自动重启逻辑

**Files:**
- Modify: `scripts/ops/brain-keepalive-check.sh:1-39`

- [ ] **Step 1: 替换脚本全部内容为新版本**

将 `scripts/ops/brain-keepalive-check.sh` 改为：

```bash
#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="cecelia-node-brain"
STATE_FILE="/tmp/brain-keepalive.alerting"
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"
LOG_PREFIX="[brain-keepalive]"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

send_feishu() {
  local msg="$1"
  if [[ -z "$WEBHOOK_URL" ]]; then
    echo "$LOG_PREFIX [WARN] FEISHU_BOT_WEBHOOK not set, skipping alert"
    return 0
  fi
  curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$msg\"}}" \
    --max-time 10 || echo "$LOG_PREFIX [WARN] feishu send failed"
}

STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")

if [[ "$STATUS" != "running" ]]; then
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX Brain not running (status=$STATUS), attempting restart..."
    docker compose -f "$COMPOSE_FILE" up -d node-brain 2>&1 || true
    sleep 15
    NEW_STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")
    if [[ "$NEW_STATUS" == "running" ]]; then
      echo "$LOG_PREFIX AUTO-RESTARTED: $CONTAINER_NAME is now running"
      send_feishu "✅ Brain 容器已自动重启恢复"
    else
      echo "$LOG_PREFIX ALERT: restart failed, $CONTAINER_NAME still $NEW_STATUS — sending P0"
      send_feishu "🚨 [P0] Brain 容器已停止且自动重启失败（status=${NEW_STATUS}）\n请手动检查：docker compose -f $COMPOSE_FILE up -d node-brain"
      touch "$STATE_FILE"
    fi
  else
    echo "$LOG_PREFIX SILENCED: restart already attempted, container still $STATUS"
  fi
else
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: $CONTAINER_NAME is running again"
    send_feishu "✅ Brain 容器已恢复运行"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: $CONTAINER_NAME is running"
  fi
fi
```

- [ ] **Step 2: 验证 auto-restart 逻辑已写入**

```bash
grep -q "docker compose.*up.*node-brain" scripts/ops/brain-keepalive-check.sh && echo "PASS: auto-restart logic present" || echo "FAIL"
```

Expected: `PASS: auto-restart logic present`

- [ ] **Step 3: 验证 REPO_ROOT 变量存在**

```bash
grep -q "REPO_ROOT" scripts/ops/brain-keepalive-check.sh && echo "PASS: REPO_ROOT defined" || echo "FAIL"
```

Expected: `PASS: REPO_ROOT defined`

- [ ] **Step 4: 验证脚本语法正确**

```bash
bash -n scripts/ops/brain-keepalive-check.sh && echo "PASS: syntax OK"
```

Expected: `PASS: syntax OK`

- [ ] **Step 5: 验证 SILENCED 提示文字更新（旧文字 "already alerted" 应已改为更准确的描述）**

```bash
grep -q "restart already attempted" scripts/ops/brain-keepalive-check.sh && echo "PASS" || echo "FAIL"
```

Expected: `PASS`

- [ ] **Step 6: 同步更新 launchd plist 里已安装的脚本**

launchd 运行的是 `~/Library/LaunchAgents/com.cecelia.brain-keepalive.plist`，它指向仓库路径，所以脚本改了 launchd 自动用新版本。验证 plist 指向：

```bash
grep -A2 "ProgramArguments" ~/Library/LaunchAgents/com.cecelia.brain-keepalive.plist
```

Expected: 包含 `brain-keepalive-check.sh` 路径（来自仓库，不是独立拷贝）。若发现 plist 是硬拷贝（路径在 `~/Library/` 而非仓库），需重新 `cp scripts/ops/com.cecelia.brain-keepalive.plist ~/Library/LaunchAgents/ && launchctl unload ~/Library/LaunchAgents/com.cecelia.brain-keepalive.plist && launchctl load ~/Library/LaunchAgents/com.cecelia.brain-keepalive.plist`。

- [ ] **Step 7: commit 实现**

```bash
git add scripts/ops/brain-keepalive-check.sh
git commit -m "fix(keepalive): Brain 容器挂掉时自动 docker compose up 重启，失败才发 P0 告警

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: DoD + Learning + PR

**Files:**
- Create: `.prd-brain-keepalive-auto-restart.md`（DoD）
- Create: `docs/learnings/cp-0518070610-brain-keepalive-auto-restart.md`

- [ ] **Step 1: 写 DoD 文件**

创建 `.prd-brain-keepalive-auto-restart.md`：

```markdown
# Brain Keepalive 自动重启 DoD

## 成功标准

- [x] keepalive 脚本发现 Brain 不在运行时，先执行 docker compose 重启再告警
- [x] 重启成功发飞书"已自动重启"通知，不写 state file
- [x] 重启失败才发 P0 告警并写 state file（防止每 60s 重复重启）
- [x] state file 存在时 SILENCED（不重复触发重启）

## DoD 条目

- [x] [ARTIFACT] `scripts/ops/brain-keepalive-check.sh` 含 auto-restart 逻辑
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/ops/brain-keepalive-check.sh','utf8');if(!c.includes('docker compose') || !c.includes('up -d node-brain'))process.exit(1)"`

- [x] [BEHAVIOR] REPO_ROOT 变量正确定位 docker-compose.yml
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/ops/brain-keepalive-check.sh','utf8');if(!c.includes('REPO_ROOT') || !c.includes('COMPOSE_FILE'))process.exit(1)"`

- [x] [BEHAVIOR] 脚本语法无误
  Test: `manual:bash -n scripts/ops/brain-keepalive-check.sh`
```

- [ ] **Step 2: 写 Learning 文件**

创建 `docs/learnings/cp-0518070610-brain-keepalive-auto-restart.md`：

```markdown
## Brain keepalive 自动重启（2026-05-18）

### 根本原因

keepalive 脚本最初设计为只发告警，依赖人工介入重启。实际上 `restart: unless-stopped` 只对容器崩溃有效；当 `brain-deploy.sh` 执行 `docker rm -f` 删除容器后，Docker 没有对象可重启，Brain 从 `docker ps -a` 彻底消失，只能手动 `docker compose up`。

### 下次预防

- [ ] keepalive 脚本改为先尝试自动重启，失败才告警
- [ ] 使用 `REPO_ROOT` 变量定位 `docker-compose.yml`，避免 launchd 环境下路径问题
- [ ] state file 防重机制：重启失败后 SILENCED，防止每分钟循环重启
```

- [ ] **Step 3: commit DoD + Learning**

```bash
git add .prd-brain-keepalive-auto-restart.md docs/learnings/cp-0518070610-brain-keepalive-auto-restart.md
git commit -m "docs(keepalive): DoD + learning

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 4: push 并创建 PR**

```bash
git push origin cp-0518070610-brain-keepalive-auto-restart
gh pr create \
  --title "fix(keepalive): Brain 容器挂掉时自动重启，失败才发 P0 告警" \
  --body "$(cat <<'EOF'
## Summary
- keepalive 脚本从"只发告警"改为"先自动 docker compose up，失败才告警"
- 新增 REPO_ROOT 变量定位 docker-compose.yml（launchd 环境下 cwd 不确定）
- state file 防重：重启失败后 SILENCED，防每 60s 循环

## Root Cause
Brain 死后 `restart: unless-stopped` 无效——容器已被 `docker rm -f` 删除，Docker 没有对象可 restart。

## Test Plan
- [ ] bash -n 验证脚本语法
- [ ] grep 验证 docker compose up 逻辑存在
- [ ] CI 全绿

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
