# Deployment Guide - Cecelia Quality Platform MVP

完整的部署和使用指南。

---

## 前提条件

### 系统要求

- **OS**: Linux (Ubuntu 20.04+ recommended)
- **Node.js**: v18+ (已安装 ✅)
- **SQLite3**: 需要安装
- **Bash**: 4.0+ (已安装 ✅)
- **jq**: JSON 处理工具
- **curl**: HTTP 客户端

### 安装缺失的依赖

```bash
# 安装 SQLite3 (需要 root 权限)
sudo apt-get update
sudo apt-get install -y sqlite3

# 安装 jq (已安装)
which jq || sudo apt-get install -y jq

# 安装 curl (已安装)
which curl || sudo apt-get install -y curl
```

---

## 快速开始（5 分钟）

### Step 1: 安装依赖

```bash
cd /home/xx/dev/cecelia-quality

# 安装 Node.js 依赖（如果有）
npm install

# 确保所有脚本可执行
chmod +x gateway/*.sh
chmod +x worker/*.sh
chmod +x heartbeat/*.sh
chmod +x scripts/*.sh
chmod +x gateway/*.js
```

### Step 2: 初始化数据库

```bash
# 创建数据库
bash scripts/db-init.sh init

# 验证数据库
bash scripts/db-init.sh stats
```

### Step 3: 运行完整 Demo

```bash
# 一键运行完整演示
bash scripts/demo.sh
```

**这个脚本会自动完成**：
1. ✅ 初始化数据库
2. ✅ 启动 Gateway HTTP Server (后台)
3. ✅ 入队 3 个测试任务
4. ✅ 运行 Heartbeat 检查
5. ✅ Worker 执行第一个任务
6. ✅ 生成执行摘要和证据
7. ✅ 模拟 Notion 同步
8. ✅ 显示最终系统状态

---

## 手动运行（逐步）

### 1. 初始化数据库

```bash
# 初始化
bash scripts/db-init.sh init

# 查看统计
bash scripts/db-init.sh stats

# 查询数据
bash scripts/db-init.sh query "SELECT * FROM system_health;"

# 备份
bash scripts/db-init.sh backup
```

### 2. 启动 Gateway HTTP Server

```bash
# 前台运行（查看日志）
node gateway/gateway-http.js

# 或后台运行
nohup node gateway/gateway-http.js > /tmp/gateway-http.log 2>&1 &

# 查看日志
tail -f /tmp/gateway-http.log

# 测试健康检查
curl http://localhost:5680/health | jq .

# 查看队列状态
curl http://localhost:5680/status | jq .
```

### 3. 提交任务

**方式 1: CLI 模式（快速）**

```bash
# 提交 runQA 任务
bash gateway/gateway.sh add cloudcode runQA P0 '{
  "project": "cecelia-quality",
  "branch": "develop",
  "scope": "pr"
}'

# 提交 fixBug 任务
bash gateway/gateway.sh add notion fixBug P1 '{
  "project": "zenithjoy-engine",
  "branch": "fix/auth-bug",
  "issue": "#123"
}'

# 查看队列
bash gateway/gateway.sh status
```

**方式 2: HTTP API（程序化）**

```bash
# 提交任务（简化格式）
curl -X POST http://localhost:5680/add \
  -H "Content-Type: application/json" \
  -d '{
    "source": "cloudcode",
    "intent": "runQA",
    "priority": "P0",
    "payload": {
      "project": "cecelia-quality",
      "branch": "develop"
    }
  }' | jq .

# 提交任务（完整格式）
curl -X POST http://localhost:5680/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "550e8400-e29b-41d4-a716-446655440000",
    "source": "cloudcode",
    "intent": "runQA",
    "priority": "P0",
    "payload": {
      "project": "cecelia-quality"
    },
    "createdAt": "2026-01-27T10:00:00Z"
  }' | jq .

# 查看队列状态
curl http://localhost:5680/status | jq .
```

### 4. Worker 执行

