# Cecelia Core: ACTION WHITELIST & DECISION-EXECUTION FLOW

**Created**: 2026-02-17
**Analyzed Files**: thalamus.js, actions.js, tick.js, executor.js, decision-executor.js, decision.js
**Test Files**: __tests__/thalamus.test.js, __tests__/decision-executor.test.js

---

## 1. ACTION_WHITELIST - Complete Structure

### 1.1 Definition Location
**File**: `/home/xx/perfect21/cecelia/core/brain/src/thalamus.js` (lines 142-173)

### 1.2 Whitelist Definition

```javascript
const ACTION_WHITELIST = {
  // 任务操作
  'dispatch_task': { dangerous: false, description: '派发任务' },
  'create_task': { dangerous: false, description: '创建任务' },
  'cancel_task': { dangerous: false, description: '取消任务' },
  'retry_task': { dangerous: false, description: '重试任务' },
  'reprioritize_task': { dangerous: false, description: '调整优先级' },

  // OKR 操作
  'create_okr': { dangerous: false, description: '创建 OKR' },
  'update_okr_progress': { dangerous: false, description: '更新 OKR 进度' },
  'assign_to_autumnrice': { dangerous: false, description: '交给秋米拆解' },

  // 通知操作
  'notify_user': { dangerous: false, description: '通知用户' },
  'log_event': { dangerous: false, description: '记录事件' },

  // 升级操作
  'escalate_to_brain': { dangerous: false, description: '升级到 Brain LLM (Opus)' },
  'request_human_review': { dangerous: true, description: '请求人工确认' },

  // 分析操作
  'analyze_failure': { dangerous: false, description: '分析失败原因' },
  'predict_progress': { dangerous: false, description: '预测进度' },

  // 规划操作
  'create_proposal': { dangerous: false, description: '创建计划提案' },

  // 系统操作
  'no_action': { dangerous: false, description: '不需要操作' },
  'fallback_to_tick': { dangerous: false, description: '降级到纯代码 Tick' },
};
```

### 1.3 Action Properties

Each action has:
- **type** (string): Unique identifier (must be whitelisted)
- **dangerous** (boolean): Flag for safety-critical actions (only `request_human_review` is true)
- **description** (string): Human-readable explanation

**Total Actions**: 17 (16 safe + 1 dangerous)

---

## 2. DECISION STRUCTURE (from thalamus.js)

### 2.1 Decision Schema

```javascript
/**
 * Decision 结构
 * @typedef {Object} Decision
 * @property {0|1|2} level - 唤醒级别 (0=脑干/反射, 1=快速判断, 2=深度思考)
 * @property {Action[]} actions - 要执行的动作列表
 * @property {string} rationale - 决策原因（给人看）
 * @property {number} confidence - 置信度 0-1
 * @property {boolean} safety - 是否需要人确认
 */
```

### 2.2 Action Structure

```javascript
/**
 * Action 结构
 * @typedef {Object} Action
 * @property {string} type - 动作类型（必须在白名单内）
 * @property {Object} params - 动作参数
 */
```

### 2.3 Decision Example

```json
{
  "level": 1,
  "actions": [
    {"type": "dispatch_task", "params": {"trigger": "tick"}},
    {"type": "log_event", "params": {"event_type": "dispatch_start"}}
  ],
  "rationale": "Normal task dispatch in steady state",
  "confidence": 0.95,
  "safety": false
}
```

---

## 3. VALIDATION & SAFETY

### 3.1 validateDecision() Function

**Location**: `thalamus.js` (lines 184-226)

**Checks**:
1. ✅ level must be 0, 1, or 2
2. ✅ actions must be an array
3. ✅ rationale must be non-empty string
4. ✅ confidence must be number between 0-1
5. ✅ safety must be boolean
6. ✅ each action.type must be in ACTION_WHITELIST
7. ✅ each action must have type field

**Returns**: `{ valid: boolean, errors: string[] }`

