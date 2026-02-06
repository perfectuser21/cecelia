# 最后 20% 稳定性清单

基于 ChatGPT 审查反馈，以下 6 个硬点必须补齐才能 24/7 放养。

---

## 1. 决策执行事务化 (Atomic Actions)

**问题**：actions 执行到一半失败，状态机出现脏状态

**解决方案**：

```javascript
// decision-executor.js
async function executeDecision(decision, context) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const action of decision.actions) {
      await executeAction(action, context, client);
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    await recordExecutionFailure(decision, err);
    return { success: false, error: err.message, rolled_back: true };
  } finally {
    client.release();
  }
}
```

**文件变更**：
- `brain/src/decision-executor.js` - 添加事务包装

---

## 2. 系统性 vs 任务性失败分流

**问题**：531 failed 可能是系统性原因，隔离任务没意义

**解决方案**：

```javascript
// 失败分类
const FAILURE_CLASS = {
  SYSTEMIC: 'systemic',           // DB/网络/权限/配额
  TASK_SPECIFIC: 'task_specific', // 任务本身问题
  UNKNOWN: 'unknown',
};

// 系统性失败判定标准
const SYSTEMIC_PATTERNS = [
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,  // 网络
  /permission denied|access denied/i,   // 权限
  /quota exceeded|rate limit/i,         // 配额
  /database.*connection|pool.*exhausted/i, // DB
  /ENOMEM|out of memory/i,              // 资源
];

function classifyFailure(error, task) {
  const errorStr = String(error);

  for (const pattern of SYSTEMIC_PATTERNS) {
    if (pattern.test(errorStr)) {
      return FAILURE_CLASS.SYSTEMIC;
    }
  }

  // 如果最近 5 个任务都失败于相同错误 → systemic
  // 如果只有这个任务失败 → task_specific
  return FAILURE_CLASS.UNKNOWN;
}
```

**行为映射**：
| failure_class | 行为 |
|---------------|------|
| systemic | 熔断派发，只允许 diagnosis/fix 任务 |
| task_specific | 走 quarantine |
| unknown | 降速 + 抽样诊断 |

**文件变更**：
- `brain/src/quarantine.js` - 添加 classifyFailure()
- `brain/src/tick.js` - systemic 时只派发诊断任务

---

## 3. 事件风暴保护 (Event Storm Guard)

**问题**：events 爆炸时队列堆积，系统"看起来像死了"

**解决方案**：

```javascript
// alertness.js 新增信号
async function collectSignals() {
  // ... 现有信号 ...

  // 8. 事件积压检测
  const backlogResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM cecelia_events
    WHERE created_at > NOW() - INTERVAL '5 minutes'
      AND event_type NOT IN ('heartbeat', 'alertness_change')
  `);
  const backlogSize = parseInt(backlogResult.rows[0].count);
  if (backlogSize > 50) {
    signals.event_backlog = backlogSize;
    totalScore += Math.min(20, Math.floor(backlogSize / 10));
  }
}

// 事件合并策略
async function deduplicateEvents() {
  // 按 task_id 聚合，只保留最新一条
  await pool.query(`
    DELETE FROM cecelia_events a
    USING cecelia_events b
    WHERE a.id < b.id
      AND a.payload->>'task_id' = b.payload->>'task_id'
      AND a.event_type = b.event_type
      AND a.created_at > NOW() - INTERVAL '5 minutes'
  `);
}
```

**文件变更**：
- `brain/src/alertness.js` - 添加 event_backlog 信号
- `brain/src/event-bus.js` - 添加 deduplicateEvents()

---

## 4. Alertness 衰减/窗口规则

**问题**：一次事故后系统长时间"抑郁"不恢复

**解决方案**：

```javascript
// 统计窗口配置
const SIGNAL_WINDOWS = {
  failure_rate: '1 hour',        // 1小时窗口
  consecutive_failures: '30 minutes', // 30分钟窗口
  llm_errors: '1 hour',
};

// 衰减函数：每 10 分钟 score * 0.8
const DECAY_INTERVAL_MS = 10 * 60 * 1000;
const DECAY_FACTOR = 0.8;

let _lastDecayAt = Date.now();

function applyDecay(score) {
  const now = Date.now();
  const intervals = Math.floor((now - _lastDecayAt) / DECAY_INTERVAL_MS);

  if (intervals > 0) {
    _lastDecayAt = now;
    return Math.floor(score * Math.pow(DECAY_FACTOR, intervals));
  }
  return score;
}

