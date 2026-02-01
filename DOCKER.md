# Cecelia Docker 运维手册（可选部署方式）

> **注意**：Docker Compose 是**可选的**部署方式，主要用于生产环境提供自动重启、健康检查和日志轮转功能。
> 开发环境推荐使用手动启动方式（参考 [README.md](./README.md)）。

## 快速开始

### 首次部署

```bash
# 1. 确保 .env.docker 文件存在且包含凭据
test -f .env.docker || echo "❌ .env.docker 缺失"

# 2. 构建镜像
docker compose build

# 3. 启动服务
docker compose up -d

# 4. 验证健康状态
docker compose ps

# 5. 查看日志
docker compose logs -f --tail=50
```

### 日常操作

```bash
# 查看服务状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f node-brain
docker compose logs -f semantic-brain

# 重启服务
docker compose restart node-brain
docker compose restart semantic-brain

# 停止所有服务
docker compose down

# 完全清理（包括数据卷）
docker compose down -v
```

## 服务架构

```
┌────────────────────────────────────┐
│  semantic-brain (5220)             │
│  - Python Intelligence Service     │
│  - 语义搜索                        │
│  - 代码监控                        │
│  - Realtime API                    │
└────────────────────────────────────┘
              ↓ depends_on
┌────────────────────────────────────┐
│  node-brain (5221)                 │
│  - 决策中心                        │
│  - Tick 循环 (每2分钟)             │
│  - 任务派发                        │
│  - Circuit Breaker                 │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  PostgreSQL (5432)                 │
│  - 容器名: social-metrics-postgres │
│  - 数据库: cecelia_tasks           │
└────────────────────────────────────┘
```

## 健康检查

### semantic-brain
- **端点**: `GET /health`
- **间隔**: 30s
- **超时**: 10s
- **重试**: 3 次
- **启动等待**: 40s

### node-brain
- **端点**: `GET /api/brain/tick/status`
- **间隔**: 30s
- **超时**: 10s
- **重试**: 3 次
- **启动等待**: 40s

## 文件挂载

| 主机路径 | 容器路径 | 权限 | 用途 |
|---------|---------|------|------|
| `/home/xx/dev` | `/mnt/dev` | ro | 代码库访问 |
| `/home/xx/.claude` | `/home/xx/.claude` | ro | Skills 访问 |
| `/home/xx/bin` | `/home/xx/bin` | ro | cecelia-run 可执行文件 |
| `./data/chroma` | `/data/chroma` | rw | 向量数据库持久化 |
| `./logs` | `/app/logs` | rw | 日志目录 |
| `./brain` | `/app` | rw | Node Brain 代码 |

## 环境变量

### 必需变量（.env.docker）

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cecelia_tasks
DB_USER=n8n_user
DB_PASSWORD=<从 ~/.credentials/database.env 获取>

# OpenAI
OPENAI_API_KEY=<从 ~/.credentials/openai.env 获取>

# Tick 配置
CECELIA_TICK_ENABLED=true
CECELIA_TICK_INTERVAL_MS=120000
MAX_CONCURRENT_TASKS=3
DISPATCH_TIMEOUT_MINUTES=60
```

## 日志管理

### 配置
- **驱动**: json-file
- **单文件大小**: 10MB
- **保留文件数**: 3 个
- **总容量**: 最多 30MB/服务

### 查看日志

```bash
# 实时日志（所有服务）
docker compose logs -f

# 最近 100 行
docker compose logs --tail=100

# 特定时间段
docker compose logs --since 30m

# 导出日志到文件
docker compose logs > cecelia-logs-$(date +%Y%m%d).log
```

## 故障排查

### 服务无法启动

```bash
# 1. 检查日志
docker compose logs semantic-brain
docker compose logs node-brain

# 2. 检查健康状态
docker compose ps

# 3. 检查环境变量
docker compose config

# 4. 验证数据库连接
docker exec cecelia-node-brain sh -c "curl -f http://localhost:5221/api/brain/tick/status"
```

### 健康检查失败

```bash
# 手动测试健康端点
curl -f http://localhost:5220/health
curl -f http://localhost:5221/api/brain/tick/status

# 查看容器内部
docker exec -it cecelia-node-brain sh
docker exec -it cecelia-semantic-brain bash
```

### Circuit Breaker OPEN

```bash
# 1. 查看熔断器状态
curl -s http://localhost:5221/api/brain/circuit-breaker | jq .

# 2. 查看最近失败任务
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "SELECT id, title, status, updated_at FROM tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 5;"

# 3. 重置熔断器
curl -X POST http://localhost:5221/api/brain/circuit-breaker/cecelia-run/reset

