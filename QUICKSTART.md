# Quick Start - Cecelia Quality Platform

**5 分钟快速上手指南**

---

## 前提条件

```bash
# 1. 安装 SQLite3 (需要 root 权限)
sudo apt-get update
sudo apt-get install -y sqlite3

# 2. 验证依赖
node --version   # v18+
jq --version     # 1.6+
sqlite3 --version # 3.x
```

---

## 一键运行 Demo

```bash
cd /home/xx/dev/cecelia-quality

# 运行完整演示（自动完成所有步骤）
bash scripts/demo.sh
```

**这个脚本会自动**：
1. ✅ 初始化 SQLite 数据库
2. ✅ 启动 Gateway HTTP 服务器（后台）
3. ✅ 入队 3 个测试任务（P0, P1, P2）
4. ✅ 运行 Heartbeat 健康检查
5. ✅ Worker 执行第一个任务
6. ✅ 生成执行摘要和证据
7. ✅ 模拟 Notion 同步
8. ✅ 显示最终系统状态

---

## 手动步骤（可选）

### Step 1: 初始化数据库

```bash
bash scripts/db-init.sh init
bash scripts/db-init.sh stats
```

### Step 2: 启动 Gateway HTTP

```bash
# 后台运行
nohup node gateway/gateway-http.js > /tmp/gateway-http.log 2>&1 &

# 测试
curl http://localhost:5680/health | jq .
```

### Step 3: 提交任务

```bash
# CLI 模式
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'

# HTTP 模式
curl -X POST http://localhost:5680/add \
  -H "Content-Type: application/json" \
  -d '{"source":"cloudcode","intent":"runQA","priority":"P0","payload":{"project":"cecelia-quality"}}'
```

### Step 4: 查看队列

```bash
bash gateway/gateway.sh status
curl http://localhost:5680/status | jq .
```

### Step 5: Worker 执行

```bash
bash worker/worker.sh
```

### Step 6: 查看结果

```bash
# 查看运行记录
ls -lh runs/

# 查看最新执行
LATEST_RUN=$(ls -t runs/ | head -1)
cat runs/$LATEST_RUN/summary.json | jq .
cat runs/$LATEST_RUN/evidence/QA-DECISION.md

# 查询数据库
bash scripts/db-api.sh system:health | jq .
bash scripts/db-api.sh tasks:active | jq .
```

### Step 7: Heartbeat（可选）

```bash
bash heartbeat/heartbeat.sh
```

### Step 8: Notion 同步（可选）

```bash
# 设置环境变量
export NOTION_TOKEN='secret_xxx'
export NOTION_STATE_DB_ID='database-id-1'
export NOTION_RUNS_DB_ID='database-id-2'

# 运行同步
bash scripts/notion-sync.sh
```

---

## 常用命令

### 提交任务

```bash
# runQA
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'

# fixBug
bash gateway/gateway.sh add notion fixBug P1 '{"project":"zenithjoy-engine","issue":"#123"}'

# optimizeSelf
bash gateway/gateway.sh add heartbeat optimizeSelf P2 '{"reason":"scheduled_check"}'
```

### 查询状态

```bash
# Queue
bash gateway/gateway.sh status

# Database
bash scripts/db-api.sh system:health
bash scripts/db-api.sh tasks:active

# State file
cat state/state.json | jq .
```

### 管理服务

```bash
# 启动 Gateway HTTP
nohup node gateway/gateway-http.js > /tmp/gateway-http.log 2>&1 &

# 停止 Gateway HTTP
pkill -f gateway-http.js

# 查看日志
tail -f /tmp/gateway-http.log
```

### 数据库管理

```bash
# 统计
bash scripts/db-init.sh stats

# 查询
bash scripts/db-init.sh query "SELECT * FROM system_health;"

# 备份
bash scripts/db-init.sh backup

# 恢复
bash scripts/db-init.sh restore db/backups/cecelia_*.db
```

---

## API 端点

### Gateway HTTP API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/status` | GET | 队列状态 |
| `/enqueue` | POST | 入队任务（完整格式） |
| `/add` | POST | 入队任务（简化格式） |

**示例**:

```bash
# 健康检查
curl http://localhost:5680/health | jq .

# 队列状态
curl http://localhost:5680/status | jq .

# 提交任务
curl -X POST http://localhost:5680/add \
  -H "Content-Type: application/json" \
  -d '{
    "source": "cloudcode",
    "intent": "runQA",
    "priority": "P0",
    "payload": {
      "project": "cecelia-quality"
    }
  }' | jq .
```

---

## 目录结构

```
cecelia-quality/
├── db/                    # SQLite 数据库
├── gateway/               # 统一入口（HTTP + CLI）
├── queue/                 # 任务队列
├── worker/                # 工作器
├── state/                 # 系统状态
├── heartbeat/             # 健康检查
├── runs/                  # 执行记录 + 证据
├── orchestrator/          # QA 编排器
├── control-plane/         # 配置管理
├── contracts/             # 质量契约
├── scripts/               # 执行脚本
├── hooks/                 # Claude Code Hooks
├── skills/                # Claude Code Skills
├── docs/                  # 文档
└── tests/                 # 测试
```

---

## 下一步

- [ ] 配置 Notion 同步
- [ ] 设置 Heartbeat Cron（每 5 分钟）
- [ ] 集成到 N8N Workflow
- [ ] 创建 GitHub Actions Workflow

---

## 文档

- **完整总结**: `MVP_SUMMARY.md`
- **部署指南**: `DEPLOYMENT.md`
- **目录结构**: `docs/DIRECTORY_STRUCTURE.md`
- **状态机**: `docs/STATE_MACHINE.md`
- **QA 集成**: `docs/QA_INTEGRATION.md`
- **文件格式**: `docs/FILE_FORMATS.md`

---

## 支持

- **GitHub**: https://github.com/zenjoymedia/cecelia-quality
- **Issues**: https://github.com/zenjoymedia/cecelia-quality/issues

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
