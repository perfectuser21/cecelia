#!/usr/bin/env bash
# gate3-wait-deploy.sh — Gate3「等待 Deploy 完成」：按部署 git_sha 判定本次提交是否真上线
#
# 背景（2026-09-28/29 两次实证，#5635 / #5654）：合并触发 webhook 时上一次部署仍在跑，
# 本次请求没有真正执行；旧逻辑轮询到 idle 即「视为成功」，生产 git_sha 仍是旧提交。
#
# 判定规则：
#   - running / rolling_back → 只等待，在线 SHA 不代表部署已结算。
#   - 不可达 → 继续等待
#   - failed → exit 1
#   - idle / success / succeeded：实际已结算成功收据匹配在线镜像/SHA，且 SHA 包含目标 → exit 0；
#     否则重触发一次 webhook（最多 MAX_RETRIGGER 次）继续轮询，耗尽 → exit 1
#   - 轮询预算（MAX_POLLS 次）耗尽 → exit 1
#
# 用法：bash scripts/ci/gate3-wait-deploy.sh <brain_url> <target_sha>
# 可调 env：POLL_INTERVAL_S(10) MAX_POLLS(570) MAX_RETRIGGER(2) REPO_DIR(.)
# 测试注入：STATUS_CMD（输出 status JSON 的命令）/ TRIGGER_CMD（输出 HTTP 码的命令）
set -uo pipefail

