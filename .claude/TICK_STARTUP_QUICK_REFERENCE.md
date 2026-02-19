# Tick 启动稳定性 - 快速参考

**版本**: 1.0.0  
**最后更新**: 2026-02-18  
**文件位置**: `/home/xx/perfect21/cecelia/core/.claude/TICK_STARTUP_QUICK_REFERENCE.md`

---

## 一句话总结

✅ 启动有重试机制  
❌ 缺少 API 可观测性

---

## 启动流程表（6 个步骤）

| 步骤 | 组件 | 代码行 | 重试 | 失败行为 | 可观测性 |
|------|------|--------|------|----------|----------|
| 1 | Alertness 初始化 | L259 | ❌ | Log only | 无 DB 记录 |
| 2 | 孤儿进程清理 | L266 | ❌ | Log only | 无 DB 记录 |
| 3 | 孤儿任务同步 | L271 | ❌ | Log only | 无 DB 记录 |
| 4 | 事件表初始化 | L284 | ✅ 3 次 | 重试 | DB 记录 |
| 5 | 环境变量检查 | L287 | ✅ 3 次 | 重试 | DB 记录 |
| 6 | 启动 Tick Loop | L297 | ✅ 3 次 | 重试 | DB 记录 |

---

## startup_errors 数据结构

**存储位置**: `working_memory` 表，key = `startup_errors`

```json
{
  "errors": [
    { "ts": "ISO8601", "error": "错误信息", "attempt": 1 }
  ],
  "last_error_at": "ISO8601",
  "total_failures": 3
}
```

**特点**:
- 保留最近 20 条
- 累计计数
- 无 TTL

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CECELIA_INIT_RETRY_COUNT` | 3 | 最大重试次数 |
| `CECELIA_INIT_RETRY_DELAY_MS` | 10000 | 重试间隔（毫秒） |
| `CECELIA_TICK_ENABLED` | - | 启动时自动启用 Tick |

---

## 可观测性现状

### ✅ 已有
- DB 中持久化错误记录
- 3 次重试
- console.error 日志
- `init_failed` 事件

### ❌ 缺失
- API 暴露启动错误
- `/api/brain/tick/status` 不显示启动状态
- 启动健康检查 Probe
- 启动日志表
- 错误分类
- 自动修复建议

---

## API 端点

| 端点 | 返回内容 | 包含启动状态 |
|------|----------|-------------|
| `GET /api/brain/tick/status` | Tick 状态 | ❌ 不包含 |

---

## 快速诊断步骤

### 问题: 启动失败
```bash
# 1. 查询启动错误
SELECT value_json FROM working_memory WHERE key = 'startup_errors';

# 2. 检查最后一条错误
value_json -> 'errors' -> -1

# 3. 查询 DB 连接状态
SELECT version();

# 4. 查询 tick 状态
curl http://localhost:5221/api/brain/tick/status | jq '.enabled'
```

---

## 建议 Tasks 优先级

### P0 (立即做)
1. Task 1: `/api/brain/startup/diagnostics` 端点 (2h)
2. Task 2: 增强 `tick/status` 返回启动信息 (1h)

### P1 (本周做)
3. Task 4: 启动日志持久化 (3h)
4. Task 5: 启动健康检查 Probe (2h)

### P2 (本月做)
5. Task 3: 启动失败告警 API (2h)
6. Task 6: 错误分类与自动修复建议 (3h)

---

## 重要数字

| 参数 | 值 | 说明 |
|------|-----|------|
| 最大重试次数 | 3 | 默认 `CECELIA_INIT_RETRY_COUNT` |
| 重试间隔 | 10 秒 | `CECELIA_INIT_RETRY_DELAY_MS` |
| 最大失败时间 | 30 秒 | 3 次 * 10 秒 |
| 保留错误数 | 20 条 | `errors.slice(-20)` |
| 没有 TTL | ✓ | 数据永久保存 |

---

## 测试覆盖

### ✅ 已覆盖
- `_recordStartupError` 逻辑
- 重试 3 次后放弃
- 失败不阻断启动

### ❌ 未覆盖
- 非重试步骤的失败
- 网络中断重试行为
- Alertness 初始化失败

---

## 一键诊断脚本

```bash
#!/bin/bash

echo "=== Cecelia Tick 启动诊断 ==="

# 1. DB 连接
echo "1. 检查 DB 连接..."
curl -s http://localhost:5221/api/brain/tick/status | jq '.enabled'

# 2. 启动错误
echo "2. 查询启动错误..."
psql -c "SELECT value_json FROM working_memory WHERE key='startup_errors';"

# 3. 最后启动时间
echo "3. 查询最后启动时间..."
psql -c "SELECT updated_at FROM working_memory WHERE key='startup_errors';"

# 4. Tick 循环状态
echo "4. 查询 Tick 循环状态..."
curl -s http://localhost:5221/api/brain/tick/status | jq '.loop_running'
```

---

## 相关文件

| 文件 | 用途 |
|------|------|
| `tick.js` | 启动逻辑、重试机制 |
| `routes.js` | API 端点 |
| `executor.js` | 孤儿进程清理 |
| `alertness/index.js` | Alertness 初始化 |
| `__tests__/init-tick-retry.test.js` | 重试机制测试 |

---

## 下一步

阅读完整分析: `/home/xx/perfect21/cecelia/core/.claude/TICK_STARTUP_ANALYSIS.md`

