#!/usr/bin/env bash
# assert-deploy-effect.sh — 部署效果确认（反"假成功"）
#
# 背景（2026-07-06 Gate3 假成功实证）：
#   brain deploy webhook 只凭 deploy-local.sh 退出码判 success，容器 no-op 未重启（uptime 未变）
#   也谎报 success。修法：部署后断言"跑的是预期版本 且 容器真重启（uptime 新鲜）"。
# 背景（2026-07-15 Gate3 假红实证，run 29378715462）：
#   Gate3 部署实测 ~7min > workflow 等待步 300s，断言一锤子判定还在跑的旧版本 →
#   VERSION_MISMATCH 假红。修法：断言必须自带等待（wait_budget_s 预算内重试）。
#
# 用法：
#   assert-deploy-effect.sh <brain_url> <expected_version> [max_uptime_s=300] [wait_budget_s=0]
#     brain_url          Brain 基址（如 http://host:5221 或 https://...；末尾 /api/brain/health 自动补）
#     expected_version   本次部署应上线的 brain 版本（取自 packages/brain/package.json）
#     max_uptime_s       视为"新鲜重启"的 uptime 上限秒（默认 300）
#     wait_budget_s      等待预算秒（默认 0=一锤子判定）。>0 时对 VERSION_MISMATCH /
#                        UNREACHABLE / NO_OP 每 RETRY_INTERVAL_S（env，默认 15）秒重试，
#                        SUCCESS 立即返回；预算耗尽输出最后一次判定。
#
#   测试可注入 HEALTH_JSON_OVERRIDE=<文件路径> 跳过 curl（每轮重读文件）。
#
# verdict / exit：
#   SUCCESS          0  版本==预期 且 uptime<max（容器真重启、跑新版本）
#   VERSION_MISMATCH 2  /health 版本 != 预期（跑的是旧/错代码）
#   UNREACHABLE      3  /health 不可达 / 无 version / 无 uptime
#   NO_OP            4  版本对但 uptime>=max（容器未重启，无变更触发时的合法 no-op，明示而非谎报 success）
#
# 由 .github/workflows/brain-ci-deploy.yml Gate3 Smoke 步消费；
# 由 scripts/ci/__tests__/assert-deploy-effect.test.sh 守护（单一事实源）。
set -uo pipefail

BRAIN_URL="${1:?用法: assert-deploy-effect.sh <brain_url> <expected_version> [max_uptime_s] [wait_budget_s]}"
EXPECTED="${2:?缺 expected_version}"
MAX_UPTIME="${3:-300}"
WAIT_BUDGET="${4:-0}"
INTERVAL="${RETRY_INTERVAL_S:-15}"

# 单次判定：echo verdict 行 + return 对应退出码。每轮重取 JSON（override 重读文件 / curl 重打）。
check_once() {
  local JSON PARSED VER UP
  if [ -n "${HEALTH_JSON_OVERRIDE:-}" ]; then
    JSON=$(cat "$HEALTH_JSON_OVERRIDE" 2>/dev/null || true)
  else
    JSON=$(curl -s --connect-timeout 10 --max-time 15 "${BRAIN_URL%/}/api/brain/health" 2>/dev/null || true)
  fi

  if [ -z "$JSON" ]; then
    echo "UNREACHABLE：/health 无响应"
    return 3
  fi

  # 一次 node 解析出 "version uptime"（uptime 非数值输出 -1）
  PARSED=$(printf '%s' "$JSON" | node -e "
try {
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const v = (d && typeof d.version === 'string') ? d.version : '';
  const u = (d && typeof d.uptime_seconds === 'number') ? d.uptime_seconds : -1;
  process.stdout.write(v + ' ' + u);
} catch (e) { process.stdout.write(' -1'); }
" 2>/dev/null || echo " -1")

  VER="${PARSED% *}"
  UP="${PARSED##* }"

  if [ -z "$VER" ] || [ "$UP" = "-1" ]; then
    echo "UNREACHABLE：/health 缺 version 或 uptime_seconds（version='$VER' uptime='$UP'）"
    return 3
  fi

  if [ "$VER" != "$EXPECTED" ]; then
    echo "VERSION_MISMATCH：预期 ${EXPECTED}，实跑 ${VER}（部署未生效 / 跑旧代码）"
    return 2
  fi

  if [ "$UP" -ge "$MAX_UPTIME" ]; then
    echo "NO_OP：版本 $VER 正确但 uptime=${UP}s >= ${MAX_UPTIME}s —— 容器未重启（无变更触发的合法 no-op，不谎报 success）"
    return 4
  fi

  echo "SUCCESS：版本 $VER 已上线，uptime=${UP}s（容器真重启）"
  return 0
}

DEADLINE=$(( $(date +%s) + WAIT_BUDGET ))
while true; do
  OUT=$(check_once); RC=$?
  if [ "$RC" -eq 0 ] || [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "$OUT"
    exit "$RC"
  fi
  echo "未就绪: ${OUT} —— ${INTERVAL}s 后重试（等待预算内）" >&2
  sleep "$INTERVAL"
done
