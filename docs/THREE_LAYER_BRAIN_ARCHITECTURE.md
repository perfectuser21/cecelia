# Cecelia 三层大脑架构 - 技术说明

## 概述

Cecelia 是一个 24/7 自主运行的管家系统。本次实现了仿人脑的三层架构，使其具备自我保护能力。

```
Cecelia 的器官结构：

💬 嘴巴 (/cecelia skill) - Sonnet - 对外对话

🧠 大脑
├── 脑干 (Level 0) - 纯代码 - brain/src/*.js
│   └── 自动反应：心跳、派发、熔断、资源检查
│
├── 丘脑 (Level 1) - Sonnet - brain/src/thalamus.js
│   └── 事件路由：分类、快速判断、摘要压缩
│
└── 皮层 (Level 2) - Opus - brain/src/cortex.js
    └── 深度思考：战略决策、RCA、跨部门权衡
```

## LLM 使用说明

Cecelia 使用 3 个 LLM：

| 位置 | 模型 | 用途 | 延迟 |
|------|------|------|------|
| 嘴巴 | Sonnet | 对外对话，快速响应 | 0.5-1s |
| 丘脑 (L1) | Sonnet | 事件路由，快速判断 | 0.5-1s |
| 皮层 (L2) | Opus | 深度分析，战略决策 | 3-5s |

**核心原则**：LLM 只下"指令"，代码执行。LLM 不能直接修改数据库或文件系统。

---

## 模块详细说明

### 1. Cortex (皮层) - brain/src/cortex.js

**职责**：深度思考、战略决策、根因分析 (RCA)

**触发条件**：当 Thalamus 判断事件复杂度为 `level: 2` 时，自动升级到 Cortex

**主要函数**：

```javascript
// 调用 Opus 进行深度分析
async function callOpus(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  // ...
}

// 深度事件分析
async function analyzeDeep(event, thalamusDecision) {
  // 构建详细上下文
  // 调用 Opus
  // 返回 CortexDecision
}

// 根因分析
async function performRCA(event, history) {
  // 分析连续失败的根本原因
  // 返回 RCA 报告
}
```

**Cortex Action 白名单**：

```javascript
const CORTEX_ACTION_WHITELIST = {
  // 继承 Thalamus 的所有 actions
  ...ACTION_WHITELIST,

  // Cortex 专属 actions
  adjust_strategy: { dangerous: false },    // 调整策略参数
  record_learning: { dangerous: false },    // 记录经验教训
  create_rca_report: { dangerous: false },  // 创建 RCA 报告
};
```

---

### 2. Alertness Level (警觉系统) - brain/src/alertness.js

**职责**：自我保护，根据系统健康状态自动调整运行模式

**4 级警觉等级**：

| Level | 名称 | 触发条件 | 行为 |
|-------|------|----------|------|
| 0 | NORMAL | score < 20 | 全速运行，100% 派发 |
| 1 | ALERT | score >= 20 | 减速观察，50% 派发，停止自动重试 |
| 2 | EMERGENCY | score >= 50 | 最小化运行，25% 派发，停止规划 |
| 3 | COMA | score >= 80 | 只保留心跳，停止派发和 LLM 调用 |

**信号权重配置**：

```javascript
const SIGNAL_WEIGHTS = {
  circuit_breaker_open: 30,    // 熔断器打开
  high_failure_rate: 20,       // 高失败率 (>30%)
  resource_pressure: 15,       // 资源压力 (>70%)
  consecutive_failures: 10,    // 每次连续失败 +10
  db_connection_issues: 25,    // 数据库问题
  llm_api_errors: 15,          // LLM API 错误
};
```

**信号收集函数**：

```javascript
async function collectSignals() {
  const signals = {};
  let totalScore = 0;

  // 1. 熔断器状态
  const cbState = getCircuitState('cecelia-run');
  if (cbState.state === 'OPEN') {
    signals.circuit_breaker_open = true;
    totalScore += 30;
  }

  // 2. 资源压力 (CPU/内存)
  const resources = checkServerResources();
  if (resources.metrics?.max_pressure >= 0.7) {
    signals.resource_pressure = resources.metrics.max_pressure;
    totalScore += Math.round(15 * resources.metrics.max_pressure);
  }

  // 3. 24小时失败率
  const failureRate = await queryFailureRate();
  if (failureRate > 0.3) {
    signals.high_failure_rate = failureRate;
    totalScore += Math.round(20 * failureRate);
  }

  // 4. 连续失败次数
  const consecutiveFailures = await queryConsecutiveFailures();
  if (consecutiveFailures >= 3) {
    signals.consecutive_failures = consecutiveFailures;
    totalScore += 10 * consecutiveFailures;
  }

  return { signals, totalScore };
}
```

