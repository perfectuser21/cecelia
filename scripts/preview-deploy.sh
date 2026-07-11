#!/bin/bash
# preview-deploy.sh — per-branch 预览环境部署脚本
#
# 用法:
#   --print-port <BRANCH_NAME>   输出该 branch 的唯一端口（8000-8999），幂等，exit 0
#   （无参数）                    执行完整部署流程（本地调用）

set -e

# ============================================================
# 端口哈希计算函数（8000-8999 范围，幂等）
# ============================================================
compute_port() {
  local branch_name="$1"
  if [ -z "$branch_name" ]; then
    echo "ERROR: branch name 不能为空" >&2
    exit 1
  fi
  # 用 cksum 计算哈希值（POSIX 标准，无需 md5sum/sha256sum）
  # 取哈希数字部分 % 1000 得到 0-999，加 8000 得到 8000-8999
  local hash_val
  hash_val=$(echo -n "$branch_name" | cksum | awk '{print $1}')
  local port=$((8000 + hash_val % 1000))
  echo "$port"
}

# ============================================================
# --print-port CLI 接口（Step 3 契约：stdout 输出4位端口，exit 0）
# ============================================================
if [ "${1:-}" = "--print-port" ]; then
  if [ -z "${2:-}" ]; then
    echo "ERROR: --print-port 需要 branch name 参数" >&2
    exit 1
  fi
  compute_port "$2"
  exit 0
fi

# ============================================================
# 完整部署流程（本地/CI 直调）
# ============================================================
BRANCH_NAME="${PREVIEW_BRANCH:-${GITHUB_HEAD_REF:-$(git branch --show-current 2>/dev/null || echo 'unknown')}}"
PORT=$(compute_port "$BRANCH_NAME")
DEPLOY_DIR="${HOME}/previews/${PORT}"

echo "[preview-deploy] branch=$BRANCH_NAME port=$PORT deploy_dir=$DEPLOY_DIR"

# 先验证 SSH 连接活性（失败立即 exit 1，不产出无效 URL）
if [ -n "${HK_VPS_HOST:-}" ]; then
  if ! ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
      "${HK_VPS_USER:-deploy}@${HK_VPS_HOST}" "echo ok" >/dev/null 2>&1; then
    echo "ERROR: 无法连接 hk-vps ($HK_VPS_HOST)，SSH 连接失败" >&2
    exit 1
  fi
fi

# 端口碰撞检测（Risk 1 Mitigation）
if [ -f "/tmp/preview-${PORT}.pid" ]; then
  EXISTING_BRANCH=$(cat "/tmp/preview-${PORT}.branch" 2>/dev/null || echo "")
  if [ -n "$EXISTING_BRANCH" ] && [ "$EXISTING_BRANCH" != "$BRANCH_NAME" ]; then
    echo "ERROR: 端口 $PORT 被 branch '$EXISTING_BRANCH' 占用（碰撞检测），请重试或手动清理" >&2
    exit 1
  fi
fi

# 停止已有进程（幂等）
if [ -f "/tmp/preview-${PORT}.pid" ]; then
  OLD_PID=$(cat "/tmp/preview-${PORT}.pid")
  kill "$OLD_PID" 2>/dev/null || true
  rm -f "/tmp/preview-${PORT}.pid"
fi

# 创建部署目录
mkdir -p "$DEPLOY_DIR"

# 确认 preview-server.js 存在
PREVIEW_SERVER="${HOME}/scripts/preview-server.js"
if [ ! -f "$PREVIEW_SERVER" ]; then
  echo "ERROR: $PREVIEW_SERVER 不存在，请先同步脚本到 hk-vps" >&2
  exit 1
fi

# 启动 Node.js 静态文件 + API 代理服务
BRAIN_API="${BRAIN_API_URL:-http://localhost:5221}"
nohup node "$PREVIEW_SERVER" "$PORT" "$DEPLOY_DIR" "$BRAIN_API" \
  > "/tmp/preview-${PORT}.log" 2>&1 &
echo $! > "/tmp/preview-${PORT}.pid"
echo "$BRANCH_NAME" > "/tmp/preview-${PORT}.branch"

sleep 2

# 验证进程存活
if ! kill -0 "$(cat "/tmp/preview-${PORT}.pid")" 2>/dev/null; then
  echo "ERROR: preview-server 启动失败，查看日志 /tmp/preview-${PORT}.log" >&2
  cat "/tmp/preview-${PORT}.log" >&2
  exit 1
fi

echo "[preview-deploy] ✅ 预览服务已启动 port=$PORT pid=$(cat "/tmp/preview-${PORT}.pid") brain=$BRAIN_API"
echo "PREVIEW_URL=http://${HK_VPS_HOST:-localhost}:${PORT}"
