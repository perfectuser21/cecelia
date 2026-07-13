# 死人开关加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `scripts/sentinel/dead-man-switch.sh` 加日志时间戳 + docker 引擎自愈看门狗，smoke 覆盖，双环境 proven-to-fire。

**Architecture:** 纯 bash 脚本改动。新增 `log()` 包装时间戳；新增 `docker_engine_check()` 独立检查函数，用独立 dedup 状态文件，不影响既有 DB 哨兵逻辑的 exit code。

**Tech Stack:** bash, psql, docker CLI, orbctl

---

### Task 1: smoke 断言先行（TDD 红）

**Files:**
- Modify: `packages/brain/scripts/smoke/p1pr2-deadman-trigger-backup-smoke.sh`

- [ ] **Step 1: 加两条新断言**

在现有 `DMS="scripts/sentinel/dead-man-switch.sh"` 断言块后追加：

```bash
grep -q "date '+%m-%d %H:%M:%S'" "$DMS" && ok "日志带时间戳前缀" || fail "日志缺时间戳"
grep -q "orbctl start" "$DMS" && ok "含 docker 引擎自愈分支（orbctl start）" || fail "缺 docker 引擎自愈分支"
```

- [ ] **Step 2: 跑 smoke 验证红（当前脚本还没改，应该 fail 两条）**

Run: `cd /Users/administrator/worktrees/cecelia/deadman-hardening && bash packages/brain/scripts/smoke/p1pr2-deadman-trigger-backup-smoke.sh`
Expected: 输出含 2 条 ❌（时间戳缺失 / docker 自愈分支缺失），整体 exit 1

- [ ] **Step 3: commit（红）**

```bash
git add packages/brain/scripts/smoke/p1pr2-deadman-trigger-backup-smoke.sh
git commit -m "test: 死人开关加固 smoke 断言（时间戳+docker自愈，先红）"
```

---

### Task 2: 实现日志时间戳 + docker 引擎自愈（TDD 绿）

**Files:**
- Modify: `scripts/sentinel/dead-man-switch.sh`

- [ ] **Step 1: 完整替换脚本内容**

将 `scripts/sentinel/dead-man-switch.sh` 整体替换为：

