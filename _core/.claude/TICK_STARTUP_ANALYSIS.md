# Cecelia Core - Tick 启动稳定性与可观测性分析报告

**分析时间**: 2026-02-18  
**分析范围**: `/home/xx/perfect21/cecelia/core`  
**重点文件**: `tick.js`, `executor.js`, `routes.js`, `alertness/index.js`

---

## 执行摘要

### 现状评估
✅ **已有的启动重试机制**: 
- `initTickLoop()` 实现了 3 次重试（默认）
- 错误记录到 `working_memory.startup_errors`
- 重试耗尽时发出 `init_failed` critical 事件

⚠️ **可观测性缺口**:
- 没有 API 端点直接暴露 `startup_errors` 数据
- `/api/brain/tick/status` 不包含启动历史信息
- 无法快速诊断"为什么启动失败"

### 建议优先级
| 优先级 | 任务 | 影响 | 工作量 |
|--------|------|------|--------|
| P0 | 添加 `/api/brain/startup/diagnostics` 端点 | 关键可观测性 | 2h |
| P0 | 增强 `tick/status` 返回 startup_errors | 启动监控 | 1h |
| P1 | 自动启动失败告警 API | 及时感知问题 | 2h |
| P1 | 启动日志持久化 | 长期追踪 | 3h |
| P2 | 启动健康检查 Probe | 主动诊断 | 2h |

---

## 一、启动流程完整分析

### Step by Step 分解

#### **Step 1: 初始化 Alertness 系统（非重试）**
**代码**: tick.js L259-264  
**操作**:
```javascript
try {
  await initAlertness();
  console.log(`[tick-loop] Alertness system initialized`);
} catch (alertErr) {
  console.error('[tick-loop] Alertness init failed:', alertErr.message);
}
```
- **失败原因**: alertness/index.js 的初始化逻辑（collectMetrics 失败等）
- **现有处理**: try/catch，失败只记 error log，**不会阻断启动**
- **可观测性**: 有错误日志，但无数据库记录

#### **Step 2: 清理孤儿进程（非重试）**
**代码**: tick.js L266-269  
**操作**:
```javascript
const orphansKilled = cleanupOrphanProcesses();
if (orphansKilled > 0) {
  console.log(`[tick-loop] Cleaned up ${orphansKilled} orphan processes on startup`);
}
```
- **失败原因**: ps 命令执行失败、权限问题
- **现有处理**: executor.js L558-616 有 try/catch，失败不阻断
- **可观测性**: 只有 console.log，无数据库记录

#### **Step 3: 同步孤儿任务（非重试）**
**代码**: tick.js L271-278  
**操作**:
```javascript
try {
  const syncResult = await syncOrphanTasksOnStartup();
  if (syncResult.orphans_fixed > 0 || syncResult.rebuilt > 0) {
    console.log(`[tick-loop] Startup sync: ${syncResult.orphans_fixed} orphans fixed, ${syncResult.rebuilt} processes rebuilt`);
  }
} catch (syncErr) {
  console.error('[tick-loop] Startup sync failed:', syncErr.message);
}
```
- **失败原因**: DB 查询失败、orphan 检测逻辑错误
- **现有处理**: try/catch，失败不阻断
- **可观测性**: 同上，只有日志

#### **Step 4-6: 数据库依赖启动（带重试）**
**代码**: tick.js L280-312  
**操作**:
1. **EnsureEventsTable**: 确保 `cecelia_events` 表存在
2. **检查环境变量**: `CECELIA_TICK_ENABLED=true`
3. **查询 DB**: 从 `working_memory` 读取 `tick_enabled` 状态
4. **启动循环**: 如果启用则 `startTickLoop()`

**重试配置**:
```javascript
const INIT_RETRY_COUNT = parseInt(process.env.CECELIA_INIT_RETRY_COUNT || '3', 10);
const INIT_RETRY_DELAY_MS = parseInt(process.env.CECELIA_INIT_RETRY_DELAY_MS || '10000', 10);
```
- **失败原因**:
  - DB 连接失败（PostgreSQL 未启动）
  - SQL 执行超时
  - 表不存在/Schema 不对
  - DB 凭据错误

- **现有处理**:
  - 最多重试 3 次
  - 每次间隔 10 秒
  - 错误记录到 `startup_errors`（via `_recordStartupError`）
  - 重试耗尽时发出 `init_failed` 事件

- **可观测性**:
  - ✅ 错误记录到 DB (`startup_errors`)
  - ✅ 错误日志 (`console.error`)
  - ✅ 失败事件发出 (`emit('init_failed')`)
  - ❌ 没有 API 暴露 `startup_errors`

---

## 二、startup_errors 数据结构分析

