#!/usr/bin/env bash
# deploy-hk.sh — 部署 Cecelia 前端到香港 VPS
#
# 规则：必须 PR → CI → 合并后才能部署。不允许直接改直接推。
#
# 用法: ./deploy/deploy-hk.sh

set -euo pipefail

REMOTE="hk"
REMOTE_DIR="/opt/cecelia/frontend"
FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)/apps/dashboard"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Cecelia 前端 → HK 部署 ==="
echo ""

# ── 1. Git 安全检查 ──────────────────────────────────

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 必须在 develop 或 main 上部署
if [[ "$BRANCH" != "develop" && "$BRANCH" != "main" ]]; then
    echo "❌ 当前分支: $BRANCH"
    echo "   只能从 develop 或 main 部署。先合并 PR 再来。"
    exit 1
fi

# 不允许有未提交的改动
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "❌ 有未提交的改动。先 commit 并走 PR。"
    exit 1
fi

# 本地必须与远端同步
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "unknown")

if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
    echo "❌ 本地与远端不同步"
    echo "   本地: $LOCAL_SHA"
    echo "   远端: $REMOTE_SHA"
    echo "   先 git pull 或先推到远端。"
    exit 1
fi

echo "✅ Git 检查通过 (分支: $BRANCH, SHA: ${LOCAL_SHA:0:8})"

# ── 2. 构建前端 ──────────────────────────────────────

echo ""
echo "📦 构建前端..."

if [[ ! -d "$FRONTEND_DIR" ]]; then
    echo "❌ 前端目录不存在: $FRONTEND_DIR"
    exit 1
fi

(cd "$FRONTEND_DIR" && npx vite build)
DIST_DIR="$FRONTEND_DIR/dist"

if [[ ! -d "$DIST_DIR" ]]; then
    echo "❌ 构建产物不存在: $DIST_DIR"
    exit 1
fi

echo "✅ 构建完成"

# ── 3. 同步到 HK ────────────────────────────────────

echo ""
echo "🚀 同步到 HK ($REMOTE:$REMOTE_DIR)..."

# 确保远端目录存在
ssh "$REMOTE" "mkdir -p $REMOTE_DIR"

# 同步 dist
rsync -avz --delete "$DIST_DIR/" "$REMOTE:$REMOTE_DIR/dist/"

# 同步 nginx 配置和 docker-compose
rsync -avz "$DEPLOY_DIR/nginx.conf" "$REMOTE:$REMOTE_DIR/nginx.conf"
rsync -avz "$DEPLOY_DIR/nginx-core.conf" "$REMOTE:$REMOTE_DIR/nginx-core.conf"
rsync -avz "$DEPLOY_DIR/docker-compose.hk.yml" "$REMOTE:$REMOTE_DIR/docker-compose.yml"

echo "✅ 文件同步完成"

# ── 4. 重启服务 ──────────────────────────────────────

echo ""
echo "🔄 检查端口冲突..."

# 停止占用 5211 的旧容器
EXISTING=$(ssh "$REMOTE" "docker ps --format '{{.Names}}' --filter publish=5211" 2>/dev/null || echo "")
if [[ -n "$EXISTING" && "$EXISTING" != "cecelia-core-hk" ]]; then
    echo "⚠️  端口 5211 被 $EXISTING 占用，停止旧容器..."
    ssh "$REMOTE" "docker stop $EXISTING"
fi

echo "🔄 启动 HK 容器..."

ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d --force-recreate"

# ── 5. 健康检查 ──────────────────────────────────────

echo ""
echo "🏥 健康检查..."
sleep 3

HEALTH_OK=true

if ssh "$REMOTE" "curl -sf http://localhost:5211 > /dev/null 2>&1"; then
    echo "✅ 前端 (5211) 健康检查通过"
else
    echo "⚠️  前端 (5211) 健康检查失败，容器可能还在启动"
    HEALTH_OK=false
fi

# ── 6. 完成 ──────────────────────────────────────────

echo ""
echo "=== 部署完成 ==="
echo "  分支: $BRANCH"
echo "  Commit: ${LOCAL_SHA:0:8}"
echo "  目标: $REMOTE:$REMOTE_DIR"
echo ""
echo "  前端: https://core.zenjoymedia.media (HK:5211)"
