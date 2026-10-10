#!/bin/bash
set -e

# Cecelia Workflows 部署脚本
# 用法: ./deploy/deploy.sh hk

TARGET=${1:-hk}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 配置
case $TARGET in
  hk)
    HOST="hk"  # SSH config 中的别名
    REMOTE_PATH="/home/ubuntu/dev/cecelia-workflows"
    ;;
  *)
    echo "未知目标: $TARGET"
    echo "用法: $0 [hk]"
    exit 1
    ;;
esac

echo "========================================"
echo "部署 Cecelia Workflows 到 $TARGET"
echo "========================================"

# 1. 备份远端
echo ""
echo ">>> 备份远端现有版本..."
BACKUP_NAME="cecelia-workflows-$(date +%Y%m%d-%H%M%S)"
ssh $HOST "mkdir -p ~/backups && \
  if [ -d $REMOTE_PATH ]; then \
    tar -czf ~/backups/$BACKUP_NAME.tar.gz -C \$(dirname $REMOTE_PATH) \$(basename $REMOTE_PATH) 2>/dev/null || true; \
    echo '备份到: ~/backups/$BACKUP_NAME.tar.gz'; \
  fi"

# 2. 同步文件
echo ""
echo ">>> 同步文件到 $HOST:$REMOTE_PATH..."
ssh $HOST "mkdir -p $REMOTE_PATH"

# 同步 staff
rsync -avz --delete \
  "$PROJECT_ROOT/staff/" \
  "$HOST:$REMOTE_PATH/staff/"

# 同步 skills (如果存在)
if [ -d "$PROJECT_ROOT/skills" ]; then
  rsync -avz --delete \
    "$PROJECT_ROOT/skills/" \
    "$HOST:$REMOTE_PATH/skills/"
fi

# 同步 scripts
rsync -avz --delete \
  "$PROJECT_ROOT/scripts/" \
  "$HOST:$REMOTE_PATH/scripts/"

# 同步 n8n workflows JSON (不同步数据库)
if [ -d "$PROJECT_ROOT/n8n" ]; then
  rsync -avz --delete \
    --exclude='*.sqlite' \
    "$PROJECT_ROOT/n8n/" \
    "$HOST:$REMOTE_PATH/n8n/"
fi

# 3. 健康检查（AI Gateway 已删除：Claude Code 无头通道下线，任务 76a160b3）
echo ""
echo ">>> 健康检查..."
sleep 2

# 检查 N8N
if ssh $HOST "curl -sf http://localhost:5679/healthz > /dev/null 2>&1"; then
  echo "✅ N8N 正常"
else
  echo "⚠️  N8N 未运行（需要单独启动）"
fi

echo ""
echo "========================================"
echo "✅ 部署完成!"
echo "   目标: $HOST:$REMOTE_PATH"
echo "   备份: ~/backups/$BACKUP_NAME.tar.gz"
echo "========================================"
