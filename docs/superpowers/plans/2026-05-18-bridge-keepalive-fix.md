# Bridge Keepalive Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 brain-keepalive 永久静默 bug，并为 cecelia-bridge 新增主动 keepalive 监控机制。

**Architecture:** 两处修改均在 `scripts/ops/` 目录。brain-keepalive-check.sh 加入 DAEMON_STATE_FILE 隔离和 TTL 重试；新增 bridge-keepalive-check.sh（镜像 brain-keepalive 模式）+ launchd plist 定时触发。不触碰 Brain 核心代码。

**Tech Stack:** Bash shell，launchd (macOS)，curl，launchctl

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/brain/scripts/smoke/bridge-keepalive-smoke.sh` | E2E smoke test（先写，RED 状态） |
| 修改 | `scripts/ops/brain-keepalive-check.sh` | 修复 SILENCED bug |
| 新增 | `scripts/ops/bridge-keepalive-check.sh` | bridge 主动 keepalive 脚本 |
| 新增 | `scripts/ops/com.cecelia.bridge-keepalive.plist` | launchd plist，每 60s 触发 |

---

### Task 1: 写 smoke E2E test（RED 状态）

**TDD iron law**: NO PRODUCTION CODE WITHOUT FAILING TEST FIRST

**Files:**
- Create: `packages/brain/scripts/smoke/bridge-keepalive-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本**

```bash
cat > packages/brain/scripts/smoke/bridge-keepalive-smoke.sh << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LOG_PREFIX="[smoke:bridge-keepalive]"

pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }
skip() { echo "⏭  SKIP: $1"; exit 0; }

[[ "${CI:-}" == "true" ]] && skip "CI 环境不跑此脚本"

echo "$LOG_PREFIX 检查 bridge-keepalive 相关文件..."

# [ARTIFACT] bridge-keepalive-check.sh 存在且可执行
[[ -x "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" ]] || \
  fail "scripts/ops/bridge-keepalive-check.sh 不存在或不可执行"
pass "scripts/ops/bridge-keepalive-check.sh 存在且可执行"

# [ARTIFACT] com.cecelia.bridge-keepalive.plist 存在
[[ -f "$REPO_ROOT/scripts/ops/com.cecelia.bridge-keepalive.plist" ]] || \
  fail "scripts/ops/com.cecelia.bridge-keepalive.plist 不存在"
pass "scripts/ops/com.cecelia.bridge-keepalive.plist 存在"

# [BEHAVIOR] bridge-keepalive-check.sh 语法正确
bash -n "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh bash 语法错误"
pass "bridge-keepalive-check.sh 语法正确"

# [BEHAVIOR] brain-keepalive-check.sh 包含 DAEMON_STATE_FILE
grep -q "DAEMON_STATE_FILE" "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh" || \
  fail "brain-keepalive-check.sh 缺少 DAEMON_STATE_FILE（SILENCED bug 未修复）"
pass "brain-keepalive-check.sh 含 DAEMON_STATE_FILE"

# [BEHAVIOR] brain-keepalive-check.sh 含 TTL 检查（file_age_seconds）
grep -q "file_age_seconds" "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh" || \
  fail "brain-keepalive-check.sh 缺少 file_age_seconds（SILENCED TTL 未实现）"
pass "brain-keepalive-check.sh 含 TTL 检查逻辑"

# [BEHAVIOR] bridge-keepalive-check.sh 含 SILENCED_TTL
grep -q "SILENCED_TTL" "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh 缺少 SILENCED_TTL"
pass "bridge-keepalive-check.sh 含 SILENCED_TTL"

# [BEHAVIOR] bridge-keepalive-check.sh 含 launchctl kickstart
grep -q "launchctl kickstart" "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh 缺少 launchctl kickstart"
pass "bridge-keepalive-check.sh 含 launchctl kickstart"

# [BEHAVIOR] bridge-keepalive-check.sh 含 direct spawn fallback
grep -q "nohup" "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh 缺少 direct spawn fallback"
pass "bridge-keepalive-check.sh 含 direct spawn fallback"

echo ""
echo "$LOG_PREFIX bridge-keepalive smoke: ALL PASS"
SCRIPT
chmod +x packages/brain/scripts/smoke/bridge-keepalive-smoke.sh
```

