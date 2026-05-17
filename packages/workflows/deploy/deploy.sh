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

# 1. 本地测试
echo ""
echo ">>> 本地健康检查..."
if ! curl -sf http://localhost:9876/health > /dev/null 2>&1; then
  echo "⚠️  本地 AI Gateway 未运行，跳过本地测试"
else
  echo "✅ 本地 AI Gateway 正常"
fi

# 2. 备份远端
echo ""
echo ">>> 备份远端现有版本..."
BACKUP_NAME="cecelia-workflows-$(date +%Y%m%d-%H%M%S)"
ssh $HOST "mkdir -p ~/backups && \
  if [ -d $REMOTE_PATH ]; then \
    tar -czf ~/backups/$BACKUP_NAME.tar.gz -C \$(dirname $REMOTE_PATH) \$(basename $REMOTE_PATH) 2>/dev/null || true; \
    echo '备份到: ~/backups/$BACKUP_NAME.tar.gz'; \
  fi"

# 3. 同步文件
echo ""
echo ">>> 同步文件到 $HOST:$REMOTE_PATH..."
ssh $HOST "mkdir -p $REMOTE_PATH"

# 同步 gateway
rsync -avz --delete \
  "$PROJECT_ROOT/gateway/" \
  "$HOST:$REMOTE_PATH/gateway/"

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

# 4. 重启 AI Gateway
echo ""
echo ">>> 重启 AI Gateway..."
ssh $HOST "
  # 停止旧进程
  pkill -f 'node.*ai-gateway' 2>/dev/null || true
  sleep 1

  # 读取 MiniMax API Key
  MINIMAX_API_KEY=\$(cat ~/.credentials/minimax.json | python3 -c \"import sys,json; print(json.load(sys.stdin)['api_key'])\" 2>/dev/null || echo '')

  # 启动新进程
  cd $REMOTE_PATH/gateway
  AI_MODE=minimax MINIMAX_API_KEY=\$MINIMAX_API_KEY nohup node ai-gateway.cjs > /tmp/ai-gateway.log 2>&1 &

  sleep 2
  echo '已重启 AI Gateway'
"

# 5. 健康检查
echo ""
echo ">>> 健康检查..."
sleep 2

# 检查 AI Gateway
if ssh $HOST "curl -sf http://localhost:9876/health > /dev/null 2>&1"; then
  echo "✅ AI Gateway 正常"
  ssh $HOST "curl -s http://localhost:9876/health"
else
  echo "⚠️  AI Gateway 健康检查失败"
  echo "   检查日志: ssh $HOST 'tail -50 /tmp/ai-gateway.log'"
fi

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
