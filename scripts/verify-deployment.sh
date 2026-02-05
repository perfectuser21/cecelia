#!/bin/bash
# Cecelia Docker 部署验证脚本

set -euo pipefail

echo "=== Cecelia Docker 部署验证 ==="
echo

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# 检查函数
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        FAILED=$((FAILED + 1))
    fi
}

# 1. 检查配置文件
echo "1. 检查配置文件"
test -f .env.docker
check ".env.docker 存在"

grep -q "DB_PASSWORD=" .env.docker
check "数据库密码已配置"

grep -q "OPENAI_API_KEY=" .env.docker
check "OpenAI API Key 已配置"

# 2. 检查 Docker 服务
echo
echo "2. 检查 Docker 服务"
docker compose ps | grep -q "cecelia-semantic-brain"
check "semantic-brain 容器存在"

docker compose ps | grep -q "cecelia-node-brain"
check "node-brain 容器存在"

docker compose ps | grep "cecelia-semantic-brain" | grep -q "Up"
check "semantic-brain 运行中"

docker compose ps | grep "cecelia-node-brain" | grep -q "Up"
check "node-brain 运行中"

# 3. 健康检查
echo
echo "3. 健康检查"
curl -sf http://localhost:5220/health > /dev/null
check "semantic-brain 健康检查通过 (5220/health)"

curl -sf http://localhost:5221/api/brain/tick/status > /dev/null
check "node-brain 健康检查通过 (5221/api/brain/tick/status)"

# 4. Tick 循环状态
echo
echo "4. Tick 循环状态"
TICK_STATUS=$(curl -s http://localhost:5221/api/brain/tick/status)

echo "$TICK_STATUS" | jq -e '.enabled == true' > /dev/null
check "Tick 循环已启用"

echo "$TICK_STATUS" | jq -e '.loop_running == true' > /dev/null
check "Tick 循环正在运行"

MAX_CONCURRENT=$(echo "$TICK_STATUS" | jq -r '.max_concurrent')
if [ "$MAX_CONCURRENT" == "3" ]; then
    echo -e "${GREEN}✓${NC} 并发限制: $MAX_CONCURRENT"
else
    echo -e "${YELLOW}!${NC} 并发限制: $MAX_CONCURRENT (预期: 3)"
fi

# 5. Circuit Breaker 状态
echo
echo "5. Circuit Breaker 状态"
CB_STATUS=$(curl -s http://localhost:5221/api/brain/circuit-breaker)

echo "$CB_STATUS" | jq -e '.breakers["cecelia-run"].state == "CLOSED"' > /dev/null
check "Circuit Breaker 状态: CLOSED"

# 6. 数据库连接
echo
echo "6. 数据库连接"
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c "SELECT 1" > /dev/null 2>&1
check "PostgreSQL 连接成功"

TASK_COUNT=$(docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -t -c "SELECT COUNT(*) FROM tasks;")
echo -e "   任务表记录数: $TASK_COUNT"

# 7. 文件挂载
echo
echo "7. 文件挂载"
docker exec cecelia-node-brain test -d /home/xx/.claude
check "claude 目录已挂载"

docker exec cecelia-node-brain test -f /home/xx/bin/cecelia-run
check "cecelia-run 可执行文件已挂载"

docker exec cecelia-semantic-brain test -d /mnt/dev
check "dev 目录已挂载"

# 8. 日志配置
echo
echo "8. 日志配置"
docker inspect cecelia-node-brain | jq -e '.[0].HostConfig.LogConfig.Type == "json-file"' > /dev/null
check "日志驱动: json-file"

docker inspect cecelia-node-brain | jq -e '.[0].HostConfig.LogConfig.Config."max-size" == "10m"' > /dev/null
check "日志大小限制: 10MB"

docker inspect cecelia-node-brain | jq -e '.[0].HostConfig.LogConfig.Config."max-file" == "3"' > /dev/null
check "日志文件数: 3"

# 9. 重启策略
echo
echo "9. 重启策略"
docker inspect cecelia-node-brain | jq -e '.[0].HostConfig.RestartPolicy.Name == "unless-stopped"' > /dev/null
check "重启策略: unless-stopped"

docker inspect cecelia-semantic-brain | jq -e '.[0].HostConfig.RestartPolicy.Name == "unless-stopped"' > /dev/null
check "重启策略: unless-stopped"

# 总结
echo
echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ 所有检查通过！${NC}"
    echo "Cecelia Docker 部署验证成功"
    exit 0
else
    echo -e "${RED}✗ 发现 $FAILED 个问题${NC}"
    echo "请检查上述失败项"
    exit 1
fi