**行为查询 API**：

```javascript
canDispatch()      // 是否允许派发任务
getDispatchRate()  // 派发速率 (0.0 ~ 1.0)
canPlan()          // 是否允许规划新任务
canUseCortex()     // 是否允许调用皮层
canAutoRetry()     // 是否允许自动重试
```

**冷却时间**：升级后需要等待一段时间才能自动降级

```javascript
const COOLDOWN_MS = {
  ALERT: 5 * 60 * 1000,      // 5 分钟
  EMERGENCY: 15 * 60 * 1000, // 15 分钟
  COMA: 30 * 60 * 1000,      // 30 分钟
};
```

---

### 3. Quarantine (隔离区) - brain/src/quarantine.js

**职责**：隔离问题任务，防止污染正常队列

**触发条件**：

| 原因 | 触发条件 |
|------|----------|
| repeated_failure | 任务连续失败 >= 3 次 |
| suspicious_input | PRD > 50KB 或包含危险模式 |
| timeout_pattern | 连续超时 >= 2 次 |
| manual | 人工隔离 |

**危险模式检测**：

```javascript
const suspiciousPatterns = [
  /rm\s+-rf\s+\//i,                        // rm -rf /
  /DROP\s+TABLE/i,                          // SQL DROP TABLE
  /DELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1/i, // DELETE WHERE 1=1
  /;\s*--/,                                  // SQL 注入
];
```

**隔离任务的状态**：`status = 'quarantined'`

**审核动作**：

| 动作 | 说明 |
|------|------|
| release | 释放回队列，重置失败计数 |
| retry_once | 释放但只允许重试一次 |
| cancel | 永久取消任务 |
| modify | 修改 PRD 后释放 |

**核心函数**：

```javascript
// 隔离任务
async function quarantineTask(taskId, reason, details) {
  await pool.query(`
    UPDATE tasks
    SET status = 'quarantined',
        payload = payload || $2::jsonb
    WHERE id = $1
  `, [taskId, JSON.stringify({ quarantine_info: {...} })]);
}

// 释放任务
async function releaseTask(taskId, action, options) {
  // 根据 action 设置新状态和 payload
  // release: status='queued', failure_count=0
  // retry_once: status='queued', max_retries=1
  // cancel: status='cancelled'
}

// 检查是否应该隔离
function checkShouldQuarantine(task, context) {
  // context: 'on_failure', 'on_create', 'on_dispatch'
  // 返回 { shouldQuarantine, reason, details }
}
```

---

## API 端点

### Alertness API

```bash
# 获取当前警觉状态
GET /api/brain/alertness
# 返回: { level, name, behavior, signals, override, history }

# 重新评估警觉级别
POST /api/brain/alertness/evaluate
# 返回: { level, score, signals, source }

# 手动覆盖警觉级别
POST /api/brain/alertness/override
# Body: { level: 0, reason: "Manual reset", duration_minutes: 30 }

# 清除手动覆盖
POST /api/brain/alertness/clear-override
```

### Quarantine API

```bash
# 获取隔离区状态
GET /api/brain/quarantine
# 返回: { stats, tasks, reasons, actions }

# 手动隔离任务
POST /api/brain/quarantine/:taskId
# Body: { reason: "manual", details: {...} }

# 释放任务
POST /api/brain/quarantine/:taskId/release
# Body: { action: "release" | "retry_once" | "cancel" | "modify" }

# 批量释放
POST /api/brain/quarantine/release-all
# Body: { action: "release", filter: { reason: "repeated_failure" } }
```

---

## 集成点

### 1. Tick Loop 集成 (tick.js)

