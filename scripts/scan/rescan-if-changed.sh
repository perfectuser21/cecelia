#!/usr/bin/env bash
# =============================================================================
# rescan-if-changed.sh — 照相层事件扳机(2026-07-18)
# main SHA 变化或事实快照接近 freshness 上限时全量重扫。
# cron 安装(SSOT,系统时区 America/Los_Angeles):
#   */5 * * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/rescan-if-changed.sh >> /tmp/registry-scan.log 2>&1
# 每日 05:00 的 run-all-scans 全扫保留作兜底;账龄哨兵(>24h stale:true)继续押尾。
# 语义:
#   - ls-remote 失败 → 静默跳过(网络抖动不误触发,哨兵兜底)
#   - SHA 未变且最近成功扫描 <10min → 无输出退出
#   - SHA 变了 → 跑 run-all-scans,成功才记 SHA;失败不记账,下一轮自动重试
# 测试注入:RESCAN_STATE_FILE / RESCAN_SCAN_CMD
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

# ── 单飞 + 陈旧锁自愈 ────────────────────────────────────────────────────────
# 2026-08-17 事故:cron 每 5 分钟起一次,而一次全量扫描要 15-40 分钟,脚本无锁 →
# 每 5 分钟叠一个,实测堆到 11 个 rescan + 13 个 scan-graph 进程占 3.7GB,OOM 杀掉
# 镜像构建、fleet 准入报 node_not_base_admitted、map_stale 频发。锁必须归脚本自己
# 管(不依赖调用方 cron 行),跳过必须出声(静默跳过=故障隐身),持锁者卡死后锁要能
# 被抢占(否则一次挂死就是永久停摆)。
# 锁路径必须与调用方(crontab 应急期用的 /tmp/cecelia-rescan.lock)**错开**：
# 两层用同一路径时，外层先 mkdir 占住，脚本进来一看"锁已存在且新鲜"就直接跳过，
# 结果是扫描一轮都不跑。2026-08-18 实测坐实过一次。
LOCK_DIR="${RESCAN_LOCK_DIR:-/tmp/cecelia-rescan-script.lock}"
LOCK_STALE_SECONDS="${RESCAN_LOCK_STALE_SECONDS:-3600}"

if [ -d "$LOCK_DIR" ]; then
  # BSD 用 `stat -f %m`,GNU 用 `stat -c %Y`。不能用 `A || B` 串联:GNU 的 -f 是
  # --file-system,遇到 %m **不报错**却吐出 "?",于是永远轮不到 -c %Y,锁年龄恒为 0 →
  # 每轮都判陈旧抢占 → 单飞在 Linux 上彻底失效。必须逐个探测 + 校验纯数字才采纳。
  LOCK_MTIME=""
  for STAT_PROBE in "-f %m" "-c %Y"; do
    # shellcheck disable=SC2086
    CANDIDATE=$(stat $STAT_PROBE "$LOCK_DIR" 2>/dev/null || true)
    if [[ "$CANDIDATE" =~ ^[0-9]+$ ]]; then LOCK_MTIME="$CANDIDATE"; break; fi
  done
  if [ -n "$LOCK_MTIME" ]; then
    LOCK_AGE=$(( $(date +%s) - LOCK_MTIME ))
    if [ "$LOCK_AGE" -ge "$LOCK_STALE_SECONDS" ]; then
      echo "[rescan] 锁已陈旧(持有 ${LOCK_AGE}s ≥ ${LOCK_STALE_SECONDS}s),判定上一轮已死,抢占继续扫描" >&2
      rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
  else
    # 判不出年龄就保守当作"仍在运行":误判陈旧会去抢占,而并发扫描正是本 PR 要防的雪崩。
    echo "[rescan] 无法判定锁年龄(stat 不可用),保守视为上一轮仍在运行" >&2
  fi
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[rescan] 上一轮扫描仍在运行,本轮跳过;连续出现说明扫描卡住,快照会变陈旧" >&2
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# 扫描本身也要有上限:卡死的扫描会一直占着锁,把后续每一轮都挡在门外。
SCAN_TIMEOUT_SECONDS="${RESCAN_SCAN_TIMEOUT_SECONDS:-2400}"

STATE_FILE="${RESCAN_STATE_FILE:-/tmp/registry-scan-last-sha}"
SCAN_CMD="${RESCAN_SCAN_CMD:-bash scripts/scan/run-all-scans.sh}"
MAX_AGE_SEC="${RESCAN_MAX_AGE_SEC:-${RESCAN_MAX_AGE_SECONDS:-600}}"
NOW_EPOCH="${RESCAN_NOW_EPOCH:-$(date +%s)}"

REMOTE_SHA=$(git ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}')
if [ -z "$REMOTE_SHA" ]; then
  exit 0
fi

STATE_VALUE=$(cat "$STATE_FILE" 2>/dev/null || echo "none|0")
if [[ "$STATE_VALUE" == *"|"* ]]; then
  LAST_SHA="${STATE_VALUE%%|*}"
  LAST_SCAN_EPOCH="${STATE_VALUE#*|}"
else
  read -r LAST_SHA LAST_SCAN_EPOCH <<< "$STATE_VALUE"
fi
if [[ -z "${LAST_SCAN_EPOCH:-}" || ! "$LAST_SCAN_EPOCH" =~ ^[0-9]+$ ]]; then
  LAST_SCAN_EPOCH=$(stat -c %Y "$STATE_FILE" 2>/dev/null \
    || stat -f %m "$STATE_FILE" 2>/dev/null || echo 0)
fi
[[ "$LAST_SCAN_EPOCH" =~ ^[0-9]+$ ]] || LAST_SCAN_EPOCH=0
AGE_SEC=$((NOW_EPOCH - LAST_SCAN_EPOCH))
if [ "$REMOTE_SHA" = "$LAST_SHA" ] && (( AGE_SEC < MAX_AGE_SEC )); then
  exit 0
fi

echo "=== rescan-if-changed: main ${LAST_SHA:0:9} -> ${REMOTE_SHA:0:9} age=${AGE_SEC}s $(date '+%F %T %Z') ==="
run_scan_with_timeout() {
  EXPECTED_SCAN_SHA="$REMOTE_SHA" $SCAN_CMD &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$SCAN_TIMEOUT_SECONDS" ]; then
      # 连同扫描派生的子进程一起打掉,否则 scan-graph 会变成孤儿继续吃内存
      pkill -9 -P "$pid" 2>/dev/null || true
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      echo "[rescan] 扫描超时(${SCAN_TIMEOUT_SECONDS}s)已强杀,本轮不记账,下一轮重试" >&2
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

if run_scan_with_timeout; then
  STATE_TMP="${STATE_FILE}.tmp.$$"
  printf '%s|%s\n' "$REMOTE_SHA" "$NOW_EPOCH" > "$STATE_TMP"
  mv "$STATE_TMP" "$STATE_FILE"
  echo "=== rescan 完成,SHA 已记账 ==="
else
  echo "=== rescan 失败,SHA 不记账(下一轮重试) ==="
  exit 1
fi