// 恢复门槛
const RECOVERY_THRESHOLDS = {
  COMA_TO_EMERGENCY: { failure_rate_below: 0.5, min_stable_minutes: 30 },
  EMERGENCY_TO_ALERT: { failure_rate_below: 0.3, min_stable_minutes: 15 },
  ALERT_TO_NORMAL: { failure_rate_below: 0.2, min_stable_minutes: 10 },
};
```

**文件变更**：
- `brain/src/alertness.js` - 添加衰减逻辑和恢复门槛

---

## 5. 危险动作两阶段提交 (Two-man Rule)

**问题**：dangerous=true 的 action 可能直接执行

**解决方案**：

```javascript
// decision-executor.js
async function executeAction(action, context, client) {
  const config = ACTION_WHITELIST[action.type] || CORTEX_ACTION_WHITELIST[action.type];

  if (config?.dangerous) {
    // 危险动作进入待审批队列，不直接执行
    await client.query(`
      INSERT INTO pending_actions (
        action_type, params, context, decision_id, created_at, status
      ) VALUES ($1, $2, $3, $4, NOW(), 'pending_approval')
    `, [action.type, JSON.stringify(action.params), JSON.stringify(context), context.decision_id]);

    console.log(`[executor] Dangerous action queued for approval: ${action.type}`);
    return { success: true, pending_approval: true };
  }

  // 非危险动作正常执行
  return await handlers[action.type](action.params, context, client);
}
```

**API 端点**：
```bash
# 查看待审批动作
GET /api/brain/pending-actions

# 批准动作
POST /api/brain/pending-actions/:id/approve

# 拒绝动作
POST /api/brain/pending-actions/:id/reject
```

**数据库变更**：
```sql
CREATE TABLE pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  params JSONB,
  context JSONB,
  decision_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'pending_approval', -- pending_approval, approved, rejected, expired
  reviewed_by TEXT,
  reviewed_at TIMESTAMP
);
```

**文件变更**：
- `brain/migrations/007_pending_actions.sql` - 新表
- `brain/src/decision-executor.js` - 危险动作入队
- `brain/src/routes.js` - 审批 API

---

## 6. 模型调用失败 vs 输出错误分开处理

**问题**：API 挂了还在重试，输出乱了还在相信

**解决方案**：

```javascript
// 分开统计
const LLM_ERROR_TYPES = {
  API_ERROR: 'llm_api_error',       // 网络/认证/配额
  BAD_OUTPUT: 'llm_bad_output',     // 解析/验证失败
  TIMEOUT: 'llm_timeout',           // 超时
};

// 不同行为
const LLM_ERROR_BEHAVIORS = {
  [LLM_ERROR_TYPES.API_ERROR]: {
    action: 'switch_provider_or_l0',  // 切换 provider 或降级 L0
    threshold: 3,                      // 1小时内3次触发
  },
  [LLM_ERROR_TYPES.BAD_OUTPUT]: {
    action: 'reduce_l2_weight',       // 降低 L2 权重，强制更严格 schema
    threshold: 5,
  },
  [LLM_ERROR_TYPES.TIMEOUT]: {
    action: 'increase_timeout_or_skip', // 增加超时或跳过
    threshold: 2,
  },
};

// 在 thalamus.js 中
async function callSonnet(prompt) {
  try {
    const response = await fetch(...);
    if (!response.ok) {
      await recordLLMError(LLM_ERROR_TYPES.API_ERROR, response.status);
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError' || err.message.includes('timeout')) {
      await recordLLMError(LLM_ERROR_TYPES.TIMEOUT, err.message);
    } else {
      await recordLLMError(LLM_ERROR_TYPES.API_ERROR, err.message);
    }
    throw err;
  }
}
```

**文件变更**：
- `brain/src/thalamus.js` - 分类记录错误
- `brain/src/cortex.js` - 同上
- `brain/src/alertness.js` - 分开统计和处理

---

## 7. 运行策略章节 (Operational Policy)

### 各级别允许的 task_type

| Level | 允许派发的 task_type |
|-------|---------------------|
| NORMAL | 全部 |
| ALERT | 全部（但速率降低） |
| EMERGENCY | 仅 diagnosis, fix, review |
| COMA | 无（只保留心跳） |

### 系统性失败判定标准

满足以下任意条件视为 systemic：
1. 错误消息匹配 SYSTEMIC_PATTERNS
2. 最近 5 个任务失败于相同错误类型
3. 熔断器处于 OPEN 状态

### Backlog 合并策略

- 同一 task_id 的相同 event_type，只保留最新一条
- 5 分钟内超过 50 条未处理事件，触发 ALERT

### Dangerous Action 审批流程

1. LLM 输出 dangerous action → 入队 pending_actions
2. 系统发送通知（WebSocket / 邮件）
3. 管理员通过 API approve/reject
4. 超过 24 小时自动 expire

### 恢复条件

| 从 | 到 | 条件 |
|----|----|----|
| COMA | EMERGENCY | 手动覆盖 或 score < 70 持续 30 分钟 |
| EMERGENCY | ALERT | failure_rate < 30% 持续 15 分钟 |
| ALERT | NORMAL | failure_rate < 20% 持续 10 分钟 |

---

## 实施优先级

| 优先级 | 任务 | 预估工作量 |
|--------|------|-----------|
| P0 | 1. 决策执行事务化 | 1h |
| P0 | 5. 危险动作两阶段提交 | 2h |
| P1 | 2. 失败分类分流 | 2h |
| P1 | 4. Alertness 衰减规则 | 1h |
| P2 | 3. 事件风暴保护 | 1h |
| P2 | 6. LLM 错误分开处理 | 1h |
| P2 | 7. 运行策略文档 | 0.5h |

**总预估**：8.5 小时