```bash
# 执行一个任务
bash worker/worker.sh

# 查看执行日志
ls -lh runs/

# 查看最近的执行结果
LATEST_RUN=$(ls -t runs/ | head -1)
cat runs/$LATEST_RUN/task.json | jq .
cat runs/$LATEST_RUN/result.json | jq .

# 查看证据
ls -lh runs/$LATEST_RUN/evidence/
```

### 5. Heartbeat 监控

```bash
# 手动运行一次
bash heartbeat/heartbeat.sh

# 设置定时任务（每 5 分钟）
crontab -e
# 添加：
# */5 * * * * cd /home/xx/dev/cecelia-quality && bash heartbeat/heartbeat.sh >> /tmp/heartbeat.log 2>&1
```

### 6. Notion 同步

```bash
# 设置环境变量
export NOTION_TOKEN='secret_xxx'
export NOTION_STATE_DB_ID='database-id-1'
export NOTION_RUNS_DB_ID='database-id-2'

# 运行同步
bash scripts/notion-sync.sh
```

**如何获取 Notion 配置**：

1. 创建 Notion Integration: https://www.notion.so/my-integrations
2. 获取 `NOTION_TOKEN`
3. 创建两个数据库：
   - **System State** (字段: Name, Health, Queue Length, Inbox, Todo, Doing, Blocked, Done, Failed (24h), Last Heartbeat)
   - **System Runs** (字段: Name, Run ID, Task ID, Status, Intent, Project, Duration (s), Started At, Completed At)
4. 分享数据库给你的 Integration
5. 复制数据库 ID (URL 中的一部分)

### 7. 查询系统状态

```bash
# 数据库查询
bash scripts/db-api.sh system:health | jq .
bash scripts/db-api.sh tasks:active | jq .

# 队列状态
bash gateway/gateway.sh status

# State 文件
cat state/state.json | jq .

# 最近执行
ls -lht runs/ | head -10
```

---

## 常见任务

### 创建并执行 QA 任务

```bash
# 1. 入队
bash gateway/gateway.sh add cloudcode runQA P0 '{
  "project": "cecelia-quality",
  "branch": "develop",
  "scope": "pr"
}'

# 2. 执行
bash worker/worker.sh

# 3. 查看结果
LATEST_RUN=$(ls -t runs/ | head -1)
cat runs/$LATEST_RUN/evidence/QA-DECISION.md
```

### 批量处理队列

```bash
# 持续处理直到队列为空
while [[ $(wc -l < queue/queue.jsonl) -gt 0 ]]; do
  bash worker/worker.sh
  sleep 5
done
```

### 清理旧数据

```bash
# 清理 30 天前的 runs
find runs/ -type d -mtime +30 -exec rm -rf {} \;

# 清理已完成的任务（数据库）
bash scripts/db-init.sh query "DELETE FROM tasks WHERE status = 'done' AND completed_at < datetime('now', '-30 days');"

# 备份数据库
bash scripts/db-init.sh backup
```

---

## 集成到现有项目

### 集成到 N8N

**创建 Webhook Workflow**:

```json
{
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "cecelia-task",
        "method": "POST"
      }
    },
    {
      "name": "Call Gateway",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://localhost:5680/add",
        "method": "POST",
        "body": "={{$json}}"
      }
    }
  ]
}
```

### 集成到 Notion

**Notion Database → Cecelia**:

1. 创建 Notion Database（字段：Title, Status, Priority, Project, Branch）
2. N8N Workflow 每 5 分钟轮询 Notion
3. 发现 `Status = 待执行` 的任务 → 调用 Gateway API
4. Worker 执行完成 → 更新 Notion Status

### 集成到 GitHub Actions

```yaml
# .github/workflows/quality-check.yml
name: Quality Check

on:
  pull_request:
    branches: [main, develop]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Trigger Quality Check
        run: |
          curl -X POST http://your-vps:5680/add \
            -H "Content-Type: application/json" \
            -d '{
              "source": "github",
              "intent": "runQA",
              "priority": "P0",
              "payload": {
                "project": "${{ github.repository }}",
                "branch": "${{ github.head_ref }}",
                "pr_url": "${{ github.event.pull_request.html_url }}"
              }
            }'

      - name: Wait for Result
        run: |
          # Poll for result
          sleep 60
```