### 存储位置
**表**: `working_memory`  
**Key**: `startup_errors`  
**字段**:
```json
{
  "errors": [
    {
      "ts": "2026-02-18T10:30:45.123Z",     // 错误时间戳
      "error": "ECONNREFUSED",               // 错误信息
      "attempt": 1                           // 第几次重试
    }
  ],
  "last_error_at": "2026-02-18T10:30:55.123Z",  // 最后一次错误时间
  "total_failures": 3                            // 累计失败次数
}
```

### 写入逻辑
**代码**: tick.js L227-249 (`_recordStartupError`)

**行为**:
```javascript
// 1. 读取现有 startup_errors
const existing = await pool.query('SELECT value_json FROM working_memory WHERE key = startup_errors');
const errors = existing.errors || [];

// 2. 追加新错误
errors.push({ ts: now, error: errMessage, attempt });

// 3. 保留最近 20 条
const updated = {
  errors: errors.slice(-20),
  last_error_at: now,
  total_failures: (existing.total_failures || 0) + 1
};

// 4. 写回数据库
await pool.query('INSERT/UPDATE into working_memory...');
```

**特点**:
- ✅ 自动去重：保留最近 20 条
- ✅ 累计计数：`total_failures` 持续增长
- ✅ 失败不阻断：try/catch 包裹，DB 写入失败不会中断重试
- ❌ 没有 TTL：数据永久保存（除非手动清理）

### 查询方式
**当前查询方式**: 直接查询数据库
```sql
SELECT value_json FROM working_memory WHERE key = 'startup_errors'
```

**无法通过 API 查询**: 
- 没有 `/api/brain/startup/errors` 端点
- `/api/brain/tick/status` 不包含 `startup_errors`

---

## 三、现有 API 分析

### GET `/api/brain/tick/status`
**代码**: routes.js L699-706  
**返回内容** (来自 `getTickStatus()` - tick.js L80-139):

```javascript
{
  enabled: boolean,
  loop_running: boolean,
  draining: boolean,
  interval_minutes: 5,
  loop_interval_ms: 5000,
  last_tick: ISO8601,
  next_tick: ISO8601,
  actions_today: number,
  tick_running: boolean,
  last_dispatch: {
    task_id, task_title, run_id, dispatched_at, success
  },
  max_concurrent: number,
  auto_dispatch_max: number,
  resources: { ... },
  slot_budget: { ... },
  dispatch_timeout_minutes: 60,
  circuit_breakers: { ... },
  alertness: { ... },
  quarantine: { ... }
}
```

**缺失内容**:
- ❌ `startup_errors` 未包含
- ❌ 启动历史信息
- ❌ 启动状态（成功/失败/重试中）
- ❌ 最后一次启动时间

---

## 四、重试机制详析

### 重试范围
✅ **会重试的步骤**:
- DB 连接
- `ensureEventsTable()`
- `getTickStatus()` 查询
- 写入 `tick_enabled` 状态

❌ **不会重试的步骤**:
- Alertness 初始化
- 清理孤儿进程
- 同步孤儿任务

### 重试流程
```
Attempt 1 ─┬─> DB OK ─> startTickLoop() ✅
           └─> DB FAIL ─> _recordStartupError(1) ─> wait 10s ─┐
                                                               │
Attempt 2 ─────────────────────────────────────────────────────┤
           ├─> DB OK ─> startTickLoop() ✅
           └─> DB FAIL ─> _recordStartupError(2) ─> wait 10s ─┐
                                                               │
Attempt 3 ─────────────────────────────────────────────────────┤
           ├─> DB OK ─> startTickLoop() ✅
           └─> DB FAIL ─> _recordStartupError(3) ─> emit('init_failed') ❌
```

### 重试配置
| 参数 | 默认值 | 用途 |
|------|--------|------|
| `CECELIA_INIT_RETRY_COUNT` | 3 | 最大重试次数 |
| `CECELIA_INIT_RETRY_DELAY_MS` | 10000 | 重试间隔（毫秒） |

**可配置**: 通过环境变量

---

## 五、可观测性缺口识别

### 缺口 1: 无 API 暴露启动错误
**现象**: 无法通过 HTTP API 查询启动失败原因  
**影响**: 
- 需要直接查 DB 诊断问题
- 无法在监控面板展示启动状态
- 第三方集成困难

**建议**: 添加 `/api/brain/startup/diagnostics` 端点

### 缺口 2: 启动状态不在 tick/status 中
**现象**: `/api/brain/tick/status` 不显示启动是否成功  
**影响**:
- 无法一键了解系统启动状态
- 启动失败不会立即被发现
- 与其他状态（alertness, quarantine 等）不对齐

**建议**: 增强 `getTickStatus()` 返回 `startup` 字段

### 缺口 3: 无主动告警机制
**现象**: 启动失败发出事件，但没有告警 API  
**影响**:
- 启动失败可能被忽略
- 无自动化恢复建议
- 需要手动监控日志