### 3.2 hasDangerousActions() Function

**Location**: `thalamus.js` (lines 233-240)

```javascript
function hasDangerousActions(decision) {
  if (!Array.isArray(decision.actions)) return false;
  
  return decision.actions.some(action => {
    const config = ACTION_WHITELIST[action.type];
    return config?.dangerous === true;
  });
}
```

**Returns**: `boolean` - true if any action has `dangerous: true`

---

## 4. ACTION FLOW: Decision → Execution

### 4.1 Complete Flow Diagram

```
EVENT
  ↓
[Thalamus Process] (thalamus.js)
  - Quick Route (Level 0, pure code)
  - Sonnet Analysis (Level 1, fast decision)
  - Cortex Escalation (Level 2, deep analysis)
  ↓
Decision (validated)
  ├─ level: 0|1|2
  ├─ actions: [Action, ...]
  ├─ rationale: string
  ├─ confidence: 0.0-1.0
  └─ safety: boolean
  ↓
[Decision Executor] (decision-executor.js)
  - validateDecision() 再次验证
  - hasDangerousActions() 检查是否需要人工确认
  - 按顺序执行 actions
  ↓
[Action Handlers] (decision-executor.js 内的 actionHandlers 对象)
  - 每个 action.type 映射到处理函数
  - 执行并返回结果
  ↓
[Execution Report]
  ├─ actions_executed: number
  ├─ actions_failed: number
  ├─ results: { action_index: result }
  └─ timestamp: ISO8601
```

### 4.2 Key Entry Points

#### a) Thalamus Entry: `processEvent(event)` 

**Location**: `thalamus.js` (lines 507-540)

```javascript
async function processEvent(event) {
  // 1. Try quick route (L0)
  const quickDecision = quickRoute(event);
  if (quickDecision) {
    console.log(`[thalamus] Quick route (L0): ${quickDecision.rationale}`);
    return quickDecision;
  }

  // 2. Call Sonnet for analysis (L1)
  const decision = await analyzeEvent(event);
  
  // 3. If Level 2, escalate to Cortex (L2)
  if (decision.level === 2) {
    try {
      const { analyzeDeep } = await import('./cortex.js');
      const cortexDecision = await analyzeDeep(event, decision);
      return cortexDecision;
    } catch (err) {
      return decision; // fallback to L1
    }
  }
  
  return decision;
}
```

**Flow**:
1. Try `quickRoute(event)` - returns Decision or null
2. If null, call `analyzeEvent(event)` → Sonnet API
3. If decision.level === 2, escalate to Cortex (Opus)
4. Return final Decision

**Parameters**: 
- `event.type` - EVENT_TYPES constant
- `event.task` - optional task object
- `event.failure_info` - optional failure details

#### b) Decision Execution: `executeDecision(decision)`

**Location**: `decision-executor.js` (lines 350+)

```javascript
export async function executeDecision(decision) {
  // 1. Validate
  const validation = validateDecision(decision);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      actions_executed: [],
      actions_failed: []
    };
  }

  // 2. Check for dangerous actions
  if (hasDangerousActions(decision)) {
    console.log('[executor] Decision contains dangerous actions, requires human review');
    // Could implement escalation here
  }

  // 3. Execute actions
  const results = [];
  const failed = [];
  
  for (let i = 0; i < decision.actions.length; i++) {
    const action = decision.actions[i];
    try {
      const handler = actionHandlers[action.type];
      if (!handler) {
        throw new Error(`No handler for action: ${action.type}`);
      }
      
      const result = await handler(action.params, { decision });
      results.push({ index: i, type: action.type, result });
    } catch (err) {
      console.error(`[executor] Action failed: ${action.type}`, err.message);
      failed.push({ index: i, type: action.type, error: err.message });
    }
  }

  return {
    success: failed.length === 0,
    actions_executed: results.length,
    actions_failed: failed.length,
    results: results,
    failed: failed
  };
}
```

---

## 5. MEMORY APIS (from actions.js + learning.js)

