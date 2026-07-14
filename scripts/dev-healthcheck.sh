#!/usr/bin/env bash
# dev-healthcheck.sh — Cecelia develop 宕机监控
# 每 5 分钟（300s）轮询 localhost:5220/api/brain/health
# 失败时向 Brain 5221 POST /api/brain/tasks 创建 alert 任务
# 运行方式：由 cron 调用（*/5 * * * *）或后台常驻进程
#
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail

DEV_PORT=5220
BRAIN_PORT=5221
INTERVAL=300   # 5 分钟
MAX_FAIL=2     # 连续失败 2 次（10 分钟）才告警

LOG_PREFIX="[dev-healthcheck]"
FAIL_COUNT_FILE="/tmp/cecelia-dev-healthcheck-fail-count"

log_info()  { echo "$LOG_PREFIX [INFO]  $1"; }
log_warn()  { echo "$LOG_PREFIX [WARN]  $1" >&2; }
log_error() { echo "$LOG_PREFIX [ERROR] $1" >&2; }

# 读取连续失败计数
read_fail_count() {
  if [[ -f "$FAIL_COUNT_FILE" ]]; then
    cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

# 重置失败计数
reset_fail_count() {
  echo 0 > "$FAIL_COUNT_FILE"
}

# 递增失败计数
increment_fail_count() {
  local count
  count=$(read_fail_count)
  echo $((count + 1)) > "$FAIL_COUNT_FILE"
  echo $((count + 1))
}

# 向 Brain 5221 创建 alert 任务
create_alert_task() {
  local fail_count=$1
  local payload
  payload=$(cat <<EOF
{
  "title": "develop 5220 health check failed",
  "type": "alert",
  "priority": "P1",
  "description": "develop 环境 Brain (port 5220) 健康检查失败，连续失败 ${fail_count} 次（每次间隔 5min）。请检查 cecelia-node-brain-dev 容器是否正常运行。",
  "source": "dev-healthcheck"
}
EOF
)

  log_warn "创建 alert 任务（连续失败 ${fail_count} 次）..."
  local http_code
  http_code=$(curl -s -o /tmp/dev_alert_resp.txt -w "%{http_code}" \
    -X POST "http://localhost:${BRAIN_PORT}/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --connect-timeout 10 --max-time 15 2>/dev/null || echo "000")

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    local task_id
    task_id=$(cat /tmp/dev_alert_resp.txt 2>/dev/null | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    log_info "alert 任务已创建: task_id=$task_id"
    # 告警后重置计数，避免重复告警（下次连续失败才再告警）
    reset_fail_count
  else
    log_error "创建 alert 任务失败 (HTTP $http_code)，继续计数"
  fi
}

# 单次健康检查
do_healthcheck() {
  if curl -sf "http://localhost:${DEV_PORT}/api/brain/health" > /tmp/dev_hc_resp.json 2>/dev/null; then
    local status
    status=$(cat /tmp/dev_hc_resp.json | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    if [[ "$status" == "healthy" ]]; then
      log_info "5220 healthy"
      reset_fail_count
      return 0
    else
      log_warn "5220 返回 200 但 status=${status}（异常）"
      return 1
    fi
  else
    log_warn "5220 health check 请求失败"
    return 1
  fi
}

# 主逻辑（单次执行模式，由 cron 每 5 分钟调用）
main_once() {
  if ! do_healthcheck; then
    local fail_count
    fail_count=$(increment_fail_count)
    log_warn "连续失败次数: ${fail_count}/${MAX_FAIL}"

    if [[ "$fail_count" -ge "$MAX_FAIL" ]]; then
      create_alert_task "$fail_count"
    fi
  fi
}

# 主逻辑（常驻模式，内置 sleep 循环）
main_loop() {
  log_info "启动 develop healthcheck 监控循环（间隔 ${INTERVAL}s, 最大连续失败 ${MAX_FAIL} 次告警）"
  while true; do
    main_once
    log_info "等待 ${INTERVAL}s..."
    sleep "$INTERVAL"
  done
}

# 根据参数决定模式
MODE="${1:-once}"
case "$MODE" in
  loop|daemon)
    main_loop
    ;;
  once|cron|"")
    main_once
    ;;
  *)
    echo "Usage: $0 [once|loop]"
    exit 1
    ;;
esac
