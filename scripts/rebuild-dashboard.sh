#!/bin/bash
# rebuild-dashboard.sh — 重建 Dashboard 静态资源
# 用法：bash scripts/rebuild-dashboard.sh
# 在 git pull 或合并新代码后运行，更新 apps/dashboard/dist

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/apps/dashboard/dist"

echo "[rebuild-dashboard] 开始重建 Dashboard..."
echo "[rebuild-dashboard] 仓库根目录: $REPO_ROOT"

# 先拉取最新代码（可选，传 --pull 参数启用）
if [[ "$1" == "--pull" ]]; then
  echo "[rebuild-dashboard] 拉取最新代码..."
  cd "$REPO_ROOT"
  git pull origin main
fi

# 安装依赖（如有变化）
echo "[rebuild-dashboard] 检查依赖..."
cd "$REPO_ROOT"
npm install --prefer-offline --silent 2>/dev/null || npm install --silent

# 重建
echo "[rebuild-dashboard] 编译 Dashboard..."
npm run build --workspace=apps/dashboard

echo "[rebuild-dashboard] ✅ 重建完成"
echo "[rebuild-dashboard] dist 位置: $DIST_DIR"
echo "[rebuild-dashboard] 构建时间: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