```javascript
async function runTick() {
  // 1. 评估警觉级别
  await evaluateAndUpdate();
  const alertness = getAlertness();

  // 2. COMA 模式直接返回
  if (alertness.level === ALERTNESS_LEVELS.COMA) {
    console.log('[tick] COMA mode - skipping all operations');
    return { skipped: true, reason: 'coma_mode' };
  }

  // 3. 检查派发限制
  if (!canDispatch()) {
    return { skipped: true, reason: 'dispatch_disabled' };
  }

  // 4. 应用派发速率
  const rate = getDispatchRate();
  if (Math.random() > rate) {
    return { skipped: true, reason: 'rate_limited' };
  }

  // 5. 正常执行 tick...
}
```

### 2. Thalamus → Cortex 升级 (thalamus.js)

```javascript
async function processEvent(event) {
  // 1. 快速路由尝试
  const quickResult = quickRoute(event);
  if (quickResult) return quickResult;

  // 2. 调用 Sonnet 分析
  const decision = await analyzeEvent(event);

  // 3. 如果需要深度分析，升级到 Cortex
  if (decision.level === 2) {
    console.log('[thalamus] Escalating to Cortex (L2)...');
    const { analyzeDeep } = await import('./cortex.js');
    return await analyzeDeep(event, decision);
  }

  return decision;
}
```

### 3. 任务失败处理 (routes.js execution-callback)

```javascript
// 任务失败时检查是否需要隔离
if (status === 'failed') {
  const { handleTaskFailure } = await import('./quarantine.js');
  const result = await handleTaskFailure(taskId);

  if (result.quarantined) {
    console.log(`[callback] Task ${taskId} quarantined: ${result.result.reason}`);
  }
}
```

---

## 数据库表

### cecelia_events 表

用于记录系统事件（警觉变化、学习记录等）：

```sql
CREATE TABLE cecelia_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,      -- 'alertness_change', 'learning', etc.
  source TEXT,                    -- 'alertness', 'cortex', etc.
  payload JSONB,                  -- 事件详情
  created_at TIMESTAMP DEFAULT NOW()
);
```

### tasks 表扩展

任务表新增 `quarantined` 状态：

```sql
-- status 可选值
-- 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'quarantined'

-- 隔离信息存储在 payload 中
payload->'quarantine_info' = {
  "quarantined_at": "2026-02-06T03:00:00Z",
  "reason": "repeated_failure",
  "details": { "failure_count": 3 },
  "previous_status": "failed"
}
```

---

## 验证结果

### 模块导入验证

```
✅ cortex.js exports: callOpus, analyzeDeep, performRCA, ...
✅ alertness.js exports: canDispatch, getDispatchRate, evaluateAndUpdate, ...
✅ quarantine.js exports: quarantineTask, releaseTask, handleTaskFailure, ...
✅ thalamus.js exports: processEvent, quickRoute, analyzeEvent, ...
```

### API 验证

```bash
# Alertness API
curl http://localhost:5221/api/brain/alertness
# ✅ 返回 level, signals, behavior

# Quarantine API
curl http://localhost:5221/api/brain/quarantine
# ✅ 返回 stats, tasks, reasons, actions

# 手动覆盖
curl -X POST http://localhost:5221/api/brain/alertness/override \
  -d '{"level": 0, "reason": "test", "duration_minutes": 30}'
# ✅ 成功覆盖到 NORMAL
```

### 发现并修复的问题

| 问题 | 原因 | 修复 |
|------|------|------|
| `column "data" does not exist` | 代码用 `type`/`data`，表实际是 `event_type`/`payload` | PR #129 |
| `operator does not exist: text ->> unknown` | JSON 路径 `->>'x'->>'y'` 错误 | PR #129 |

---

## 当前系统状态

验证时系统处于 **EMERGENCY** 状态 (score=76)：

```json
{
  "level": "EMERGENCY",
  "signals": {
    "resource_pressure": 0.71,
    "high_failure_rate": 0.75,
    "consecutive_failures": 5
  }
}
```

**这是正确的保护行为** — 系统检测到：
- 531 个失败任务 vs 169 个完成任务 (76% 失败率)
- 5 次连续失败
- 71% 资源压力

系统自动降级到 EMERGENCY，限制派发速率到 25%，停止自动规划。

---

## 文件清单