**建议**: 添加告警 API + 自动恢复建议

### 缺口 4: 启动日志无持久化
**现象**: 启动信息只在内存/日志中，无数据库记录  
**影响**:
- 重启后丢失历史
- 无法长期追踪启动问题
- 无法分析启动频率/模式

**建议**: 创建 `startup_history` 表

### 缺口 5: 无启动预检机制
**现象**: 启动时未预检 DB 连接、schema 等  
**影响**:
- 启动失败才发现问题
- 浪费 3 * 10s = 30 秒
- 无法快速定位问题根源

**建议**: 添加 `/api/brain/startup/health-check` 端点

### 缺口 6: 错误分类不足
**现象**: `startup_errors` 只记录错误信息，无分类  
**影响**:
- 无法区分 "DB 连接" vs "Schema 不对" vs "权限问题"
- 无法自动推荐修复方案
- 问题聚类困难

**建议**: 添加错误分类字段

---

## 六、建议 Tasks

### Task 1: 添加启动诊断 API (P0)
**优先级**: P0 (关键可观测性)  
**工作量**: 2h  
**范围**:
1. 新建 `/api/brain/startup/diagnostics` 端点
2. 返回:
   - 最后启动时间
   - 启动状态 (success/failed/retrying)
   - 最近 5 条启动错误
   - 重试计数
   - 建议修复步骤

**实现文件**: 
- `routes.js` (添加路由)
- `tick.js` (导出函数)

**示例返回**:
```json
{
  "startup": {
    "status": "success",
    "started_at": "2026-02-18T10:30:15.000Z",
    "succeeded_at": "2026-02-18T10:30:15.123Z",
    "total_attempts": 1,
    "failures_history": []
  },
  "last_failure": null
}
```

---

### Task 2: 增强 tick/status 返回启动信息 (P0)
**优先级**: P0 (启动监控)  
**工作量**: 1h  
**范围**:
1. 修改 `getTickStatus()` 添加 `startup` 字段
2. 返回:
   - 启动成功时间
   - 最后启动尝试时间
   - 最近失败次数

**实现文件**:
- `tick.js` (L80-139 `getTickStatus()`)

**示例返回**:
```json
{
  "enabled": true,
  "loop_running": true,
  "startup": {
    "succeeded_at": "2026-02-18T10:30:15.123Z",
    "attempts": 1,
    "recent_failures": 0
  }
}
```

---

### Task 3: 启动失败告警 API (P1)
**优先级**: P1 (及时感知)  
**工作量**: 2h  
**范围**:
1. 新建 `/api/brain/startup/alert-config` 端点
2. 支持配置:
   - 告警阈值 (如: 连续 3 次失败)
   - 告警目标 (邮件、Slack 等)
   - 自动恢复建议

**实现文件**:
- `routes.js` (新路由)
- 新建 `startup-alerts.js` (逻辑)

---

### Task 4: 启动日志持久化 (P1)
**优先级**: P1 (长期追踪)  
**工作量**: 3h  
**范围**:
1. 新建 `startup_history` 表:
   ```sql
   CREATE TABLE startup_history (
     id UUID PRIMARY KEY,
     attempt INT,
     status VARCHAR(20), -- success, failed, retrying
     error_message TEXT,
     error_type VARCHAR(100), -- db_connection, schema_mismatch, etc.
     started_at TIMESTAMP,
     completed_at TIMESTAMP,
     duration_ms INT,
     metadata JSONB
   )
   ```
2. 记录每次启动尝试
3. 提供查询 API

**实现文件**:
- `migrate.js` (新建表)
- `tick.js` (写入日志)
- `routes.js` (查询 API)

---

### Task 5: 启动健康检查 Probe (P1)
**优先级**: P1 (主动诊断)  
**工作量**: 2h  
**范围**:
1. 新建 `/api/brain/startup/health-check` 端点
2. 检查:
   - PostgreSQL 连接
   - Schema 完整性
   - working_memory 表
   - 孤儿进程
3. 返回诊断报告

**实现文件**:
- `routes.js` (新路由)
- 新建 `startup-health-check.js` (逻辑)

**示例返回**:
```json
{
  "healthy": true,
  "checks": {
    "db_connection": { "status": "ok" },
    "schema": { "status": "ok" },
    "working_memory": { "status": "ok" },
    "orphan_processes": { "status": "ok", "count": 0 }
  },
  "recommendations": []
}
```

---

### Task 6: 错误分类与自动修复建议 (P2)
**优先级**: P2 (自愈能力)  
**工作量**: 3h  
**范围**:
1. 分类启动错误:
   - `DB_CONNECTION_REFUSED` → "启动 PostgreSQL"
   - `DB_TIMEOUT` → "检查网络/DB 负载"
   - `SCHEMA_MISMATCH` → "运行 migrations"
   - `PERMISSION_DENIED` → "检查用户权限"