- [ ] **Step 2: 确认 smoke 脚本当前 FAIL（预期）**

```bash
bash packages/brain/scripts/smoke/bridge-keepalive-smoke.sh
```

预期输出（FAIL，因为文件还不存在）：
```
❌ scripts/ops/bridge-keepalive-check.sh 不存在或不可执行
```

- [ ] **Step 3: Commit（RED 状态）**

```bash
git add packages/brain/scripts/smoke/bridge-keepalive-smoke.sh
git commit -m "test(smoke): add bridge-keepalive smoke test [RED]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 修复 brain-keepalive-check.sh SILENCED bug

**Files:**
- Modify: `scripts/ops/brain-keepalive-check.sh`

- [ ] **Step 1: 用修复后的完整版本替换文件**

完整内容（替换现有 scripts/ops/brain-keepalive-check.sh）：

```bash
#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="cecelia-node-brain"
STATE_FILE="/tmp/brain-keepalive.alerting"
DAEMON_STATE_FILE="/tmp/brain-keepalive-daemon.alerting"
SILENCED_TTL=300    # 5 分钟后重试重启
DAEMON_TTL=600      # 10 分钟后重新发 daemon 不可用告警
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

file_age_seconds() {
  local file="$1"
  local now mtime
  now=$(date +%s)
  mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
  echo $((now - mtime))
}

STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")

if [[ "$STATUS" != "running" ]]; then
  if ! docker info >/dev/null 2>&1; then
    # Docker daemon 不可用 — 用独立 DAEMON_STATE_FILE（TTL 10 分钟），不触碰主 STATE_FILE
    if [[ ! -f "$DAEMON_STATE_FILE" ]] || [[ $(file_age_seconds "$DAEMON_STATE_FILE") -gt $DAEMON_TTL ]]; then
      echo "$LOG_PREFIX WARN: docker daemon unavailable, cannot restart Brain"
      send_feishu "🚨 [P0] Brain 容器已停止且 Docker daemon 不可用，需人工介入"
      touch "$DAEMON_STATE_FILE"
    else
      echo "$LOG_PREFIX SILENCED (daemon): docker daemon still unavailable, $(file_age_seconds "$DAEMON_STATE_FILE")s since last alert"
    fi
    exit 0
  fi

  # Docker daemon 可用 — 清除 daemon state
  rm -f "$DAEMON_STATE_FILE" 2>/dev/null || true

  # SILENCED TTL 检查：STATE_FILE 存在且未过期 → 继续静默
  if [[ -f "$STATE_FILE" ]] && [[ $(file_age_seconds "$STATE_FILE") -le $SILENCED_TTL ]]; then
    echo "$LOG_PREFIX SILENCED: restart already attempted, container still $STATUS ($(file_age_seconds "$STATE_FILE")s < ${SILENCED_TTL}s TTL)"
    exit 0
  fi

  # STATE_FILE 过期或不存在 → 尝试重启
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX Re-attempting restart after TTL expiry..."
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX Brain not running (status=$STATUS), attempting restart..."
  fi

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
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: $CONTAINER_NAME is running again"
    send_feishu "✅ Brain 容器已恢复运行"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: $CONTAINER_NAME is running"
  fi
  rm -f "$DAEMON_STATE_FILE" 2>/dev/null || true
fi
```

- [ ] **Step 2: 验证语法**

```bash
bash -n scripts/ops/brain-keepalive-check.sh && echo "syntax OK"
```

预期：`syntax OK`

- [ ] **Step 3: 验证 smoke 中 brain-keepalive 相关检查通过**

```bash
bash packages/brain/scripts/smoke/bridge-keepalive-smoke.sh 2>&1 | head -20
```

预期（brain 的 2 条通过，bridge 文件还不存在所以 fail）：
```
❌ scripts/ops/bridge-keepalive-check.sh 不存在或不可执行
```
（先 fail 在 bridge 文件检查，brain 相关检查还没到 — 这没问题，等全部文件就绪后再全跑）

- [ ] **Step 4: Commit**

```bash
git add scripts/ops/brain-keepalive-check.sh
git commit -m "fix(ops): 修复 brain-keepalive SILENCED bug — DAEMON_STATE_FILE + TTL 重试