### 5.1 Memory Read/Write Operations

#### a) Working Memory (actions.js)

```javascript
async function setMemory({ key, value }) {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [key, value]);
  
  return { success: true, key, value };
}
```

**Usage**: Store temporary state between ticks

#### b) Learnings (learning.js)

```javascript
export async function recordLearning(analysis) {
  const result = await pool.query(`
    INSERT INTO learnings (
      title, category, trigger_event, content, 
      strategy_adjustments, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [...]);
  
  return result.rows[0];
}
```

**Usage**: Record system learnings from Cortex RCA analysis

#### c) Search Learnings (thalamus.js)

```javascript
const learnings = await searchRelevantLearnings({
  task_type: event.task?.task_type,
  failure_class: event.failure_info?.class,
  event_type: event.type
}, 20);
```

**Returns**: Top 20 relevant learnings (with relevance_score)

### 5.2 Table Schemas

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `working_memory` | Tick state, counters | key, value_json, updated_at |
| `learnings` | System learnings from RCA | id, title, category, content, strategy_adjustments |
| `cecelia_events` | Event audit trail | event_type, source, payload, timestamp |
| `decision_log` | Decision history | trigger, input_summary, llm_output_json, action_result_json |
| `brain_config` | System configuration | key, value, updated_at, metadata |
| `tasks` | Task state + payload | id, status, payload, title, description, priority |

---

## 6. ACTION HANDLERS (from decision-executor.js)

### 6.1 Handler Dispatch

**Location**: `decision-executor.js` (lines 24-349)

```javascript
const actionHandlers = {
  dispatch_task: async (params, context) => { ... },
  create_task: async (params, context) => { ... },
  cancel_task: async (params, context) => { ... },
  // ... 16 more handlers
};
```

### 6.2 Handler Signature

```javascript
async handler(params, context)
  → Promise<{ success: boolean, [custom_fields]: any }>
```

**Context Parameters**:
- `context.decision` - Original Decision object
- Can be extended for audit trail

### 6.3 Core Handlers

#### a) dispatch_task

**Calls**: `tick.js:dispatchNextTask(goalIds)`

**Returns**: `{ success, dispatched: {...} }`

#### b) create_task

**Calls**: `actions.js:createTask({ title, description, task_type, ... })`

**Returns**: `{ success, task_id }`

**Validates**: 
- goal_id required for non-system tasks
- Deduplication with existing queued/in_progress tasks

#### c) create_okr

**Calls**: INSERT goal into goals table with type='global_okr'

**Returns**: `{ success, goal_id }`

#### d) assign_to_autumnrice

**Effect**: Creates decomposition task with `payload.decomposition = 'true'`

**Returns**: `{ success, task_id }`

#### e) escalate_to_brain

**Effect**: Creates 'talk' type task for Brain LLM (Opus) processing

**Returns**: `{ success, task_id }`

---

## 7. TICK LOOP INTEGRATION (from tick.js)

### 7.1 Thalamus in Tick Flow

**Location**: `tick.js` (lines 895-936)

```javascript
// 0. Thalamus: Analyze tick event
const tickEvent = {
  type: EVENT_TYPES.TICK,
  timestamp: now.toISOString(),
  has_anomaly: false  // Will be set to true if issues detected
};

thalamusResult = await thalamusProcessEvent(tickEvent);

