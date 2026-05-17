#!/usr/bin/env bash
# kr3-deploy-miniapp.sh — KR3 小程序一键部署脚本
# 在 xian-m4 (CN Mac mini) 上运行
#
# 前提：~/.credentials/wechat-miniapp.env 已配置 MINIAPP_PRIVATE_KEY
# 用法：bash scripts/kr3-deploy-miniapp.sh [--cloud-only | --upload-only | --all]

set -euo pipefail

MINIAPP_DIR="${MINIAPP_DIR:-$HOME/perfect21/zenithjoy-miniapp}"
CRED_FILE="$HOME/.credentials/wechat-miniapp.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
ok()    { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
die()   { echo -e "${RED}❌ $1${NC}"; exit 1; }

MODE="${1:---all}"

echo "=== KR3 小程序部署 ($MODE) ==="
echo "目录: $MINIAPP_DIR"
echo ""

# 检查凭据
if [[ ! -f "$CRED_FILE" ]]; then
  die "凭据文件不存在: $CRED_FILE

  请先配置：
  1. 从 https://mp.weixin.qq.com → 开发管理 → 代码上传密钥 → 生成并下载私钥
  2. 执行: bash scripts/kr3-deploy-miniapp.sh --setup-key ~/Downloads/private.wx98c067e00cce09da.key"
fi

# 特殊：私钥配置入口
if [[ "${1:-}" == "--setup-key" ]]; then
  KEY_FILE="${2:-}"
  [[ -f "$KEY_FILE" ]] || die "私钥文件不存在: $KEY_FILE"

  PRIVATE_KEY=$(cat "$KEY_FILE")
  cat > "$CRED_FILE" <<EOF
MINIAPP_APPID=wx98c067e00cce09da
MINIAPP_PRIVATE_KEY=$PRIVATE_KEY
MINIAPP_CLOUD_ENV=zenithjoycloud-8g4ca5pbb5b027e8
EOF
  chmod 600 "$CRED_FILE"
  ok "凭据已写入 $CRED_FILE"

  # 存入 1Password
  if command -v op &>/dev/null && [[ -f ~/.credentials/1password.env ]]; then
    info "正在存入 1Password..."
    source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
    op item create --vault CS --category "API Credential" \
      --title "ZenithJoy Miniapp CI Key" \
      --tags "miniapp,zenithjoy,dev" \
      "private_key=$PRIVATE_KEY" 2>/dev/null \
      && ok "私钥已存入 1Password CS Vault" \
      || warn "1Password 存储失败，本地凭据已就绪"
  fi

  echo ""
  ok "配置完成！运行以下命令开始部署："
  echo "  bash scripts/kr3-deploy-miniapp.sh --all"
  exit 0
fi

# 加载凭据
source "$CRED_FILE"
[[ -n "${MINIAPP_PRIVATE_KEY:-}" ]] || die "MINIAPP_PRIVATE_KEY 未设置"
export MINIAPP_PRIVATE_KEY MINIAPP_APPID

# 切换到 miniapp 目录
cd "$MINIAPP_DIR" || die "目录不存在: $MINIAPP_DIR"

# 拉取最新代码
info "同步最新代码..."
git pull --quiet && ok "代码已同步（$(git log --oneline -1)）"

# 安装依赖
[[ -d node_modules ]] || { info "安装依赖..."; npm install --silent; }

# 部署云函数
if [[ "$MODE" == "--all" || "$MODE" == "--cloud-only" ]]; then
  echo ""
  info "部署云函数（共 19 个）..."
  node scripts/run-with-supported-node.js scripts/deploy-cloudfunctions.js
  ok "云函数部署完成"
fi

# 上传小程序代码
if [[ "$MODE" == "--all" || "$MODE" == "--upload-only" ]]; then
  echo ""
  info "上传小程序代码至微信平台..."
  MINIAPP_UPLOAD_DESC="KR3 Sprint - $(date '+%Y-%m-%d')" \
  MINIAPP_ROBOT=1 \
  node scripts/run-with-supported-node.js scripts/upload.js
  ok "代码上传完成"
fi

echo ""
echo "=== 部署完成 🚀 ==="
echo ""
echo "后续步骤："
echo "  1. 登录 mp.weixin.qq.com → 版本管理 → 体验版 → 设置为体验版"
echo "  2. 填写小程序信息（名称/图标/分类）"
echo "  3. 邀请 5-10 内测用户"
echo "  4. 并行推进：登录 pay.weixin.qq.com 申请商户号"