| 文件 | 说明 | 状态 |
|------|------|------|
| `brain/src/cortex.js` | Opus 深度思考模块 | 新增 |
| `brain/src/alertness.js` | 4 级警觉系统 | 新增 |
| `brain/src/quarantine.js` | 任务隔离区 | 新增 |
| `brain/src/thalamus.js` | Sonnet 事件路由 | 修改（添加 Cortex 升级） |
| `brain/src/tick.js` | Tick 循环 | 修改（添加警觉检查） |
| `brain/src/routes.js` | API 路由 | 修改（添加新端点） |
| `brain/src/decision-executor.js` | 决策执行器 | 修改（添加 Cortex actions） |

---

## 核心设计原则

1. **LLM 只下指令，代码执行** — LLM 不能直接修改世界
2. **Action 白名单** — 所有可执行的动作必须预定义
3. **危险动作需要 safety 标记** — dangerous=true 的动作需要 safety=true
4. **纯代码实现自我保护** — Alertness 和 Quarantine 不依赖 LLM
5. **宁可错杀，不可放过** — 保护系统稳定优先

---

## 硬护栏（v2.0 增强）

基于 ChatGPT 审查反馈，添加以下关键护栏：

### 1. LLM 输出必须严格校验

```
所有 L1/L2 输出必须是 JSON 且通过 schema 校验
↓
校验失败 → 记录 llm_bad_output 事件 → 触发 Alertness 升级 → 降级到 L0 安全策略
```

**实现**：`thalamus.js::recordBadOutput()` 在解析/验证失败时记录事件

### 2. 派发限速可审计（令牌桶）

**问题**：Math.random() 限速不可预测、不可审计

**解决**：令牌桶限速

```javascript
// 每个级别的令牌补充速率（每分钟）
LEVEL_TOKEN_RATES = {
  NORMAL: { dispatch: 10, l1: 20, l2: 5 },
  ALERT: { dispatch: 5, l1: 10, l2: 3 },
  EMERGENCY: { dispatch: 2, l1: 5, l2: 1 },
  COMA: { dispatch: 0, l1: 0, l2: 0 },
};

// 使用方式
const result = tryConsumeToken('dispatch');
if (!result.allowed) {
  // 记录：为什么没派发，剩余 token 数
  console.log(`Rate limited: remaining=${result.remaining}`);
}
```

### 3. 信号封顶（防止叠加爆炸）

**问题**：连续失败 + 高失败率 + 资源压力 会叠加导致 score 爆炸，难以恢复

**解决**：每个信号设封顶值

```javascript
SIGNAL_CAPS = {
  consecutive_failures: 40,  // 最多 +40（4 次后封顶）
  high_failure_rate: 20,     // 最多 +20
  resource_pressure: 15,     // 最多 +15
};
```

### 4. 策略变更受限

**问题**：`adjust_strategy` 可能被 LLM 用来调成"疯狂派发/禁用熔断"

**解决**：

```javascript
// 白名单：只允许调整这些参数
ADJUSTABLE_PARAMS = {
  'dispatch_interval_ms': { min: 3000, max: 60000 },
  'max_concurrent_tasks': { min: 1, max: 10 },
  'task_timeout_ms': { min: 60000, max: 1800000 },
  'failure_rate_threshold': { min: 0.2, max: 0.5 },
};

// 禁止列表：绝对不能调整
FORBIDDEN_PARAMS = [
  'quarantine_threshold',
  'alertness_thresholds',
  'dangerous_action_list',
  'action_whitelist',
  'security_level',
];

// 调整幅度限制：每次最多 ±20%
MAX_CHANGE_RATIO = 0.2;

// 记录 previous_value 用于回滚
```

### 5. 危险模式检测增强

扩展 Quarantine 的 suspiciousPatterns，分三类：

| 类别 | 模式示例 | 严重性 |
|------|----------|--------|
| **Destructive** | `rm -rf /`, `DROP TABLE`, `mkfs` | critical |
| **Privilege Escalation** | `sudoers`, `authorized_keys`, `crontab` | critical |
| **Data Exfiltration** | `curl \| bash`, `base64 \| sh`, `nc -e` | critical |

所有匹配都强制 quarantine，必须人工 release