// If thalamus returns special action, execute it
const thalamusAction = thalamusResult.actions?.[0]?.type;
if (thalamusAction && thalamusAction !== 'fallback_to_tick' && thalamusAction !== 'no_action') {
  console.log(`[tick] Thalamus decision: ${thalamusAction}`);
  
  // Execute thalamus decision
  const execReport = await executeThalamusDecision(thalamusResult);
  
  actionsTaken.push({
    action: 'thalamus',
    level: thalamusResult.level,
    thalamus_actions: thalamusResult.actions.map(a => a.type),
    executed: execReport.actions_executed.length,
    failed: execReport.actions_failed.length
  });
}
```

### 7.2 Tick Constants

```javascript
const TICK_INTERVAL_MINUTES = 5;              // 5 min between ticks
const TICK_LOOP_INTERVAL_MS = 5000;           // 5 sec loop polling
const TICK_TIMEOUT_MS = 60 * 1000;            // 60 sec max exec time
```

---

## 8. QUICK ROUTE (Fast Path - No LLM Call)

### 8.1 quickRoute() Function

**Location**: `thalamus.js` (lines 454-490)

```javascript
function quickRoute(event) {
  // HEARTBEAT → no_action
  if (event.type === EVENT_TYPES.HEARTBEAT) {
    return {
      level: 0,
      actions: [{ type: 'no_action', params: {} }],
      rationale: '心跳事件，无需处理',
      confidence: 1.0,
      safety: false
    };
  }

  // NORMAL TICK → fallback_to_tick
  if (event.type === EVENT_TYPES.TICK && !event.has_anomaly) {
    return {
      level: 0,
      actions: [{ type: 'fallback_to_tick', params: {} }],
      rationale: '常规 Tick，代码处理',
      confidence: 1.0,
      safety: false
    };
  }

  // TASK_COMPLETED (no issues) → dispatch_task
  if (event.type === EVENT_TYPES.TASK_COMPLETED && !event.has_issues) {
    return {
      level: 0,
      actions: [{ type: 'dispatch_task', params: { trigger: 'task_completed' } }],
      rationale: '任务完成，派发下一个',
      confidence: 1.0,
      safety: false
    };
  }

  // All other cases → call Sonnet (return null)
  return null;
}
```

**Returns**: 
- `Decision` object for simple cases (L0)
- `null` to trigger Sonnet analysis (L1)

### 8.2 Event Types

**Location**: `thalamus.js` (lines 112-136)

```javascript
const EVENT_TYPES = {
  // 任务相关
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  TASK_TIMEOUT: 'task_timeout',
  TASK_CREATED: 'task_created',

  // 用户相关
  USER_MESSAGE: 'user_message',
  USER_COMMAND: 'user_command',

  // 系统相关
  TICK: 'tick',
  HEARTBEAT: 'heartbeat',
  RESOURCE_LOW: 'resource_low',

  // OKR 相关
  OKR_CREATED: 'okr_created',
  OKR_PROGRESS_UPDATE: 'okr_progress_update',
  OKR_BLOCKED: 'okr_blocked',

  // 汇报相关
  DEPARTMENT_REPORT: 'department_report',
  EXCEPTION_REPORT: 'exception_report',
};
```

---

## 9. ERROR HANDLING

### 9.1 LLM Error Classification

**Location**: `thalamus.js` (lines 29-61)

```javascript
const LLM_ERROR_TYPE = {
  API_ERROR: 'llm_api_error',      // Network/quota/service errors
  BAD_OUTPUT: 'llm_bad_output',    // Parse/validation errors
  TIMEOUT: 'llm_timeout',          // Timeout errors
};

