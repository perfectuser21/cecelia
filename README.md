# Cecelia Core

Cecelia 的核心大脑系统，负责任务调度、决策、保护和自主执行。

## 快速开始

### 手动启动

```bash
# 1. 配置环境变量
cp .env.example .env.docker
# 编辑 .env.docker 填入真实凭据

# 2. 启动 Node Brain (5221)
cd brain && nohup node server.js > /tmp/brain.log 2>&1 &

# 3. 验证服务状态
curl http://localhost:5221/api/brain/tick/status
```

### Docker 部署（生产环境）

```bash
# 1. 配置环境变量
cp .env.example .env.docker

# 2. 构建并启动
bash scripts/brain-deploy.sh

# 3. 验证
docker compose ps
```

详细运维文档请参考 [DOCKER.md](./DOCKER.md)

## 服务架构

```
┌────────────────────────────────────┐
│  Node Brain (5221)                 │
│  - 三层大脑: L0 脑干 + L1 丘脑     │
│    + L2 皮层                       │
│  - Tick 循环 (5s loop / 5min exec) │
│  - 任务派发 (cecelia-run)          │
│  - 熔断/看门狗/隔离区              │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  PostgreSQL (5432)                 │
│  - 数据库: cecelia                 │
└────────────────────────────────────┘

```

## 核心功能

### Brain (Node.js, port 5221)

- **L0 脑干**: tick.js, executor.js, circuit-breaker.js — 纯代码调度
- **L1 丘脑**: thalamus.js (Sonnet) — 事件路由、快速判断
- **L2 皮层**: cortex.js (Opus) — 深度分析、RCA、战略调整
- **Tick 循环**: 5 秒检查一次，5 分钟执行一次
- **保护系统**: 警觉等级、熔断器、隔离区、看门狗

### API 端点 (Brain 5221)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/brain/status/full` | GET | 完整系统状态 |
| `/api/brain/health` | GET | 健康检查 |
| `/api/brain/tick/status` | GET | Tick 循环状态 |
| `/api/brain/tick` | POST | 手动触发 Tick |
| `/api/brain/intent/parse` | POST | 意图识别 |
| `/api/brain/decide` | POST | 生成决策 |
| `/api/brain/circuit-breaker` | GET | 熔断器状态 |
| `/api/brain/alertness` | GET | 警觉等级 |
| `/api/brain/quarantine` | GET | 隔离区任务 |
| `/api/brain/watchdog` | GET | 看门狗 RSS/CPU |

## 环境变量

### 必需配置 (.env.docker)

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cecelia
DB_USER=cecelia
DB_PASSWORD=<your-password>

# 区域
ENV_REGION=us

# Tick 配置
CECELIA_TICK_ENABLED=true
```

凭据从 `~/.credentials/` 目录加载。

## 目录结构

```
cecelia-core/
├── brain/              # Node.js Brain (port 5221)
│   ├── src/            # 决策逻辑
│   │   ├── tick.js           # Tick 循环
│   │   ├── executor.js       # 任务执行
│   │   ├── thalamus.js       # L1 丘脑
│   │   ├── cortex.js         # L2 皮层
│   │   ├── intent.js         # 意图识别
│   │   ├── planner.js        # 任务规划
│   │   ├── decision.js       # 决策引擎
│   │   ├── quarantine.js     # 隔离/分类
│   │   ├── alertness/         # 警觉等级
│   │   ├── watchdog.js       # 资源看门狗
│   │   └── circuit-breaker.js # 熔断器
│   ├── server.js       # Express 服务器
│   └── __tests__/      # Vitest 测试
├── tests/             # 集成测试 (database, frontend)
├── docker-compose.yml        # 生产环境
├── docker-compose.dev.yml    # 开发环境
├── brain/Dockerfile          # Brain 容器镜像
├── frontend-proxy.js         # 前端静态服务 + API 代理
└── DOCKER.md                 # Docker 运维手册
```

## 开发

```bash
# Brain 测试
cd brain && npx vitest run

# DevGate 检查
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
```

## 故障排查

```bash
# 查看 Tick 状态
curl -s http://localhost:5221/api/brain/tick/status | jq

# 重置熔断器
curl -X POST http://localhost:5221/api/brain/circuit-breaker/cecelia-run/reset

# 手动触发 Tick
curl -X POST http://localhost:5221/api/brain/tick
```
