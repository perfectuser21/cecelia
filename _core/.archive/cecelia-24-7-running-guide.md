# Cecelia 24/7 自主运行指南

**创建时间**: 2026-02-01
**状态**: ✅ 已启动并运行

---

## 🎉 当前状态

✅ **Cecelia 已在后台 24/7 自主运行！**

### 核心服务
- **Brain (Node.js)**: ✅ Running on http://localhost:5221
- **Intelligence (Python)**: ✅ Running on http://localhost:5220
- **PostgreSQL**: ✅ Running in Docker (social-metrics-postgres)

### Tick Loop（心跳循环）
- **状态**: ✅ Enabled & Running
- **循环间隔**: 2 分钟（120000 ms）
- **今日动作**: 120+ 次
- **上次运行**: 2026-02-01 11:18:28
- **下次运行**: 2026-02-01 11:23:28

---

## 📊 监控命令

### 1. 快速查看状态
```bash
cecelia-status
```

### 2. 查看 Brain API
```bash
curl http://localhost:5221/ | jq '.'
```

### 3. 查看 Tick Loop 详细状态
```bash
curl http://localhost:5221/api/brain/tick/status | jq '.'
```

### 4. 实时查看日志
```bash
tail -f /tmp/cecelia-node-brain.log
```

### 5. 查看任务队列
```bash
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "SELECT COUNT(*), status FROM tasks GROUP BY status ORDER BY status;"
```

### 6. 查看最近任务
```bash
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c \
  "SELECT title, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 10;"
```

---

## 🔧 管理命令

### 启动服务
**Brain 已自动启动**（PID 1962，Jan23 启动，一直在运行）

如果需要重启：
```bash
# 1. 找到当前 Brain 进程
ps aux | grep "node.*server.js"

# 2. 停止（慎用！）
sudo kill <PID>

# 3. 启动
cd /home/xx/dev/cecelia-core/brain
nohup node server.js > /tmp/cecelia-brain.log 2>&1 &
```

### 启用/禁用 Tick Loop
```bash
# 禁用（紧急情况）
curl -X POST http://localhost:5221/api/brain/tick/disable

# 启用
curl -X POST http://localhost:5221/api/brain/tick/enable
```

### 手动触发 Tick
```bash
curl -X POST http://localhost:5221/api/brain/tick/trigger
```

---

## 📁 重要文件位置

### 代码
- Brain 源码: `/home/xx/dev/cecelia-core/brain/`
- Intelligence 源码: `/home/xx/dev/cecelia-core/src/`
- DEFINITION.md: `/home/xx/dev/cecelia-core/DEFINITION.md`

### 日志
- Brain 日志: `/tmp/cecelia-node-brain.log`
- Intelligence 日志: `/tmp/cecelia-intelligence.log`
- 任务日志: `/tmp/cecelia-*.log`

### 配置
- Brain 环境变量: `/home/xx/dev/cecelia-core/brain/.env`
- Docker Compose: `/home/xx/dev/cecelia-core/docker-compose.yml`

---

## 🎯 工作流程

### Cecelia 自主运行流程

```
每 2 分钟一次 Tick Loop:
  ↓
1. 检查任务队列（PostgreSQL tasks 表）
  ↓
2. Planner 决策：选择下一个要执行的任务
  ↓
3. Dispatch Executor：派发任务
  ↓
4. 调用 cecelia-run 脚本启动无头 Claude Code
  ↓
5. 执行任务（/dev workflow）
  ↓
6. 回写结果到数据库
  ↓
7. 更新任务状态（completed/failed）
  ↓
8. 下一次 Tick 循环
```

### 当前正在做什么？

**最近派发的任务**: "扩展 intent.js phrase patterns 覆盖率"
**状态**: in_progress
**派发时间**: 2026-02-01 11:14:28

---

## 🚨 故障排查

### 问题 1: Tick Loop 停止
```bash
# 检查状态
curl http://localhost:5221/api/brain/tick/status | jq '.enabled, .loop_running'

# 如果 enabled=false，重新启用
curl -X POST http://localhost:5221/api/brain/tick/enable
```

### 问题 2: Brain API 无响应
```bash
# 检查进程
ps aux | grep "node.*server.js"

# 查看日志
tail -100 /tmp/cecelia-node-brain.log

# 重启（如果必要）
cd /home/xx/dev/cecelia-core/brain
nohup node server.js > /tmp/cecelia-brain.log 2>&1 &
```

### 问题 3: 任务一直失败
```bash
# 查看熔断器状态
curl http://localhost:5221/api/brain/tick/status | jq '.circuit_breakers'

# 如果 cecelia-run 熔断器 state=OPEN：
# 1. 检查日志找根因
tail -100 /tmp/cecelia-*.log

# 2. 修复问题后，熔断器会在 30 分钟后自动恢复到 HALF_OPEN
```

### 问题 4: PostgreSQL 连接失败
```bash
# 检查容器
docker ps | grep postgres

# 如果没运行，启动
docker start social-metrics-postgres

# 测试连接
docker exec social-metrics-postgres psql -U n8n_user -d cecelia_tasks -c "SELECT 1;"
```

---

## 📈 性能指标

### 当前性能
- **今日动作**: 120+
- **并发任务限制**: 5
- **平均 Tick 间隔**: 2 分钟
- **任务超时时间**: 60 分钟

### 配置调整（如需要）
编辑 `/home/xx/dev/cecelia-core/brain/.env`:
```bash
CECELIA_TICK_ENABLED=true
CECELIA_TICK_INTERVAL_MS=120000  # 2 分钟
CECELIA_MAX_CONCURRENT=5          # 最大并发任务数
DISPATCH_TIMEOUT_MINUTES=60       # 任务超时时间
```

---

## 🔮 下一步规划

根据 OKR 分析（`okr-analysis-2026-02-01.md`），当前进度：
- **O1**: Cecelia 自驱进化 - 从被动执行器到自驱数字生命体
- **进度**: 11% (1/9 KR 完成)

### P0 优先级任务（下一步）
1. **KR1**: 意图识别 - 自然语言→OKR/Project/Task
   - 实现二段式意图处理（Mouth + Planner）
   - 预计 3-5 天

2. **KR7**: Cecelia 可执行一次完整 /dev 流程
   - 验证 Control Plane 核心能力
   - 预计 5-7 天

---

## 📞 联系方式

- **文档位置**: `/home/xx/dev/cecelia-core/`
- **OKR 分析**: `.archive/okr-analysis-2026-02-01.md`
- **DEFINITION.md**: `DEFINITION.md` (v1.3.2)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-01
**维护者**: Cecelia Team