BRAIN_URL="${1:?用法: gate3-wait-deploy.sh <brain_url> <target_sha>}"
TARGET_SHA="${2:?缺少 target_sha}"
[[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "::error::非法 target_sha"; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-10}"
MAX_POLLS="${MAX_POLLS:-570}"
MAX_RETRIGGER="${MAX_RETRIGGER:-2}"
REPO_DIR="${REPO_DIR:-.}"
STATUS_CMD="${STATUS_CMD:-}"
TRIGGER_CMD="${TRIGGER_CMD:-}"

short() { echo "${1:0:7}"; }

json_field() {
  echo "$1" | jq -r --arg k "$2" '.[$k] // empty' 2>/dev/null || true
}

# deployed_contains <deployed_sha>：部署 sha 是否包含本次提交（相等或为其后代）
deployed_contains() {
  local deployed="$1"
  case "$deployed" in ""|unknown|null) return 1 ;; esac
  [ "$deployed" = "$TARGET_SHA" ] && return 0
  if ! git -C "$REPO_DIR" cat-file -e "${deployed}^{commit}" 2>/dev/null; then
    local left limit limiter
    left=$((DEADLINE - $(date +%s))); [ "$left" -gt 0 ] || return 1
    limit=30; [ "$left" -ge 30 ] || limit="$left"
    limiter=$(command -v timeout || command -v gtimeout || true)
    if [ -n "$limiter" ]; then
      "$limiter" --kill-after=1 "${limit}s" git -C "$REPO_DIR" fetch --quiet origin "$deployed" 2>/dev/null || true
    fi
  fi
  if git -C "$REPO_DIR" cat-file -e "${deployed}^{commit}" 2>/dev/null; then
    git -C "$REPO_DIR" merge-base --is-ancestor "$TARGET_SHA" "$deployed" 2>/dev/null
    return $?
  fi
  # 本地无该提交 → 退回 GitHub compare API（ahead/identical = 部署 sha 包含本次）
  if [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
    local cmp
    local left limit
    left=$((DEADLINE - $(date +%s))); [ "$left" -gt 0 ] || return 1
    limit=15; [ "$left" -ge 15 ] || limit="$left"
    cmp=$(curl -s --max-time "$limit" -H "Authorization: Bearer ${GH_TOKEN}" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/compare/${TARGET_SHA}...${deployed}" \
      | jq -r '.status // empty' 2>/dev/null)
    [ "$cmp" = "ahead" ] || [ "$cmp" = "identical" ]
    return $?
  fi
  return 1
}

RETRIGGERS=0
retrigger_or_fail() {
  local reason="$1"
  if [ "$RETRIGGERS" -ge "$MAX_RETRIGGER" ]; then
    echo "::error::Gate3 部署未包含本次提交 $(short "$TARGET_SHA")（${reason}），已重触发 ${RETRIGGERS} 次仍未上线 —— 请查 Brain 部署日志后重跑本 workflow"
    exit 1
  fi
  RETRIGGERS=$((RETRIGGERS + 1))
  local code
  local left limit
  left=$((DEADLINE - $(date +%s))); [ "$left" -gt 0 ] || return 1
  limit=60; [ "$left" -ge 60 ] || limit="$left"
  if [ -n "$TRIGGER_CMD" ]; then code=$($TRIGGER_CMD); else
    code=$(bash "$SCRIPT_DIR/gate3-trigger-deploy.sh" "$BRAIN_URL" "$TARGET_SHA" "$limit")
  fi
  echo "::warning::${reason} → 重触发部署 webhook（第 ${RETRIGGERS}/${MAX_RETRIGGER} 次）HTTP ${code}"
}

echo "轮询 ${BRAIN_URL}/api/brain/deploy/status，目标提交 $(short "$TARGET_SHA")（最多 ${MAX_POLLS} 次 × ${POLL_INTERVAL_S}s，重触发上限 ${MAX_RETRIGGER}）"

DEADLINE=$(( $(date +%s) + 5700 ))
POLL=0
while [ "$POLL" -lt "$MAX_POLLS" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  REMAINING=$((DEADLINE - $(date +%s)))
  REQUEST_BUDGET=90; [ "$REMAINING" -ge 90 ] || REQUEST_BUDGET="$REMAINING"
  if [ -n "$STATUS_CMD" ]; then
    STATUS_JSON=$($STATUS_CMD 2>/dev/null || true)
  else
    STATUS_JSON=$(curl -s --connect-timeout 10 --max-time "$REQUEST_BUDGET" "${BRAIN_URL}/api/brain/deploy/status" 2>/dev/null || true)
  fi
  [ "$(date +%s)" -lt "$DEADLINE" ] || break
  STATUS=$(json_field "$STATUS_JSON" status); STATUS="${STATUS:-unknown}"
  DEPLOYED=$(json_field "$STATUS_JSON" git_sha); DEPLOYED="${DEPLOYED:-unknown}"
  ELAPSED=$((POLL * POLL_INTERVAL_S))

  if deployed_contains "$DEPLOYED"; then CONTAINS="是"; else CONTAINS="否"; fi
  [ "$(date +%s)" -lt "$DEADLINE" ] || break
  echo "  [${ELAPSED}s] status=${STATUS} 部署sha=$(short "$DEPLOYED") 本次=$(short "$TARGET_SHA") 包含本次=${CONTAINS}"

  case "$STATUS" in
    idle|success|succeeded)
      if [ "$CONTAINS" = "是" ] && printf '%s' "$STATUS_JSON" | jq -e --arg sha "$DEPLOYED" '
          .settled == true and .settlement.outcome == "success" and .settlement.git_sha == $sha
          and (.settlement.image_id | test("^sha256:[a-f0-9]{64}$"))
          and (.settlement.deployment_id | test("^[a-f0-9-]{36}$"))
          and (.settlement.confirmed_at | type == "string")' >/dev/null 2>&1 && [ "$(date +%s)" -lt "$DEADLINE" ]; then
        echo "✅ SHA 比对通过：部署 sha $(short "$DEPLOYED") 包含本次提交 $(short "$TARGET_SHA")（status=${STATUS}）"
        exit 0
      fi
      if [ "$CONTAINS" != "是" ]; then
        retrigger_or_fail "status=${STATUS} 但部署 sha $(short "$DEPLOYED") 不含本次提交"
      else
        echo "    ⏳ SHA在线但结算未确认，继续等待真实收据"
      fi
      ;;
    failed|rollback_failed|rolled_back)
      ERR=$(json_field "$STATUS_JSON" error)
      echo "::error::Deploy 失败: ${ERR:-未知错误}"
      exit 1
      ;;
    running|rolling_back)
      echo "    ⏳ 前一次部署仍在进行，等它结束并结算后再判定"
      ;;
    *)
      echo "    ⚠️ deploy/status 不可达或未知状态，继续等待"
      ;;
  esac

  POLL=$((POLL + 1))
  REMAINING=$((DEADLINE - $(date +%s)))
  [ "$REMAINING" -gt 0 ] || break
  WAIT="$POLL_INTERVAL_S"
  [ "$WAIT" -le "$REMAINING" ] || WAIT="$REMAINING"
  sleep "$WAIT"
done

echo "::error::Deploy status 轮询超时（${MAX_POLLS} 次 × ${POLL_INTERVAL_S}s），部署 sha 仍未包含本次提交 $(short "$TARGET_SHA")"
exit 1
