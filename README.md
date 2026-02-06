# Cecelia Semantic Brain

Cecelia 的智能决策系统，包含语义搜索、代码监控、任务规划和自主执行能力。

## 快速开始

### 手动启动（默认方式）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env 填入真实凭据

# 2. 启动 Python Intelligence Service (5220)
python -m uvicorn src.api.main:app --host 0.0.0.0 --port 5220 &

# 3. 启动 Node Brain (5221)
cd brain && nohup node server.js > /tmp/brain.log 2>&1 &

# 4. 验证服务状态
curl http://localhost:5220/health
curl http://localhost:5221/api/brain/tick/status
```

### Docker 部署（可选方式）

Docker Compose 提供自动重启、健康检查、日志轮转等特性，适合生产环境。

```bash
# 1. 配置环境变量
cp .env.example .env.docker
# 编辑 .env.docker 填入真实凭据

# 2. 启动服务
docker compose up -d

# 3. 验证服务状态
docker compose ps

# 4. 查看日志
docker compose logs -f --tail=50
```

详细运维文档请参考 [DOCKER.md](./DOCKER.md)

## 服务架构

```
┌────────────────────────────────────┐
│  semantic-brain (5220)             │
│  - 语义搜索                        │
│  - 代码监控                        │
│  - Agent 监控                      │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  node-brain (5221)                 │
│  - 意图识别                        │
│  - 任务规划                        │
│  - Tick 循环 (每2分钟)             │
│  - 任务派发 (cecelia-run)          │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  PostgreSQL (5432)                 │
│  - 数据库: cecelia_tasks           │
└────────────────────────────────────┘
```

## 核心功能

### 1. 语义搜索 (semantic-brain)
- 向量数据库（Chroma）
- OpenAI Embeddings
- 代码语义检索

### 2. 决策中心 (node-brain)
- 意图识别：`POST /api/brain/intent/parse`
- 任务规划：`POST /api/brain/plan`
- 决策生成：`POST /api/brain/decide`
- Tick 循环：自动检测和派发任务

### 3. 自主执行
- 每 2 分钟自动检查任务队列
- 并发控制：最多 5 个任务
- 熔断保护：3 次失败 → 30 分钟冷却
- 超时控制：60 分钟自动 fail

## API 端点

### Intelligence Service (5220)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/v1/semantic/search` | POST | 语义搜索 |
| `/api/patrol/*` | * | 代码巡检 |
| `/api/agent/*` | * | Agent 监控 |

### Brain (5221)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/brain/status` | GET | 完整状态（LLM 决策包）|
| `/api/brain/tick/status` | GET | Tick 循环状态 |
| `/api/brain/intent/parse` | POST | 意图识别 |
| `/api/brain/plan` | POST | 任务规划 |
| `/api/brain/decide` | POST | 生成决策 |
| `/api/brain/circuit-breaker` | GET | 熔断器状态 |

完整 API 文档请参考 [docs/API.md](./docs/API.md)

## 环境变量

### 必需配置

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cecelia_tasks
DB_USER=n8n_user
DB_PASSWORD=<your-password>

# OpenAI
OPENAI_API_KEY=<your-api-key>

# Tick 配置
CECELIA_TICK_ENABLED=true
CECELIA_TICK_INTERVAL_MS=120000  # 2 分钟
MAX_CONCURRENT_TASKS=3
DISPATCH_TIMEOUT_MINUTES=60
```

凭据从 `~/.credentials/` 目录加载。

## 监控和运维

### 检查服务状态

```bash
# Docker 方式
docker compose ps
docker compose logs -f

# 手动方式
curl http://localhost:5220/health
curl http://localhost:5221/api/brain/tick/status
```

### 查看 Tick 循环状态

```bash
curl -s http://localhost:5221/api/brain/tick/status | jq '{enabled, loop_running, max_concurrent, circuit_breaker}'
```

### 重置熔断器

```bash
curl -X POST http://localhost:5221/api/brain/circuit-breaker/cecelia-run/reset
```

### 手动触发 Tick

```bash
curl -X POST http://localhost:5221/api/brain/tick
```

## 开发

### 目录结构

```
cecelia-semantic-brain/
├── src/              # Python Intelligence Service
│   ├── api/          # FastAPI 路由
│   ├── core/         # 核心功能（embedder, store, search）
│   ├── db/           # 数据库
│   └── state/        # 状态管理（patrol, agent_monitor）
├── brain/            # Node.js Brain
│   ├── src/          # 决策逻辑
│   │   ├── intent.js       # 意图识别
│   │   ├── planner.js      # 任务规划
│   │   ├── decision.js     # 决策引擎
│   │   ├── tick.js         # Tick 循环
│   │   └── executor.js     # 任务执行
│   └── server.js     # Express 服务器
├── docker-compose.yml      # 生产环境（默认）
├── docker-compose.dev.yml  # 开发环境（需 -f 指定）
├── Dockerfile          # Python 服务镜像
├── .env.docker         # 环境变量（包含凭据）
└── DOCKER.md           # Docker 运维手册
```

### 运行测试

```bash
# Brain 测试
cd brain && npm test

# Intelligence Service 测试
pytest
```

## 故障排查

### Circuit Breaker OPEN

```bash
# 1. 查看失败任务
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "SELECT id, title, status, updated_at FROM tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 5;"

# 2. 清理失败任务
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "UPDATE tasks SET status = 'cancelled' WHERE status = 'failed';"

# 3. 重置熔断器
curl -X POST http://localhost:5221/api/brain/circuit-breaker/cecelia-run/reset
```

### 服务无法启动

```bash
# 查看日志
docker compose logs semantic-brain
docker compose logs node-brain

# 验证数据库连接
docker exec social-metrics-postgres psql -U n8n_user -l
```

更多故障排查请参考 [DOCKER.md](./DOCKER.md#故障排查)

## 贡献

- **GitHub**: https://github.com/perfectuser21/cecelia-semantic-brain
- **文档**: /home/xx/dev/cecelia-semantic-brain/docs/

## 许可证

MIT
