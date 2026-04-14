#!/usr/bin/env bash
# setup-github-webhook.sh - 为 GitHub 仓库配置 Webhook
#
# 使用方式：
#   bash scripts/setup-github-webhook.sh <owner/repo>
#
# 环境变量（必填）：
#   GITHUB_WEBHOOK_SECRET  - Webhook secret（建议 32+ 字符随机字符串）
#   BRAIN_PUBLIC_URL       - Brain 服务的公网 URL（如 https://brain.example.com）
#
# 可选环境变量：
#   GITHUB_TOKEN           - GitHub Personal Access Token（如未通过 gh auth login 登录）
#
# 示例：
#   export GITHUB_WEBHOOK_SECRET="my-super-secret-32-chars-minimum"
#   export BRAIN_PUBLIC_URL="https://brain.example.com"
#   bash scripts/setup-github-webhook.sh perfectuser21/cecelia
#
# 依赖：gh CLI（GitHub CLI），已认证

set -euo pipefail

# ===== 帮助信息 =====
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
setup-github-webhook.sh - 为 GitHub 仓库配置 PR 合并 Webhook

使用方式：
  bash scripts/setup-github-webhook.sh <owner/repo>

环境变量（必填）：
  GITHUB_WEBHOOK_SECRET  - Webhook secret（建议 32+ 字符随机字符串）
  BRAIN_PUBLIC_URL       - Brain 服务的公网 URL（如 https://brain.example.com）

可选环境变量：
  GITHUB_TOKEN           - GitHub Personal Access Token（如未通过 gh auth login 登录）

示例：
  export GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
  export BRAIN_PUBLIC_URL="https://brain.example.com"
  bash scripts/setup-github-webhook.sh perfectuser21/cecelia

注意：
  - Webhook Payload URL 格式: {BRAIN_PUBLIC_URL}/api/brain/webhook/github
  - 只监听 pull_request 事件
  - Secret 必须与 GITHUB_WEBHOOK_SECRET 环境变量一致
  - Brain 服务必须可以从公网访问（通过 Cloudflare Tunnel 或其他方式）
EOF
  exit 0
fi

# ===== 参数检查 =====
REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  echo "❌ 错误：缺少仓库参数" >&2
  echo "" >&2
  echo "使用方式：bash scripts/setup-github-webhook.sh <owner/repo>" >&2
  echo "示例：    bash scripts/setup-github-webhook.sh perfectuser21/cecelia" >&2
  exit 1
fi

# ===== 环境变量检查 =====
if [[ -z "${GITHUB_WEBHOOK_SECRET:-}" ]]; then
  echo "❌ 错误：GITHUB_WEBHOOK_SECRET 未设置" >&2
  echo "" >&2
  echo "生成方式：export GITHUB_WEBHOOK_SECRET=\"\$(openssl rand -hex 32)\"" >&2
  echo "或手动设置一个 32+ 字符的随机字符串" >&2
  exit 1
fi

if [[ -z "${BRAIN_PUBLIC_URL:-}" ]]; then
  echo "❌ 错误：BRAIN_PUBLIC_URL 未设置" >&2
  echo "" >&2
  echo "示例：export BRAIN_PUBLIC_URL=\"https://brain.example.com\"" >&2
  exit 1
fi

# 验证 secret 长度（至少 20 字符）
if [[ ${#GITHUB_WEBHOOK_SECRET} -lt 20 ]]; then
  echo "⚠️  警告：GITHUB_WEBHOOK_SECRET 长度不足（建议 32+ 字符）" >&2
fi

# ===== 构建 Webhook URL =====
BRAIN_PUBLIC_URL="${BRAIN_PUBLIC_URL%/}"  # 去掉末尾斜杠
WEBHOOK_URL="${BRAIN_PUBLIC_URL}/api/brain/webhook/github"

echo "📋 配置信息："
echo "   仓库: $REPO"
echo "   Webhook URL: $WEBHOOK_URL"
echo "   Secret: ${GITHUB_WEBHOOK_SECRET:0:4}**** (已隐藏)"
echo ""

# ===== gh CLI 检查 =====
if ! command -v gh &>/dev/null; then
  echo "❌ 错误：gh CLI 未安装" >&2
  echo "" >&2
  echo "安装方式：" >&2
  echo "  Ubuntu/Debian: sudo apt install gh" >&2
  echo "  macOS:         brew install gh" >&2
  echo "  或访问: https://cli.github.com" >&2
  exit 1
fi

# ===== 检查 gh 认证状态 =====
if ! gh auth status &>/dev/null; then
  echo "❌ 错误：gh CLI 未认证" >&2
  echo "" >&2
  echo "请先运行：gh auth login" >&2
  exit 1
fi

# ===== 检查是否已有 webhook =====
echo "🔍 检查已有 Webhook..."
EXISTING=$(gh api "repos/$REPO/hooks" 2>/dev/null | jq -r ".[] | select(.config.url == \"$WEBHOOK_URL\") | .id" 2>/dev/null || echo "")

if [[ -n "$EXISTING" ]]; then
  echo "⚠️  已存在相同 URL 的 Webhook（ID: ${EXISTING}）"
  echo ""
  echo "选项："
  echo "  1. 删除并重建（推荐，更新 secret）"
  echo "  2. 保留现有（不做任何修改）"
  echo ""
  read -rp "请选择 [1/2]: " CHOICE
  if [[ "$CHOICE" == "2" ]]; then
    echo "✅ 保留现有 Webhook"
    exit 0
  fi

  echo "🗑️  删除现有 Webhook ID: $EXISTING..."
  gh api -X DELETE "repos/$REPO/hooks/$EXISTING"
  echo "✅ 已删除"
  echo ""
fi

# ===== 创建 Webhook =====
echo "🔧 创建 GitHub Webhook..."
RESPONSE=$(gh api \
  --method POST \
  "repos/$REPO/hooks" \
  --field name=web \
  --field active=true \
  --field "events[]=pull_request" \
  --field "config[url]=$WEBHOOK_URL" \
  --field "config[content_type]=json" \
  --field "config[secret]=$GITHUB_WEBHOOK_SECRET" \
  --field "config[insecure_ssl]=0" 2>&1)

WEBHOOK_ID=$(echo "$RESPONSE" | jq -r '.id' 2>/dev/null || echo "")

if [[ -z "$WEBHOOK_ID" || "$WEBHOOK_ID" == "null" ]]; then
  echo "❌ Webhook 创建失败" >&2
  echo "" >&2
  echo "错误信息：$RESPONSE" >&2
  exit 1
fi

echo "✅ Webhook 创建成功！"
echo ""
echo "📊 配置详情："
echo "   Webhook ID: $WEBHOOK_ID"
echo "   Payload URL: $WEBHOOK_URL"
echo "   Events: pull_request"
echo "   Active: true"
echo "   SSL: 验证"
echo ""
echo "🔑 重要：确保 Brain 服务的环境变量中已设置："
echo "   GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET"
echo ""
echo "💡 测试方式："
echo "   gh api repos/$REPO/hooks/$WEBHOOK_ID/deliveries | jq '.[0]'"
