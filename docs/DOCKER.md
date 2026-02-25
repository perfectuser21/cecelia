# Cecelia Core Docker 运维手册

> Docker Compose 用于生产环境，提供自动重启、健康检查和日志轮转。
> 开发环境推荐使用 `docker-compose.dev.yml`（bind mount hot-reload）。

## 快速开始

### 首次部署

```bash
# 自动化部署（推荐）
bash scripts/brain-deploy.sh

# 或手动部署
docker compose build
docker compose up -d
docker compose ps
```

### 日常操作

```bash
# 查看服务状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 查看 Brain 日志
docker compose logs -f node-brain

# 重启 Brain
docker compose restart node-brain

# 停止所有服务
docker compose down
```

## 服务架构

```
┌────────────────────────────────────┐
│  node-brain (5221)                 │
│  - Brain 决策中心                   │
│  - Tick 循环                       │
│  - 任务派发                        │
│  - 镜像: cecelia-brain:<version>   │
└────────────────────────────────────┘
              ↓ depends_on
┌────────────────────────────────────┐
│  frontend (5212)                   │
│  - 静态文件服务                    │
│  - API 代理 → localhost:5211       │
│  - 使用 frontend-proxy.js          │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  PostgreSQL (5432)                 │
│  - 数据库: cecelia                 │
│  - 外部容器（非本 compose 管理）    │
└────────────────────────────────────┘
```

## 健康检查

### node-brain
- **端点**: `GET /api/brain/tick/status`
- **间隔**: 30s
- **超时**: 10s
- **重试**: 3 次
- **启动等待**: 40s

## 环境变量 (.env.docker)

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cecelia
DB_USER=cecelia
DB_PASSWORD=<从 ~/.credentials/database.env 获取>

# 区域
ENV_REGION=us

# Tick 配置
CECELIA_TICK_ENABLED=true
```

## 日志管理

- **驱动**: json-file
- **单文件大小**: 10MB
- **保留文件数**: 3
- **总容量**: 最多 30MB/服务

```bash
# 实时日志
docker compose logs -f

# 最近 100 行
docker compose logs --tail=100

# 特定时间段
docker compose logs --since 30m
```

## 故障排查

### Brain 无法启动

```bash
# 检查日志
docker compose logs node-brain

# 手动测试健康端点
curl -f http://localhost:5221/api/brain/tick/status

# 查看容器内部
docker exec -it cecelia-node-brain sh
```

### Circuit Breaker OPEN

```bash
# 查看熔断器状态
curl -s http://localhost:5221/api/brain/circuit-breaker | jq .

# 重置熔断器
curl -X POST http://localhost:5221/api/brain/circuit-breaker/cecelia-run/reset
```

### 数据库连接问题

```bash
# 验证连接
docker exec social-metrics-postgres psql -U cecelia -d cecelia -c "SELECT 1"
```

## 升级流程

```bash
# 使用部署脚本（自动 build → migrate → selfcheck → test → start）
bash scripts/brain-deploy.sh

# 或手动升级
docker compose down
git pull origin develop
docker compose build --no-cache
docker compose up -d
docker compose ps
```

## 回滚

```bash
# 停止 Docker
docker compose down

# 手动启动 Brain（临时）
cd brain && nohup node server.js > /tmp/brain.log 2>&1 &
```

## 监控指标

| 指标 | 警告 | 严重 |
|------|------|------|
| CPU | > 70% | > 90% |
| 内存 | > 3GB | > 4GB |
| 磁盘 | > 80% | > 95% |
| queued 任务 | > 50 | > 100 |
| Circuit Breaker | - | OPEN |

```bash
# 实时资源监控
docker stats cecelia-node-brain

# Tick 循环状态
curl -s http://localhost:5221/api/brain/tick/status | jq

# 手动触发 Tick
curl -X POST http://localhost:5221/api/brain/tick
```

## 安全注意事项

1. **.env.docker 权限**: 必须 600（仅所有者可读写）
2. **凭据管理**: 从 `~/.credentials/` 加载，不提交到 Git
3. **网络模式**: 使用 host 模式访问本地 PostgreSQL