---

## 故障排查

### Gateway HTTP 无法启动

```bash
# 检查端口占用
lsof -i :5680

# 检查日志
tail -f /tmp/gateway-http.log

# 重启
pkill -f gateway-http.js
nohup node gateway/gateway-http.js > /tmp/gateway-http.log 2>&1 &
```

### Worker 执行失败

```bash
# 查看 Worker 日志
ls -lht runs/
LATEST_RUN=$(ls -t runs/ | head -1)
cat runs/$LATEST_RUN/worker.log

# 查看任务详情
cat runs/$LATEST_RUN/task.json | jq .

# 手动重试
bash worker/worker.sh
```

### 数据库损坏

```bash
# 检查数据库
sqlite3 db/cecelia.db "PRAGMA integrity_check;"

# 从备份恢复
bash scripts/db-init.sh restore db/backups/cecelia_20260127_*.db

# 重建数据库
bash scripts/db-init.sh reset
```

### Notion 同步失败

```bash
# 检查环境变量
echo $NOTION_TOKEN
echo $NOTION_STATE_DB_ID
echo $NOTION_RUNS_DB_ID

# 测试 API 连接
curl -s https://api.notion.com/v1/databases/$NOTION_STATE_DB_ID \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" | jq .

# 查看同步日志
bash scripts/notion-sync.sh
```

---

## 性能优化

### Worker 并发

```bash
# 启动多个 Worker (需要修改 worker.sh 支持并发锁)
for i in {1..3}; do
  bash worker/worker.sh &
done
```

### 数据库索引

```bash
# 已在 schema.sql 中定义，检查索引
bash scripts/db-init.sh query "SELECT name FROM sqlite_master WHERE type='index';"
```

### 清理策略

```bash
# 定期清理（通过 cron）
0 2 * * * cd /home/xx/dev/cecelia-quality && bash scripts/cleanup.sh
```

---

## 安全建议

1. **限制 Gateway HTTP 访问**:
   ```bash
   # 只监听 localhost
   export GATEWAY_HOST=127.0.0.1
   ```

2. **使用反向代理**:
   ```nginx
   # Nginx 配置
   location /cecelia/ {
     proxy_pass http://127.0.0.1:5680/;
     proxy_set_header Host $host;
     # 添加认证
     auth_basic "Restricted";
     auth_basic_user_file /etc/nginx/.htpasswd;
   }
   ```

3. **环境变量保护**:
   ```bash
   # 不要在代码中硬编码 token
   # 使用 .env 文件（不要提交到 Git）
   echo "NOTION_TOKEN=secret_xxx" >> ~/.bashrc
   source ~/.bashrc
   ```

---

## 监控和告警

### Prometheus Metrics（未来）

```bash
# 暴露 metrics 端点
curl http://localhost:5680/metrics
```

### 日志聚合

```bash
# 使用 rsyslog 或 journald
journalctl -u cecelia-gateway -f
```

### 告警规则

```bash
# Heartbeat 检测异常时发送通知
# 修改 heartbeat/heartbeat.sh 添加：
if [[ $failed_24h -gt 5 ]]; then
  curl -X POST https://hooks.slack.com/... \
    -d '{"text":"Cecelia: High failure rate!"}'
fi
```

---

## 下一步

- [ ] 实现 Worker 并发控制
- [ ] 添加 CloudCode 无头模式集成
- [ ] 实现重试逻辑
- [ ] 添加更多 Intent Executors
- [ ] Dashboard Web UI
- [ ] Prometheus Metrics
- [ ] 插件系统（Plugin Architecture）

---

**版本**: 1.0.0
**最后更新**: 2026-01-27

**支持**: https://github.com/zenjoymedia/cecelia-quality/issues