- docker daemon 不可用时使用独立 DAEMON_STATE_FILE（TTL 10min），不触碰主 STATE_FILE
- SILENCED 分支加 TTL 检查（300s），过期后自动重试重启
- 修复：Brain 持续宕机期间不再永久静默

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 新增 bridge-keepalive-check.sh

**Files:**
- Create: `scripts/ops/bridge-keepalive-check.sh`

- [ ] **Step 1: 创建脚本**

```bash
cat > scripts/ops/bridge-keepalive-check.sh << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

BRIDGE_URL="http://localhost:3457/health"
STATE_FILE="/tmp/bridge-keepalive.alerting"
SILENCED_TTL=300       # 5 分钟后重试
HEALTH_TIMEOUT=3       # health check 超时秒数
RESTART_WAIT=5         # 重启后等待秒数
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"
LOG_PREFIX="[bridge-keepalive]"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRIDGE_SCRIPT="$REPO_ROOT/packages/brain/scripts/cecelia-bridge.cjs"
BRIDGE_LOG="/tmp/bridge-keepalive-spawn.log"
BRIDGE_PLIST_LABEL="com.cecelia.bridge"
USER_ID=$(id -u)

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

file_age_seconds() {
  local file="$1"
  local now mtime
  now=$(date +%s)
  mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
  echo $((now - mtime))
}

is_bridge_healthy() {
  curl -sf --max-time "$HEALTH_TIMEOUT" "$BRIDGE_URL" >/dev/null 2>&1
}

attempt_restart() {
  # 优先尝试 launchctl kickstart（利用已有 plist）
  echo "$LOG_PREFIX Trying launchctl kickstart gui/${USER_ID}/${BRIDGE_PLIST_LABEL}..."
  if launchctl kickstart "gui/${USER_ID}/${BRIDGE_PLIST_LABEL}" 2>/dev/null; then
    sleep "$RESTART_WAIT"
    if is_bridge_healthy; then
      echo "$LOG_PREFIX RESTARTED via launchctl"
      return 0
    fi
    echo "$LOG_PREFIX launchctl kickstart 后仍不健康，尝试 direct spawn..."
  else
    echo "$LOG_PREFIX launchctl kickstart 失败，尝试 direct spawn..."
  fi

  # Fallback: 杀掉旧进程，直接 spawn
  pkill -f "cecelia-bridge.cjs" 2>/dev/null || true
  sleep 1
  nohup /opt/homebrew/bin/node "$BRIDGE_SCRIPT" >> "$BRIDGE_LOG" 2>&1 &
  sleep "$RESTART_WAIT"
  if is_bridge_healthy; then
    echo "$LOG_PREFIX RESTARTED via direct spawn"
    return 0
  fi

  return 1
}

# ── Main ──────────────────────────────────────────────

if is_bridge_healthy; then
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: bridge is healthy again"
    send_feishu "✅ cecelia-bridge 已恢复健康（http://localhost:3457）"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: bridge is healthy"
  fi
  exit 0
fi

# Bridge 不健康 — 检查 SILENCED TTL
if [[ -f "$STATE_FILE" ]] && [[ $(file_age_seconds "$STATE_FILE") -le $SILENCED_TTL ]]; then
  echo "$LOG_PREFIX SILENCED: restart already attempted, bridge still unhealthy ($(file_age_seconds "$STATE_FILE")s < ${SILENCED_TTL}s TTL)"
  exit 0
fi

# STATE_FILE 过期或不存在 → 尝试重启
if [[ -f "$STATE_FILE" ]]; then
  echo "$LOG_PREFIX Re-attempting restart after TTL expiry..."
  rm -f "$STATE_FILE"
else
  echo "$LOG_PREFIX Bridge unhealthy at $BRIDGE_URL, attempting restart..."
fi

if attempt_restart; then
  send_feishu "✅ cecelia-bridge 已自动重启恢复（http://localhost:3457）"
else
  echo "$LOG_PREFIX ALERT: restart failed, bridge still unhealthy — sending P0"
  send_feishu "🚨 [P0] cecelia-bridge 已停止且自动重启失败\n所有 harness_initiative 任务将以 no_executor 堆积\n请手动检查：node $BRIDGE_SCRIPT"
  touch "$STATE_FILE"
fi
SCRIPT
chmod +x scripts/ops/bridge-keepalive-check.sh
```

