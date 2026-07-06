#!/usr/bin/env bash
# dead-man-switch.sh — 作战循环死人开关（体外哨兵，P1-PR2）
#
# 独立于 Brain 进程运行（launchd/cron，每 10 分钟）。检查 scheduler-jobs 的
# working_memory 哨兵键新鲜度：Brain 死 / loop 死 / DB 死，任何一种静默死亡
# 都会让哨兵键停止更新 → Bark 告警。
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

STALE_MINUTES="${STALE_MINUTES:-15}"       # loop 60s 一轮，15min 容忍重启/部署窗口
EXPECT_KEYS_FALLBACK="${EXPECT_KEYS_FALLBACK:-4}"  # DB 无预期键时兜底（旧版 brain）
REALERT_MINUTES="${REALERT_MINUTES:-60}"   # 同一故障告警间隔
STATE_FILE="/tmp/dead-man-switch.last-alert"

bark() {
  local msg="$1"
  # shellcheck disable=SC1091
  [[ -f "$HOME/.credentials/bark.env" ]] && source "$HOME/.credentials/bark.env"
  if [[ -z "${BARK_TOKEN:-}" ]]; then
    echo "[dead-man] 未配 BARK_TOKEN，无法告警：$msg"
    return 1
  fi
  local title body
  title=$(printf '%s' "死人开关" | "$JQ" -sRr @uri)
  body=$(printf '%s' "$msg" | "$JQ" -sRr @uri)
  "$CURL" -sf --max-time 10 "https://api.day.app/${BARK_TOKEN}/${title}/${body}?group=dead-man-switch&level=critical" >/dev/null 2>&1 \
    && echo "[dead-man] 已告警: $msg" || echo "[dead-man] Bark 推送失败: $msg"
}

alert_dedup() {
  local msg="$1"
  local now last
  now=$(date +%s)
  last=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  if (( now - last >= REALERT_MINUTES * 60 )); then
    bark "$msg" && echo "$now" > "$STATE_FILE"
  else
    echo "[dead-man] 故障持续但告警冷却中: $msg"
  fi
}

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
echo "[dead-man] OK：${KEY_COUNT} 键，最旧 $((OLDEST_AGE_S/60)) 分钟前"