function classifyLLMError(error) {
  const msg = String(error?.message || error || '');

  // API errors
  if (/API error|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|5\d{2}/i.test(msg)) {
    return LLM_ERROR_TYPE.API_ERROR;
  }
  if (/rate.limit|429|quota|too many requests/i.test(msg)) {
    return LLM_ERROR_TYPE.API_ERROR;
  }

  // Timeout
  if (/timeout|timed out|aborted/i.test(msg)) {
    return LLM_ERROR_TYPE.TIMEOUT;
  }

  // Default: bad output
  return LLM_ERROR_TYPE.BAD_OUTPUT;
}
```

### 9.2 Fallback Decision

**Location**: `thalamus.js` (lines 433-442)

```javascript
function createFallbackDecision(event, reason) {
  return {
    level: 0,
    actions: [{ type: 'fallback_to_tick', params: { event_type: event.type } }],
    rationale: `丘脑降级：${reason}`,
    confidence: 0.5,
    safety: false,
    _fallback: true
  };
}
```

**Used When**:
- Sonnet API fails
- Decision validation fails
- JSON parsing fails

---

## 10. TEST FILE LOCATIONS

### 10.1 Thalamus Tests

**File**: `/home/xx/perfect21/cecelia/core/brain/src/__tests__/thalamus.test.js`

**Test Suites**:
- `validateDecision()` - 8 test cases
- `hasDangerousActions()` - 4 test cases
- `quickRoute()` - 7 test cases
- `classifyLLMError()` - error type classification

**Key Test Cases**:
- Valid decision passes validation
- Invalid level/actions/rationale/confidence are caught
- Whitelist enforcement
- Quick routes for common events
- Fallback to Sonnet for complex events

### 10.2 Decision Executor Tests

**File**: `/home/xx/perfect21/cecelia/core/brain/src/__tests__/decision-executor.test.js`

---

## 11. TOKEN COST TRACKING

**Location**: `thalamus.js` (lines 246-278)

```javascript
const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { in: 3.0 / 1_000_000, out: 15.0 / 1_000_000 },
  'claude-opus-4-20250514': { in: 15.0 / 1_000_000, out: 75.0 / 1_000_000 },
  'claude-haiku-4-20250514': { in: 0.8 / 1_000_000, out: 4.0 / 1_000_000 },
};

function calculateCost(usage, model) {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out;
}

async function recordTokenUsage(source, model, usage, context = {}) {
  // Records cost to cecelia_events table
}
```

---

## 12. PROMPT INJECTION (Learnings)

**Location**: `thalamus.js` (lines 324-348)

```javascript
// Build #1: Inject historical learnings (semantic search)
const learnings = await searchRelevantLearnings({
  task_type: event.task?.task_type,
  failure_class: event.failure_info?.class,
  event_type: event.type
}, 20);

let learningBlock = '';
if (learnings.length > 0) {
  learningBlock = `\n\n## 系统历史经验（参考，按相关性排序）\n${learnings.map((l, i) => 
    `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score || 0}): ${(l.content || '').slice(0, 200)}`
  ).join('\n')}\n`;
}

const prompt = `${THALAMUS_PROMPT}${learningBlock}\n\n\`\`\`json\n${eventJson}\n\`\`\``;
```

**Effect**: Sonnet gets context from past failures/learnings to make better decisions

---

## 13. CORTEX ACTION WHITELIST (from cortex.js)

**Location**: `decision-executor.js` imports `CORTEX_ACTION_WHITELIST` from cortex.js

**Additional Actions** (beyond Thalamus):
- `adjust_strategy`: Safely adjust system parameters (whitelisted only)

---

## 14. KEY ENTRY POINTS FOR INTEGRATION

### Use Thalamus When:
1. Event received (task complete, failure, user message)
2. Tick loop starts with anomaly detected
3. Complex decision needed beyond code rules

### Use Decision Executor When:
1. Decision object ready for action execution
2. Need to convert LLM output to system changes
3. Audit trail of LLM decisions

### Use Actions.js When:
1. Direct task/goal manipulation needed
2. Creating new entities (tasks, initiatives, projects)
3. Batch operations

---

## 15. SUMMARY

| Component | Purpose | LLM Model | Speed |
|-----------|---------|-----------|-------|
| **Thalamus** | Event routing & quick decisions | Sonnet/Opus | 1-5s |
| **Decision Executor** | Action execution | Code | <100ms |
| **Actions.js** | Database operations | Code | <500ms |
| **Quick Route** | Fast path (no LLM) | Code | <1ms |
| **Cortex** | Deep analysis (L2) | Opus | 5-30s |

---

**Total Actions in Whitelist**: 17
**Models Used**: Sonnet (L1), Opus (L2), Code (L0)
**Primary Storage**: PostgreSQL
**Primary Auditing**: cecelia_events table