- [ ] **Step 2: 验证语法**

```bash
bash -n scripts/ops/bridge-keepalive-check.sh && echo "syntax OK"
```

预期：`syntax OK`

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/bridge-keepalive-check.sh
git commit -m "feat(ops): 新增 bridge-keepalive-check.sh

- 每 60s 检查 cecelia-bridge (localhost:3457/health)
- 不健康时先 launchctl kickstart，失败则 direct spawn fallback
- STATE_FILE + TTL 模式（镜像 brain-keepalive）
- 飞书 P0 告警

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 新增 plist + 安装 + 全 smoke GREEN

**Files:**
- Create: `scripts/ops/com.cecelia.bridge-keepalive.plist`

- [ ] **Step 1: 创建 plist**

```bash
cat > scripts/ops/com.cecelia.bridge-keepalive.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cecelia.bridge-keepalive</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/administrator/perfect21/cecelia/scripts/ops/bridge-keepalive-check.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/bridge-keepalive.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/bridge-keepalive-err.log</string>
</dict>
</plist>
PLIST
```

- [ ] **Step 2: 安装到 LaunchAgents**

```bash
cp scripts/ops/com.cecelia.bridge-keepalive.plist ~/Library/LaunchAgents/
# 如果已加载，先卸载再加载
launchctl unload ~/Library/LaunchAgents/com.cecelia.bridge-keepalive.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.cecelia.bridge-keepalive.plist
echo "launchd job loaded"
```

预期：`launchd job loaded`（无错误）

- [ ] **Step 3: 验证 launchd job 已注册**

```bash
launchctl list | grep bridge-keepalive
```

预期：一行包含 `com.cecelia.bridge-keepalive`

- [ ] **Step 4: 运行完整 smoke — 应全部 PASS**

```bash
bash packages/brain/scripts/smoke/bridge-keepalive-smoke.sh
```

预期输出（全部 ✅）：
```
✅ scripts/ops/bridge-keepalive-check.sh 存在且可执行
✅ scripts/ops/com.cecelia.bridge-keepalive.plist 存在
✅ bridge-keepalive-check.sh 语法正确
✅ brain-keepalive-check.sh 含 DAEMON_STATE_FILE
✅ brain-keepalive-check.sh 含 TTL 检查逻辑
✅ bridge-keepalive-check.sh 含 SILENCED_TTL
✅ bridge-keepalive-check.sh 含 launchctl kickstart
✅ bridge-keepalive-check.sh 含 direct spawn fallback

[smoke:bridge-keepalive] bridge-keepalive smoke: ALL PASS
```

- [ ] **Step 5: 确认 bridge 当前健康（手动验证）**

```bash
curl -s http://localhost:3457/health
```

预期：`{"ok":true,"status":"healthy"}` 或类似

- [ ] **Step 6: Commit**

```bash
git add scripts/ops/com.cecelia.bridge-keepalive.plist
git commit -m "feat(ops): 新增 com.cecelia.bridge-keepalive.plist launchd 定时任务

- 每 60s 触发 bridge-keepalive-check.sh
- RunAtLoad: true，随用户登录自动生效
- 日志输出到 /tmp/bridge-keepalive.log

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 完成验证

所有 4 个 task 完成后，运行最终验证：

```bash
# 1. Smoke test ALL PASS
bash packages/brain/scripts/smoke/bridge-keepalive-smoke.sh

# 2. launchd job 已注册
launchctl list | grep -E "bridge-keepalive|brain-keepalive"

# 3. bridge 当前健康
curl -s http://localhost:3457/health

# 4. brain-keepalive 脚本 DAEMON_STATE_FILE 独立
grep "DAEMON_STATE_FILE" scripts/ops/brain-keepalive-check.sh | head -3
```
