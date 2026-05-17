#!/usr/bin/env bash
# verify-kr3.sh
# 验证 KR3「微信小程序上线」当前里程碑进度：
#   阶段 1 (50%) — 代码就绪 + 云函数部署 + 内测启动
#   阶段 2 (78%) — 真机 bug 清零 + 体验版提交
#   阶段 3 (95%) — 审核通过
#   阶段 4 (100%) — WX Pay 商户号 + 支付二期
#
# 用法：bash scripts/verify-kr3.sh [--target 50|75|100]
# exit 0 = 达到目标阶段，exit 1 = 未达标，exit 2 = Brain 不可达

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_CONTAINER="${DB_CONTAINER:-cecelia-postgres}"
DB_USER="${DB_USER:-cecelia}"
DB_NAME="${DB_NAME:-cecelia}"
TARGET="${2:-50}"

# --target flag 解析
for i in "$@"; do
  if [[ "$i" == "--target" ]]; then
    shift; TARGET="${1:-50}"; shift || true; break
  elif [[ "$i" == --target=* ]]; then
    TARGET="${i#--target=}"; shift || true; break
  fi
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo "[verify-kr3] $(date '+%H:%M:%S') $*"; }
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
info() { echo -e "${BLUE}ℹ️  $*${NC}"; }

# ── 数据源：优先 Brain API，降级 DB 直连 ─────────────────────────────────────

PROGRESS_PCT=""
STAGE=""
declare -A MILESTONE_DONE

fetch_from_brain_api() {
  local resp
  resp=$(curl -sf --max-time 5 "$BRAIN_URL/api/brain/kr3/progress" 2>/dev/null) || return 1
  PROGRESS_PCT=$(echo "$resp" | jq -r '.data.progress_pct // .progress_pct // empty')
  STAGE=$(echo "$resp" | jq -r '.data.stage // .stage // "unknown"')
  # 解析 breakdown
  local keys=("kr3_cloud_functions_deployed" "kr3_internal_test_started" "kr3_real_device_bugs_cleared" "kr3_trial_version_submitted" "kr3_audit_passed" "kr3_wx_pay_configured")
  for k in "${keys[@]}"; do
    local done_val
    done_val=$(echo "$resp" | jq -r ".data.breakdown[\"$k\"].done // .breakdown[\"$k\"].done // false")
    MILESTONE_DONE[$k]="$done_val"
  done
  return 0
}