```bash
#!/usr/bin/env bash
# dead-man-switch.sh — 作战循环死人开关（体外哨兵，P1-PR2）
#
# 独立于 Brain 进程运行（launchd/cron，每 10 分钟）。检查 scheduler-jobs 的
# working_memory 哨兵键新鲜度：Brain 死 / loop 死 / DB 死，任何一种静默死亡
# 都会让哨兵键停止更新 → Bark 告警。
# 另外独立检查 docker 引擎是否卡死（07-07 OrbStack 引擎卡死 5.5h 事故后新增）。
#
# 设计原则（brain-keepalive #3522 教训）：cron/launchd 极简 PATH，全部绝对路径。
# 告警去重：/tmp state 文件，同一故障最多每 REALERT_MINUTES 分钟报一次。
#
# 安装（launchd 优先，失败用 cron）：
#   launchctl bootstrap gui/$(id -u) <repo>/scripts/sentinel/com.cecelia.dead-man-switch.plist
#   或 crontab: */10 * * * * /bin/bash <repo>/scripts/sentinel/dead-man-switch.sh
#
# 测试点火（proven-to-fire）：STALE_MINUTES=0 bash dead-man-switch.sh → 必报
set -uo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

PSQL="$(command -v psql || echo /opt/homebrew/bin/psql)"
CURL="$(command -v curl || echo /usr/bin/curl)"
JQ="$(command -v jq || echo /opt/homebrew/bin/jq)"
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
ORBCTL="$(command -v orbctl || echo /usr/local/bin/orbctl)"

STALE_MINUTES="${STALE_MINUTES:-15}"       # loop 60s 一轮，15min 容忍重启/部署窗口
EXPECT_KEYS_FALLBACK="${EXPECT_KEYS_FALLBACK:-4}"  # DB 无预期键时兜底（旧版 brain）
REALERT_MINUTES="${REALERT_MINUTES:-60}"   # 同一故障告警间隔
DOCKER_ENGINE_RETRY_SECONDS="${DOCKER_ENGINE_RETRY_SECONDS:-60}"  # orbctl start 后等待重试秒数
STATE_FILE="/tmp/dead-man-switch.last-alert"
DOCKER_STATE_FILE="/tmp/dead-man-switch.docker-last-alert"

log() {
  echo "$(date '+%m-%d %H:%M:%S') $*"
}

bark() {
  local msg="$1"
  # shellcheck disable=SC1091
  [[ -f "$HOME/.credentials/bark.env" ]] && source "$HOME/.credentials/bark.env"
  if [[ -z "${BARK_TOKEN:-}" ]]; then
    log "[dead-man] 未配 BARK_TOKEN，无法告警：$msg"
    return 1
  fi
  local title body
  title=$(printf '%s' "死人开关" | "$JQ" -sRr @uri)
  body=$(printf '%s' "$msg" | "$JQ" -sRr @uri)
  "$CURL" -sf --max-time 10 "https://api.day.app/${BARK_TOKEN}/${title}/${body}?group=dead-man-switch&level=critical" >/dev/null 2>&1 \
    && log "[dead-man] 已告警: $msg" || log "[dead-man] Bark 推送失败: $msg"
}

alert_dedup() {
  local msg="$1"
  local now last
  now=$(date +%s)
  last=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  if (( now - last >= REALERT_MINUTES * 60 )); then
    bark "$msg" && echo "$now" > "$STATE_FILE"
  else
    log "[dead-man] 故障持续但告警冷却中: $msg"
  fi
}

# ── docker 引擎看门狗：docker ps 不通 → orbctl start 自愈一次 → 60s 后仍不通 → Bark ──
docker_engine_check() {
  if timeout 10 "$DOCKER" ps >/dev/null 2>&1; then
    rm -f "$DOCKER_STATE_FILE" 2>/dev/null || true
    return 0
  fi

  log "[dead-man] docker ps 不通，尝试 orbctl start 自愈"
  "$ORBCTL" start >/dev/null 2>&1 || true
  sleep "$DOCKER_ENGINE_RETRY_SECONDS"

  if timeout 10 "$DOCKER" ps >/dev/null 2>&1; then
    log "[dead-man] docker 引擎自愈成功"
    rm -f "$DOCKER_STATE_FILE" 2>/dev/null || true
    return 0
  fi

  local now last
  now=$(date +%s)
  last=$(cat "$DOCKER_STATE_FILE" 2>/dev/null || echo 0)
  if (( now - last >= REALERT_MINUTES * 60 )); then
    bark "docker 引擎死亡且自愈失败（orbctl start ${DOCKER_ENGINE_RETRY_SECONDS}s 后仍不通）"
    echo "$now" > "$DOCKER_STATE_FILE"
  else
    log "[dead-man] docker 引擎故障持续但告警冷却中"
  fi
  return 1
}

docker_engine_check || true

# ── 预期 job 数：brain 启动时写 scheduler_jobs_expected，加 job 自动同步 ──
EXPECT_KEYS=$("$PSQL" -h localhost -p 5432 -U postgres -d cecelia -tA -c \
  "SELECT coalesce((value_json->>'count')::int, ${EXPECT_KEYS_FALLBACK}) FROM working_memory WHERE key='scheduler_jobs_expected';" 2>/dev/null | tr -d ' ')
EXPECT_KEYS="${EXPECT_KEYS:-$EXPECT_KEYS_FALLBACK}"

# ── 核心检查：哨兵键数量 + 新鲜度（psql 挂 = DB 死，同样告警）──
RESULT=$("$PSQL" -h localhost -p 5432 -U postgres -d cecelia -tA -c \
  "SELECT count(*) || '|' || coalesce(extract(epoch from (now() - min(updated_at)))::int, -1)
   FROM working_memory WHERE key LIKE 'scheduler_job_last_run:%';" 2>/dev/null) || RESULT=""

if [[ -z "$RESULT" ]]; then
  alert_dedup "无法连接 cecelia 数据库——Postgres 挂了或机器异常"
  exit 1
fi

KEY_COUNT="${RESULT%%|*}"
OLDEST_AGE_S="${RESULT##*|}"

if [[ "$KEY_COUNT" -lt "$EXPECT_KEYS" ]]; then
  alert_dedup "哨兵键只剩 ${KEY_COUNT}/${EXPECT_KEYS}——scheduler-jobs 注册表异常"
  exit 1
fi

if [[ "$OLDEST_AGE_S" -lt 0 ]] || (( OLDEST_AGE_S > STALE_MINUTES * 60 )); then
  alert_dedup "哨兵键 ${STALE_MINUTES} 分钟未更新（最旧 $((OLDEST_AGE_S/60)) 分钟）——Brain 或 scheduler loop 静默死亡"
  exit 1
fi

rm -f "$STATE_FILE" 2>/dev/null || true
log "[dead-man] OK：${KEY_COUNT} 键，最旧 $((OLDEST_AGE_S/60)) 分钟前"
```

- [ ] **Step 2: 语法检查**

Run: `bash -n scripts/sentinel/dead-man-switch.sh`
Expected: 无输出（语法正确）

