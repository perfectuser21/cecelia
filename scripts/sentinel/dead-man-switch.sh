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
#   生产库在 us-vps（MMV 经 com.cecelia.pg-tunnel 转发 localhost:15432，口令走 ~/.pgpass）：
#     */10 * * * * DMS_PGPORT=15432 DMS_PGUSER=cecelia /bin/bash <repo>/scripts/sentinel/dead-man-switch.sh
#
# 测试点火（proven-to-fire）：STALE_MINUTES=0 bash dead-man-switch.sh → 必报
set -uo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

PSQL="${DMS_PSQL:-$(command -v psql || echo /opt/homebrew/bin/psql)}"
CURL="${DMS_CURL:-$(command -v curl || echo /usr/bin/curl)}"
JQ="$(command -v jq || echo /opt/homebrew/bin/jq)"
DOCKER="${DMS_DOCKER:-$(command -v docker || echo /usr/local/bin/docker)}"
ORBCTL="${DMS_ORBCTL:-$(command -v orbctl || echo /usr/local/bin/orbctl)}"

# 生产库 09-11 已迁 us-vps：MMV 上经 com.cecelia.pg-tunnel 走 localhost:15432（口令走 ~/.pgpass）。
# 默认值保持旧行为，部署处（crontab/plist）显式传 DMS_PG*。
DMS_PGHOST="${DMS_PGHOST:-localhost}"
DMS_PGPORT="${DMS_PGPORT:-5432}"
DMS_PGUSER="${DMS_PGUSER:-postgres}"
DMS_PGDATABASE="${DMS_PGDATABASE:-cecelia}"

STALE_MINUTES="${STALE_MINUTES:-15}"       # loop 60s 一轮，15min 容忍重启/部署窗口
EXPECT_KEYS_FALLBACK="${EXPECT_KEYS_FALLBACK:-6}"  # DB 无预期键时兜底（旧版 brain）
REALERT_MINUTES="${REALERT_MINUTES:-60}"   # 同一故障告警间隔
DOCKER_ENGINE_RETRY_SECONDS="${DOCKER_ENGINE_RETRY_SECONDS:-60}"  # orbctl start 后等待重试秒数
DMS_STATE_DIR="${DMS_STATE_DIR:-/tmp}"
STATE_FILE="${DMS_STATE_DIR}/dead-man-switch.last-alert"
DOCKER_STATE_FILE="${DMS_STATE_DIR}/dead-man-switch.docker-last-alert"

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
PSQL_CONN=(-h "$DMS_PGHOST" -p "$DMS_PGPORT" -U "$DMS_PGUSER" -d "$DMS_PGDATABASE")

EXPECT_KEYS=$("$PSQL" "${PSQL_CONN[@]}" -tA -c \
  "SELECT coalesce((value_json->>'count')::int, ${EXPECT_KEYS_FALLBACK}) FROM working_memory WHERE key='scheduler_jobs_expected';" 2>/dev/null | tr -d ' ')
EXPECT_KEYS="${EXPECT_KEYS:-$EXPECT_KEYS_FALLBACK}"

# ── 核心检查：STALE 窗口内报到的哨兵键数（psql 挂 = DB 死，同样告警）──
# 按「窗口内报到数 >= 预期 job 数」判定，不看最旧键：已下线 job 的孤儿键长期不更新，不能拖垮判定。
RESULT=$("$PSQL" "${PSQL_CONN[@]}" -tA -c \
  "SELECT count(*) FILTER (WHERE updated_at > now() - interval '${STALE_MINUTES} minutes') || '|' || count(*)
   FROM working_memory WHERE key LIKE 'scheduler_job_last_run:%';" 2>/dev/null) || RESULT=""

if [[ -z "$RESULT" ]]; then
  alert_dedup "无法连接 cecelia 数据库（${DMS_PGHOST}:${DMS_PGPORT}）——Postgres 挂了、隧道断了或机器异常"
  exit 1
fi

FRESH_COUNT="${RESULT%%|*}"
TOTAL_COUNT="${RESULT##*|}"

if [[ "$FRESH_COUNT" -lt "$EXPECT_KEYS" ]]; then
  alert_dedup "${STALE_MINUTES} 分钟内只有 ${FRESH_COUNT}/${EXPECT_KEYS} 个 job 报到——Brain 或 scheduler loop 静默死亡"
  exit 1
fi

rm -f "$STATE_FILE" 2>/dev/null || true
log "[dead-man] OK：${STALE_MINUTES} 分钟内 ${FRESH_COUNT}/${EXPECT_KEYS} 个 job 报到（哨兵键共 ${TOTAL_COUNT}）"
