#!/usr/bin/env bash
# kr3-setup-wx-pay.sh — ZenithJoy KR3 微信支付商户号配置引导
#
# 用法:
#   bash scripts/kr3-setup-wx-pay.sh              # 交互引导模式
#   bash scripts/kr3-setup-wx-pay.sh --check-only # 仅检查现有配置状态
#   bash scripts/kr3-setup-wx-pay.sh --mark-done  # 已在微信云控制台配置完成，标记为就绪
#
# 说明:
#   WX_PAY_* 环境变量需在微信云开发控制台手动配置（Brain 无法直接注入）。
#   配置完成后运行本脚本 --mark-done 将状态写入 Brain DB，解除 KR3 进度阻断。
#
# 所需凭据来源:
#   微信商户平台: https://pay.weixin.qq.com
#   账户中心 → 商户信息 → 商户号 (MCHID)
#   账户中心 → API安全 → APIv3密钥 (32字节) + 证书序列号 + 下载私钥

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
CREDS_DIR="$HOME/.credentials"
MINIAPP_APPID="wx98c067e00cce09da"
PRIVATE_KEY_FILE="$CREDS_DIR/private.${MINIAPP_APPID}.key"
WECHAT_PAY_ENV="$CREDS_DIR/wechat-pay.env"
WECHAT_PAY_TEMPLATE="$CREDS_DIR/wechat-pay.env.template"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
pass()  { echo -e "${GREEN}✅ $1${NC}"; }
fail()  { echo -e "${RED}❌ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
title() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# ─── 检查 Brain API 状态 ────────────────────────────────────────────────────

check_brain() {
  title "Brain 连接检查"
  if curl -sf "$BRAIN_URL/api/brain/ping" >/dev/null 2>&1 || \
     curl -sf "$BRAIN_URL/api/brain/context" >/dev/null 2>&1; then
    pass "Brain 可连接: $BRAIN_URL"
    return 0
  else
    warn "Brain 不可连接，将使用 psql 直接写入 DB"
    return 1
  fi
}

# ─── 通过 psql 写入 Brain DB ────────────────────────────────────────────────

mark_via_psql() {
  local topic="$1"
  local decision="$2"
  local category="${3:-kr3-config}"

  psql -d cecelia -c "
    -- 先废弃旧记录
    UPDATE decisions SET status = 'superseded', updated_at = NOW()
    WHERE topic = '${topic}' AND category = '${category}' AND status = 'active';

    -- 写入新记录
    INSERT INTO decisions (topic, decision, category, status, made_by, created_at, updated_at)
    VALUES ('${topic}', '${decision}', '${category}', 'active', 'system', NOW(), NOW());
  " 2>/dev/null && return 0 || return 1
}

# ─── 检查现有配置状态 ───────────────────────────────────────────────────────

check_config_status() {
  title "KR3 配置状态检查"

  # 检查 Brain API（新版 topic 列）
  local api_result
  api_result=$(curl -sf "$BRAIN_URL/api/brain/kr3/check-config" 2>/dev/null || echo '{}')
  local wx_pay_ok admin_oid_ok
  wx_pay_ok=$(echo "$api_result" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{const j=JSON.parse(d);console.log(j.wxPayConfigured?'yes':'no')}catch{console.log('unknown')}" 2>/dev/null || echo "unknown")
  admin_oid_ok=$(echo "$api_result" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{const j=JSON.parse(d);console.log(j.adminOidReady?'yes':'no')}catch{console.log('unknown')}" 2>/dev/null || echo "unknown")

  # 如果 API 返回检测失败（列名 bug）或结果 unknown，直接查 DB
  local api_summary
  api_summary=$(echo "$api_result" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log(JSON.parse(d).summary||'')}catch{console.log('')}" 2>/dev/null || echo "")
  if [[ "$wx_pay_ok" == "unknown" ]] || echo "$api_summary" | grep -q "检测失败"; then
    info "Brain API 异常，直接查询 Brain DB..."
    local db_wx db_oid
    db_wx=$(psql -d cecelia -At -c "SELECT COUNT(*) FROM decisions WHERE topic='kr3_wx_pay_configured' AND status='active'" 2>/dev/null || echo "0")
    db_oid=$(psql -d cecelia -At -c "SELECT COUNT(*) FROM decisions WHERE topic='kr3_admin_oid_initialized' AND status='active'" 2>/dev/null || echo "0")
    wx_pay_ok=$([[ "$db_wx" -gt 0 ]] && echo "yes" || echo "no")
    admin_oid_ok=$([[ "$db_oid" -gt 0 ]] && echo "yes" || echo "no")
  fi

  # 显示状态
  if [[ "$admin_oid_ok" == "yes" ]]; then
    pass "管理员 OpenID 已初始化 (BUILT_IN_ADMIN_OPENIDS + DB 记录)"
  else
    warn "管理员 OpenID 未标记 — 运行 bootstrapAdmin 云函数后再次检查"
  fi

  if [[ "$wx_pay_ok" == "yes" ]]; then
    pass "微信支付商户号已配置"
  else
    fail "微信支付商户号 未配置"
    echo ""
    warn "需要在微信云控制台为 createPaymentOrder 云函数配置以下环境变量:"
    echo "  WX_PAY_MCHID       商户号 (10位数字)"
    echo "  WX_PAY_V3_KEY      APIv3密钥 (32字节)"
    echo "  WX_PAY_SERIAL_NO   商户证书序列号"
    echo "  WX_PAY_PRIVATE_KEY 商户私钥 (PKCS#8 PEM，去掉首尾行)"
    echo "  WX_PAY_NOTIFY_URL  支付回调URL (notifyPayment HTTP触发器)"
  fi

  # 检查本地私钥
  echo ""
  if [[ -f "$PRIVATE_KEY_FILE" ]]; then
    pass "本地私钥已存在: $PRIVATE_KEY_FILE"
    local key_type
    key_type=$(head -1 "$PRIVATE_KEY_FILE" 2>/dev/null || echo "unknown")
    if [[ "$key_type" == *"RSA PRIVATE KEY"* ]]; then
      warn "私钥格式为 PKCS#1 (RSA)，微信支付要求 PKCS#8 格式"
      info "转换命令: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in $PRIVATE_KEY_FILE -out $CREDS_DIR/apiclient_key.pem"
    elif [[ "$key_type" == *"PRIVATE KEY"* ]]; then
      pass "私钥格式正确 (PKCS#8)"
    fi
  else
    warn "未找到本地私钥 $PRIVATE_KEY_FILE"
    info "请从微信商户平台 → API安全 下载 apiclient_key.pem"
  fi

  # 检查 wechat-pay.env
  if [[ -f "$WECHAT_PAY_ENV" ]]; then
    local mchid_line
    mchid_line=$(grep "^WX_PAY_MCHID=" "$WECHAT_PAY_ENV" 2>/dev/null || echo "")
    if [[ -n "$mchid_line" && "${mchid_line#*=}" != "" ]]; then
      pass "~/.credentials/wechat-pay.env 存在且有 MCHID"
    else
      warn "~/.credentials/wechat-pay.env 存在但 WX_PAY_MCHID 为空"
    fi
  else
    warn "~/.credentials/wechat-pay.env 不存在"
    if [[ -f "$WECHAT_PAY_TEMPLATE" ]]; then
      info "使用模板创建: cp $WECHAT_PAY_TEMPLATE $WECHAT_PAY_ENV 并填写凭据"
    fi
  fi
}

# ─── 标记 WX Pay 为已配置 ───────────────────────────────────────────────────

mark_wx_pay_done() {
  title "标记微信支付商户号为已配置"

  # 读取 MCHID 后4位（用于备注，不暴露完整值）
  local note="已在微信云控制台配置 WX_PAY_* 环境变量"
  if [[ -f "$WECHAT_PAY_ENV" ]]; then
    local mchid
    mchid=$(grep "^WX_PAY_MCHID=" "$WECHAT_PAY_ENV" 2>/dev/null | cut -d= -f2 || echo "")
    if [[ -n "$mchid" ]]; then
      local last4="${mchid: -4}"
      note="商户号 ***${last4} 已配置，wechat-pay.env 已同步"
    fi
  fi

  info "写入 Brain DB: kr3_wx_pay_configured"

  # 先尝试 Brain API
  local api_ok=false
  if curl -sf -X POST "$BRAIN_URL/api/brain/kr3/mark-wx-pay" \
     -H "Content-Type: application/json" \
     -d "{\"note\":\"$note\"}" 2>/dev/null | grep -q '"ok":true'; then
    api_ok=true
  fi

  if $api_ok; then
    pass "Brain API 标记成功"
  else
    # 回退到 psql 直写
    warn "Brain API 不可用，通过 psql 直接写入..."
    if mark_via_psql "kr3_wx_pay_configured" "$note"; then
      pass "psql 写入成功"
    else
      fail "写入失败，请检查 PostgreSQL 连接"
      return 1
    fi
  fi

  echo ""
  pass "微信支付商户号配置已标记为就绪！"
  info "下一步: 通过微信开发者工具部署所有云函数，进行沙盒支付联调"
}

# ─── 主入口 ─────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  ZenithJoy KR3 微信支付商户号配置工具              ║"
  echo "╚══════════════════════════════════════════════════╝"

  local mode="${1:---check-only}"

  case "$mode" in
    --check-only)
      check_config_status
      ;;
    --mark-done)
      check_config_status
      echo ""
      mark_wx_pay_done
      ;;
    --help|-h)
      echo ""
      echo "用法:"
      echo "  bash scripts/kr3-setup-wx-pay.sh              # 检查配置状态"
      echo "  bash scripts/kr3-setup-wx-pay.sh --check-only # 仅检查（默认）"
      echo "  bash scripts/kr3-setup-wx-pay.sh --mark-done  # 标记 WX Pay 已配置"
      echo ""
      echo "配置流程:"
      echo "  1. 登录微信商户平台 https://pay.weixin.qq.com"
      echo "  2. 获取商户号 (MCHID) 和 API 证书"
      echo "  3. 在微信云开发控制台为 createPaymentOrder 配置 5 个环境变量"
      echo "  4. 运行本脚本 --mark-done 写入 Brain DB"
      echo "  5. 进行沙盒支付联调"
      ;;
    *)
      echo "未知参数: $mode"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
}

main "${1:-}"
