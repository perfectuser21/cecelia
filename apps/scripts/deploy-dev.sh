#!/bin/bash
# DEPRECATED: 此脚本用于部署到 5212 dev 环境，5212 容器已于 2026-02-23 永久删除。
# 当前工作流：直接 `npm run build` → 刷新 perfect21:5211 即可。
# 保留此文件仅作历史参考，勿使用。
#
# 原始功能：把当前分支部署到 dev 环境 (5212) 进行测试
# Usage: ./deploy-dev.sh

set -e

REPO_DIR="/home/xx/dev/zenithjoy-autopilot"
FRONTEND_DIR="$REPO_DIR/apps/dashboard/frontend"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

cd "$FRONTEND_DIR"

echo "🔨 Building $BRANCH → dev environment (5212)..."

npm run build

rm -rf "$FRONTEND_DIR/dist-dev"
cp -r "$FRONTEND_DIR/dist" "$FRONTEND_DIR/dist-dev"

docker restart zenithjoy-core-dev

echo ""
echo "✅ Done! Test at:"
echo "   • http://localhost:5212"
echo "   • https://dev-autopilot.zenjoymedia.media"