- [ ] **Step 3: 跑 smoke 验证全绿**

Run: `bash packages/brain/scripts/smoke/p1pr2-deadman-trigger-backup-smoke.sh`
Expected: 全部 ✅，`结果: N 通过 / 0 失败`，exit 0

- [ ] **Step 4: commit（绿）**

```bash
git add scripts/sentinel/dead-man-switch.sh
git commit -m "fix(brain): 死人开关加日志时间戳 + docker 引擎自愈看门狗"
```

---

### Task 3: proven-to-fire 双环境实测（人工验证，非自动化）

**Files:** 无文件改动，纯手动验证 + 记录

- [ ] **Step 1: 交互 shell 实测——哨兵键过期分支**

Run: `cd /Users/administrator/worktrees/cecelia/deadman-hardening && STALE_MINUTES=0 REALERT_MINUTES=0 bash scripts/sentinel/dead-man-switch.sh`
Expected: 输出含时间戳前缀的日志行；最终报 "哨兵键 0 分钟未更新" 类告警行；`[dead-man] 已告警` 或 `Bark 推送失败`（视 BARK_TOKEN 是否配置）

- [ ] **Step 2: 交互 shell 实测——docker 引擎自愈分支（用假 docker 命令模拟不通，不动真实 daemon）**

Run:
```bash
mkdir -p /tmp/fake-bin
cat > /tmp/fake-bin/docker <<'EOF'
#!/bin/bash
exit 1
EOF
chmod +x /tmp/fake-bin/docker
cat > /tmp/fake-bin/orbctl <<'EOF'
#!/bin/bash
echo "fake orbctl start called"
EOF
chmod +x /tmp/fake-bin/orbctl
rm -f /tmp/dead-man-switch.docker-last-alert
DOCKER_ENGINE_RETRY_SECONDS=2 REALERT_MINUTES=0 PATH="/tmp/fake-bin:$PATH" bash scripts/sentinel/dead-man-switch.sh
```
Expected: 日志出现「docker ps 不通，尝试 orbctl start 自愈」→ 等 2 秒 → 「docker 引擎死亡且自愈失败」→ Bark 尝试

- [ ] **Step 3: cron 版一次性实测（真收到 Bark）**

```bash
CRON_LINE="* * * * * STALE_MINUTES=0 REALERT_MINUTES=0 /bin/bash /Users/administrator/worktrees/cecelia/deadman-hardening/scripts/sentinel/dead-man-switch.sh >> /tmp/dead-man-switch-crontest.log 2>&1"
( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
sleep 70
cat /tmp/dead-man-switch-crontest.log
crontab -l | grep -v "dead-man-switch-crontest" | crontab -
rm -f /tmp/dead-man-switch-crontest.log /tmp/dead-man-switch.last-alert
```
Expected: 日志文件出现带时间戳的告警行；手机收到一条 Bark 推送（人工确认）；测完撤 crontab 条目（脚本已含撤销）

- [ ] **Step 4: 把三步实测结果记录进 handoff（下个环节）**

---

### Task 4: PR + CI + 部署收尾

- [ ] **Step 1: push 分支**

```bash
git push -u origin cp-0706233556-deadman-hardening
```

- [ ] **Step 2: 开 PR**

```bash
gh pr create --title "fix(brain): 死人开关加日志时间戳 + docker 引擎看门狗" --body "$(cat <<'EOF'
## 背景
07-07 凌晨 OrbStack 引擎卡死 5.5h，brain-keepalive 只管容器管不了引擎；事故复盘时日志无时间戳定位靠猜。

## 改动
- dead-man-switch.sh 全部日志加 `date '+%m-%d %H:%M:%S'` 时间戳前缀
- 新增 docker 引擎自愈检查：docker ps 不通 → orbctl start 自愈一次 → 60s 后仍不通 → Bark critical（独立 dedup 状态文件）
- smoke 新增两条断言（时间戳格式 / orbctl 自愈分支）

## Test
- smoke: `bash packages/brain/scripts/smoke/p1pr2-deadman-trigger-backup-smoke.sh` 全绿
- proven-to-fire：交互 shell（哨兵过期 + 假 docker 不通两条分支）+ 一次性 cron 条目真实触发 Bark，详见交接单

🤖 Generated with Claude Code
EOF
)"
```

- [ ] **Step 3: 等 CI，绿后自己 merge（squash，无需 --admin）**

```bash
gh pr checks --watch
gh pr merge --squash --auto
```

- [ ] **Step 4: 确认合并 + 无需 bump 版本（scripts-only PR，非 packages/brain 触发 auto-version 的路径需确认）**
