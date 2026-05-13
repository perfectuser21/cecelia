#!/usr/bin/env bash
# deploy-agent-to-rog.sh — Path 4 Sprint 1: 部署 wechat-rpa agent 到 rog 服务器
#
# rog = 本地/局域网 ASUS ROG 工作站（或同名服务器），运行 Python RPA 环境
#
# 用法:
#   ./scripts/deploy-agent-to-rog.sh [--dryrun] [--host <ip_or_host>]
#
# 环境变量（可覆盖）:
#   ROG_HOST          — 目标主机 (默认 rog / ~/.ssh/config 里的别名)
#   ROG_USER          — SSH 用户 (默认 administrator)
#   ROG_DEPLOY_DIR    — 远程目录 (默认 /opt/cecelia/agents/wechat-rpa)
#   DRYRUN            — 1 = 打印但不执行 ssh/rsync

set -euo pipefail

ROG_HOST="${ROG_HOST:-rog}"
ROG_USER="${ROG_USER:-administrator}"
ROG_DEPLOY_DIR="${ROG_DEPLOY_DIR:-/opt/cecelia/agents/wechat-rpa}"
DRYRUN="${DRYRUN:-0}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_SRC="$REPO_ROOT/scripts/agents"

# ── 参数解析 ─────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dryrun) DRYRUN=1 ;;
    --host)   ROG_HOST="$2"; shift ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
  shift
done

run() {
  if [[ "$DRYRUN" == "1" ]]; then
    echo "[DRYRUN] $*"
  else
    "$@"
  fi
}

echo "=== deploy-agent-to-rog ==="
echo "  目标: ${ROG_USER}@${ROG_HOST}:${ROG_DEPLOY_DIR}"
echo "  源:   ${AGENT_SRC}/"
echo "  DRYRUN: ${DRYRUN}"
echo ""

# ── 1. 本地预检 ───────────────────────────────────────

if [[ ! -f "$AGENT_SRC/wechat_rpa.py" ]]; then
  echo "❌ wechat_rpa.py 不存在: $AGENT_SRC/wechat_rpa.py"
  exit 1
fi

python3 -c "import ast, sys; ast.parse(open('$AGENT_SRC/wechat_rpa.py').read()); print('✅ Python 语法检查通过')"

# ── 2. 远程目录准备 ───────────────────────────────────

run ssh "${ROG_USER}@${ROG_HOST}" "mkdir -p ${ROG_DEPLOY_DIR}"

# ── 3. rsync agent 文件 ───────────────────────────────

run rsync -avz --checksum \
  --include="wechat_rpa.py" \
  --include="requirements.txt" \
  --exclude="*" \
  "$AGENT_SRC/" \
  "${ROG_USER}@${ROG_HOST}:${ROG_DEPLOY_DIR}/"

# ── 4. 远程: 安装 Python 依赖 ─────────────────────────

REQ_FILE="$AGENT_SRC/requirements.txt"
if [[ -f "$REQ_FILE" ]]; then
  run ssh "${ROG_USER}@${ROG_HOST}" \
    "cd ${ROG_DEPLOY_DIR} && pip3 install -q -r requirements.txt"
else
  echo "⚠️  requirements.txt 不存在，跳过 pip install"
fi

# ── 5. 远程: smoke 验证 health_check ─────────────────

echo ""
echo "--- smoke test: health_check ---"
SMOKE_CMD="echo '{\"session_id\":\"smoke\",\"action_type\":\"health_check\"}' | python3 ${ROG_DEPLOY_DIR}/wechat_rpa.py"

if [[ "$DRYRUN" == "1" ]]; then
  echo "[DRYRUN] ssh ${ROG_USER}@${ROG_HOST} '$SMOKE_CMD'"
else
  RESULT=$(ssh "${ROG_USER}@${ROG_HOST}" "$SMOKE_CMD" 2>&1)
  echo "$RESULT"
  if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('ok') else 1)" 2>/dev/null; then
    echo "✅ health_check 通过"
  else
    echo "❌ health_check 失败"
    exit 1
  fi
fi

echo ""
echo "✅ deploy-agent-to-rog 完成"