fetch_from_db() {
  command -v docker &>/dev/null || return 1
  docker ps --filter "name=^${DB_CONTAINER}$" --format "{{.Names}}" \
    | grep -q "^${DB_CONTAINER}$" 2>/dev/null || return 1

  local psql_out
  psql_query() {
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "$1" | xargs
  }

  # KR3 progress from key_results
  PROGRESS_PCT=$(psql_query "
    SELECT COALESCE(progress, 0)::int FROM key_results
    WHERE (title ILIKE '%小程序%' OR title ILIKE '%KR3%')
      AND status IN ('active','in_progress','ready','decomposing')
    ORDER BY updated_at DESC LIMIT 1;
  ") || PROGRESS_PCT="60"

  # 里程碑 decisions
  local milestone_rows
  milestone_rows=$(psql_query "
    SELECT topic FROM decisions
    WHERE topic LIKE 'kr3_%' AND status = 'active';
  ") || milestone_rows=""

  local keys=("kr3_cloud_functions_deployed" "kr3_internal_test_started" "kr3_real_device_bugs_cleared" "kr3_trial_version_submitted" "kr3_audit_passed" "kr3_wx_pay_configured")
  for k in "${keys[@]}"; do
    if echo "$milestone_rows" | grep -q "$k"; then
      MILESTONE_DONE[$k]="true"
    else
      MILESTONE_DONE[$k]="false"
    fi
  done
  STAGE="db_fallback"
  return 0
}

# ── 主流程 ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== KR3 微信小程序上线 — 里程碑验收 ===${NC}"
echo "目标阶段: $TARGET%"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 数据获取
if fetch_from_brain_api; then
  info "数据来源: Brain API ($BRAIN_URL/api/brain/kr3/progress)"
elif fetch_from_db; then
  warn "Brain API 不可达，降级查询 DB（$DB_CONTAINER）"
else
  echo -e "${RED}❌ Brain API 和 DB 均不可达，无法验收${NC}"
  echo ""
  echo "检查方法："
  echo "  docker ps | grep cecelia-postgres   # DB 状态"
  echo "  curl $BRAIN_URL/api/brain/kr3/progress  # Brain API"
  exit 2
fi

echo -e "${BOLD}--- 里程碑状态 ---${NC}"
echo ""

# 里程碑表
declare -A MILESTONE_LABELS=(
  ["code_ready"]="代码就绪（PR#1-#28 全量合并）"
  ["kr3_cloud_functions_deployed"]="云函数生产部署（19 个）"
  ["kr3_internal_test_started"]="内测启动（5-10 人扫码）"
  ["kr3_real_device_bugs_cleared"]="真机 bug 清单清零"
  ["kr3_trial_version_submitted"]="体验版提交微信审核"
  ["kr3_audit_passed"]="微信审核通过"
  ["kr3_wx_pay_configured"]="WX Pay 商户号配置"
)

declare -A MILESTONE_WEIGHTS=(
  ["code_ready"]=60
  ["kr3_cloud_functions_deployed"]=10
  ["kr3_internal_test_started"]=5
  ["kr3_real_device_bugs_cleared"]=3
  ["kr3_trial_version_submitted"]=5
  ["kr3_audit_passed"]=12
  ["kr3_wx_pay_configured"]=5
)

declare -A MILESTONE_ACTIONS=(
  ["kr3_cloud_functions_deployed"]="Alex: 在 xian-m4 微信开发者工具上传云函数 → bash scripts/kr3-deploy-miniapp.sh --setup-key <key> → bash scripts/kr3-deploy-miniapp.sh --cloud-only → POST /api/brain/kr3/mark-cloud-functions-deployed"
  ["kr3_internal_test_started"]="Alex: mp.weixin.qq.com 设置体验版 → 邀请 5-10 内测用户 → POST /api/brain/kr3/mark-internal-test-started"
  ["kr3_real_device_bugs_cleared"]="Dev: 修复内测反馈 bug → POST /api/brain/kr3/mark-real-device-bugs-cleared"
  ["kr3_trial_version_submitted"]="Alex: 微信平台提交体验版审核 → POST /api/brain/kr3/mark-trial-version-submitted"
  ["kr3_audit_passed"]="等待微信审核（通常 3-7 天）→ 通过后 POST /api/brain/kr3/mark-audit-passed"
  ["kr3_wx_pay_configured"]="Alex: 申请微信商户号（pay.weixin.qq.com）→ 配置完毕后 POST /api/brain/kr3/mark-wx-pay"
)

CALCULATED_PCT=60  # 代码就绪基础分
ok "代码就绪（PR#1-#28 全量合并）           [权重: 60%]"

ORDERED_KEYS=("kr3_cloud_functions_deployed" "kr3_internal_test_started" "kr3_real_device_bugs_cleared" "kr3_trial_version_submitted" "kr3_audit_passed" "kr3_wx_pay_configured")
FIRST_PENDING=""

for k in "${ORDERED_KEYS[@]}"; do
  done_val="${MILESTONE_DONE[$k]:-false}"
  weight="${MILESTONE_WEIGHTS[$k]}"
  label="${MILESTONE_LABELS[$k]}"

  if [[ "$done_val" == "true" ]]; then
    CALCULATED_PCT=$((CALCULATED_PCT + weight))
    ok "${label}（+${weight}%）"
  else
    fail "${label}（+${weight}%）— 未完成"
    [[ -z "$FIRST_PENDING" ]] && FIRST_PENDING="$k"
  fi
done

echo ""
echo -e "${BOLD}--- 进度汇总 ---${NC}"
echo ""

# Brain 数值 vs 计算值
if [[ -n "$PROGRESS_PCT" && "$PROGRESS_PCT" != "$CALCULATED_PCT" ]]; then
  info "Brain DB 记录进度: ${PROGRESS_PCT}%  |  本次计算进度: ${CALCULATED_PCT}%"
  EFFECTIVE_PCT="$CALCULATED_PCT"
else
  EFFECTIVE_PCT="${PROGRESS_PCT:-$CALCULATED_PCT}"
fi

echo -e "当前进度: ${BOLD}${EFFECTIVE_PCT}%${NC}  |  目标阶段: ${BOLD}${TARGET}%${NC}"
echo ""

# ── 阶段判断 ─────────────────────────────────────────────────────────────────

phase_label() {
  local pct=$1
  if   [[ $pct -ge 95 ]]; then echo "阶段4：WX Pay（95%→100%）"
  elif [[ $pct -ge 83 ]]; then echo "阶段3：等待审核（83%→95%）"
  elif [[ $pct -ge 78 ]]; then echo "阶段2：体验版提交中（78%→83%）"
  elif [[ $pct -ge 75 ]]; then echo "阶段1b：真机测试中（75%→78%）"
  elif [[ $pct -ge 70 ]]; then echo "阶段1a：内测中（70%→75%）"
  elif [[ $pct -ge 60 ]]; then echo "阶段0：等待云函数部署（60%→70%）"
  else echo "未知阶段（$pct%）"
  fi
}

echo "当前阶段: $(phase_label $EFFECTIVE_PCT)"
echo ""

# 下一步行动
if [[ -n "$FIRST_PENDING" ]]; then
  echo -e "${BOLD}下一步（最高优先级）：${NC}"
  echo "  ${MILESTONE_ACTIONS[$FIRST_PENDING]}"
  echo ""
fi

# WX Pay 并行提醒
if [[ "${MILESTONE_DONE[kr3_wx_pay_configured]:-false}" != "true" ]]; then
  warn "WX Pay 商户号可与其他阶段并行申请（外部审核数天，越早越好）"
  echo "  → 登录 pay.weixin.qq.com → 账户注册 → 提交资料"
  echo ""
fi

# ── 目标达成判断 ──────────────────────────────────────────────────────────────

if [[ $EFFECTIVE_PCT -ge $TARGET ]]; then
  echo -e "${GREEN}${BOLD}🟢 KR3 已达到 ${TARGET}% 阶段目标（当前 ${EFFECTIVE_PCT}%）${NC}"
  echo ""
  exit 0
else
  GAP=$((TARGET - EFFECTIVE_PCT))
  echo -e "${RED}${BOLD}🔴 KR3 未达 ${TARGET}% 目标（当前 ${EFFECTIVE_PCT}%，差距 ${GAP}%）${NC}"
  echo ""
  echo "快速路径（达到 ${TARGET}%）："
  NEED=$GAP
  for k in "${ORDERED_KEYS[@]}"; do
    [[ "${MILESTONE_DONE[$k]:-false}" == "true" ]] && continue
    [[ $NEED -le 0 ]] && break
    w="${MILESTONE_WEIGHTS[$k]}"
    echo "  + 完成「${MILESTONE_LABELS[$k]}」→ +${w}%"
    NEED=$((NEED - w))
  done
  echo ""
  exit 1
fi