2. 返回修复建议

**实现文件**:
- 新建 `startup-error-classifier.js`
- `tick.js` (使用分类器)
- `routes.js` (展示建议)

---

## 七、现有测试覆盖分析

### 已有测试
**文件**: `brain/src/__tests__/init-tick-retry.test.js`

**覆盖内容** (L18-128):
✅ `_recordStartupError` 函数:
- 无历史数据时写入第一条错误
- 有历史数据时累积 `total_failures`
- 超过 20 条时自动裁剪
- DB 写入失败时不抛出异常

✅ `initTickLoop` 重试机制:
- 启动成功时不重试
- 第 1 次失败第 2 次成功时
- 重试 3 次后放弃
- 重试耗尽时发出 `init_failed` 事件
- 环境变量可配置重试次数
- emit 失败时不影响进程

**缺失测试**:
- ❌ Alertness 初始化失败的影响
- ❌ 孤儿进程清理失败的影响
- ❌ 孤儿任务同步失败的影响
- ❌ `ensureEventsTable()` 失败处理
- ❌ 网络中断中途重试的行为
- ❌ 启动过程中 tick loop 状态

---

## 八、推荐优化方案

### 短期 (立即实施)
1. **Task 1**: 添加 `/api/brain/startup/diagnostics` 端点
   - 时间: 2h
   - 收益: 快速诊断启动问题
   
2. **Task 2**: 增强 `tick/status` 返回启动信息
   - 时间: 1h
   - 收益: 一键了解系统启动状态

### 中期 (本周完成)
3. **Task 4**: 启动日志持久化
   - 时间: 3h
   - 收益: 长期追踪启动问题

4. **Task 5**: 启动健康检查 Probe
   - 时间: 2h
   - 收益: 主动诊断问题

### 长期 (本月完成)
5. **Task 3**: 启动失败告警 API
   - 时间: 2h
   - 收益: 及时感知问题

6. **Task 6**: 错误分类与自动修复建议
   - 时间: 3h
   - 收益: 自动化诊断和修复

---

## 九、附录：关键代码片段

### A. initTickLoop 完整逻辑
```javascript
// tick.js L257-325
async function initTickLoop() {
  // 步骤 1-3: 非重试初始化
  try { await initAlertness(); } catch { /* log only */ }
  cleanupOrphanProcesses();
  try { await syncOrphanTasksOnStartup(); } catch { /* log only */ }
  
  // 步骤 4-6: 重试逻辑
  let lastError = null;
  for (let attempt = 1; attempt <= INIT_RETRY_COUNT; attempt++) {
    try {
      const { ensureEventsTable } = await import('./event-bus.js');
      await ensureEventsTable();
      
      if (process.env.CECELIA_TICK_ENABLED === 'true') {
        await enableTick();
        return;
      }
      
      const status = await getTickStatus();
      if (status.enabled) startTickLoop();
      return; // success
    } catch (err) {
      lastError = err;
      await _recordStartupError(attempt, err.message);
      if (attempt < INIT_RETRY_COUNT) {
        await new Promise(r => setTimeout(r, INIT_RETRY_DELAY_MS));
      }
    }
  }
  
  // 重试耗尽
  await emit('init_failed', 'tick', {
    error: lastError?.message || 'unknown',
    attempts: INIT_RETRY_COUNT,
    failed_at: new Date().toISOString()
  });
}
```

### B. _recordStartupError 逻辑
```javascript
// tick.js L227-249
async function _recordStartupError(attempt, errMessage) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      ['startup_errors']
    );
    const existing = result.rows[0]?.value_json || { errors: [], total_failures: 0 };
    const errors = Array.isArray(existing.errors) ? existing.errors : [];
    
    errors.push({ ts: new Date().toISOString(), error: errMessage, attempt });
    const updated = {
      errors: errors.slice(-20),
      last_error_at: new Date().toISOString(),
      total_failures: (existing.total_failures || 0) + 1
    };
    
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['startup_errors', updated]);
  } catch {
    // 失败不阻断重试
  }
}
```

---

## 总结

**Tick 启动稳定性现状**: 
- ✅ 有重试机制，配置灵活
- ✅ 错误持久化到数据库
- ✅ 完整的日志记录

**可观测性缺口**:
- ❌ 无 API 暴露启动错误
- ❌ `/api/brain/tick/status` 不显示启动状态
- ❌ 无主动告警机制
- ❌ 启动日志无持久化
- ❌ 无启动预检机制

**建议优先次序**:
1. Task 1 + Task 2 (P0 - 立即做，共 3h)
2. Task 4 + Task 5 (P1 - 本周做，共 5h)
3. Task 3 + Task 6 (P2 - 本月做，共 5h)