# 4. 清理僵尸进程
docker exec cecelia-node-brain pkill -f "claude -p"
```

### 磁盘空间不足

```bash
# 清理旧日志
docker compose down
rm -rf logs/*.log*

# 清理 Docker 垃圾
docker system prune -a

# 清理旧镜像
docker image prune -a
```

## 性能监控

### 资源使用

```bash
# 实时监控
docker stats cecelia-node-brain cecelia-semantic-brain

# CPU 和内存
docker compose top

# 磁盘使用
du -sh data/chroma logs/
```

### 基准指标

| 指标 | 空闲时 | 3任务并发 |
|------|--------|-----------|
| CPU | < 10% | < 50% |
| 内存 | < 500MB | < 2GB |
| 磁盘 I/O | 最小 | 中等 |

## 升级流程

```bash
# 1. 备份数据
docker compose down
tar -czf backup-$(date +%Y%m%d).tar.gz data/ logs/ .env.docker

# 2. 拉取最新代码
git pull origin develop

# 3. 重新构建镜像
docker compose build --no-cache

# 4. 启动服务
docker compose up -d

# 5. 验证
docker compose ps
docker compose logs -f --tail=50
```

## 回滚流程

```bash
# 1. 停止 Docker
docker compose down

# 2. 恢复手动启动（临时）
cd brain
nohup node server.js > /tmp/brain.log 2>&1 &

cd ..
nohup python -m uvicorn src.api.main:app --host 0.0.0.0 --port 5220 > /tmp/intelligence.log 2>&1 &

# 3. 验证
curl http://localhost:5221/api/brain/tick/status
curl http://localhost:5220/health
```

## 自动重启验证

### 测试场景 1: 容器崩溃

```bash
# 1. Kill 容器
docker kill cecelia-node-brain

# 2. 等待 10 秒
sleep 10

# 3. 验证自动重启
docker compose ps | grep node-brain
# 应该显示 "Up" 状态
```

### 测试场景 2: 健康检查失败

```bash
# 1. 模拟服务假死（占用端口但不响应）
docker exec cecelia-node-brain pkill node

# 2. 等待 3 个健康检查周期（90秒）
sleep 90

# 3. 验证自动重启
docker compose logs node-brain | grep "restart"
```

### 测试场景 3: 服务器重启

```bash
# 1. 重启服务器
sudo reboot

# 2. 重启后验证
docker compose ps
# 应该显示所有服务自动启动
```

## 监控告警

### 推荐监控项

1. **服务健康**: `docker compose ps`
2. **Tick 循环**: `curl http://localhost:5221/api/brain/tick/status`
3. **Circuit Breaker**: `curl http://localhost:5221/api/brain/circuit-breaker`
4. **任务队列**: 查询 tasks 表 `status='queued'` 数量
5. **资源使用**: `docker stats`

### 告警阈值

| 指标 | 警告 | 严重 |
|------|------|------|
| CPU 使用率 | > 70% | > 90% |
| 内存使用 | > 3GB | > 4GB |
| 磁盘使用 | > 80% | > 95% |
| queued 任务数 | > 50 | > 100 |
| Circuit Breaker | - | OPEN |

## 安全注意事项

1. **.env.docker 权限**: 必须 600（仅所有者可读写）
2. **凭据管理**: 从 `~/.credentials/` 加载，不提交到 Git
3. **网络模式**: 使用 host 模式访问本地 PostgreSQL
4. **只读挂载**: `/home/xx/dev`, `/home/xx/.claude`, `/home/xx/bin` 都是只读

## 24/7 运行验证

### Day 1: 部署日

- [ ] 服务启动成功
- [ ] 健康检查通过
- [ ] Tick 循环运行
- [ ] 创建测试任务验证

### Day 2-7: 观察期

- [ ] 每天检查日志大小（应自动轮转）
- [ ] 每天检查 Circuit Breaker 状态
- [ ] 每天检查资源使用趋势
- [ ] 测试自动重启功能

### Day 30: 稳定期

- [ ] 统计任务成功率
- [ ] 统计平均任务时长
- [ ] 统计资源峰值
- [ ] 优化并发配置（如需要）

## 扩展优化

### 当任务量 > 100/天

1. **提高并发**: `MAX_CONCURRENT_TASKS=5`
2. **缩短 Tick 间隔**: `CECELIA_TICK_INTERVAL_MS=60000` (1分钟)
3. **增加资源**: 升级 VPS 配置

### 引入监控

```yaml
# docker-compose.yml 添加
prometheus:
  image: prom/prometheus
  ports:
    - 9090:9090

grafana:
  image: grafana/grafana
  ports:
    - 3000:3000
```

## 常见问题

### Q: 如何查看当前有多少任务在执行？

```bash
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "SELECT COUNT(*) FROM tasks WHERE status = 'in_progress';"
```

### Q: 如何清理所有失败的任务？

```bash
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "UPDATE tasks SET status = 'cancelled' WHERE status = 'failed';"
```

### Q: 如何手动触发 Tick？

```bash
curl -X POST http://localhost:5221/api/brain/tick
```

### Q: 如何临时禁用 Tick 循环？

```bash
curl -X POST http://localhost:5221/api/brain/tick/disable
```

### Q: 如何重新启用 Tick 循环？

```bash
curl -X POST http://localhost:5221/api/brain/tick/enable
```

## 联系和支持

- **GitHub**: https://github.com/perfectuser21/cecelia-semantic-brain
- **文档**: /home/xx/dev/cecelia-semantic-brain/docs/
- **日志位置**: /home/xx/dev/cecelia-semantic-brain/logs/
