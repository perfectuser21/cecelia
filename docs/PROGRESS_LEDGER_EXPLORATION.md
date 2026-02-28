# Progress Ledger Inner Loop — 深度探索报告

## 执行日期
2026-02-27

## 一、核心发现

### 1. 现有的进展追踪机制

系统中已存在三层进展追踪体系：

#### 1.1 run_events 表（迁移 023）
- **位置**：`packages/brain/migrations/023_add_run_events_observability_v1.1.sql`
- **用途**：统一事件流观测层（所有执行层写入）
- **关键字段**：
  - `task_id` / `run_id` / `span_id` / `parent_span_id`：执行链追踪
  - `layer` (L0-L4)：执行层（脑干/丘脑/皮层/执行器/浏览器/工件）
  - `step_name`：步骤名称（connect_cdp, upload_file, fill_title 等）
  - `status`：queued, running, blocked, retrying, success, failed, canceled
  - `reason_code` / `reason_kind`：失败分类（TRANSIENT/PERSISTENT/RESOURCE/CONFIG）
  - `heartbeat_ts`：用于检测卡住/僵尸运行
  - `input_summary` / `output_summary` / `artifacts`：步骤输入/输出/工件
  - `metadata`：灵活额外数据
  
- **索引优化**：
  - `idx_run_events_task_run`：(task_id, run_id) 用于快速查询任务所有步骤
  - `idx_run_events_status`：按状态快速查询
  - `idx_run_events_heartbeat`：检测卡住的运行
  - GIN 索引：artifacts、metadata 的 JSON 查询

- **视图**：
  - `v_active_runs`：当前运行的任务（带健康状态）
  - `v_run_summary`：聚合统计（成功/失败/运行中的 span 计数）
  - `v_top_failure_reasons`：失败原因排名
  - `v_run_last_alive_span`：最后活跃的 span（检测卡住）

#### 1.2 tasks 表进展字段
- **payload 字段**（JSONB）：
  - `last_run_result`：最后一次执行的结果
  - `run_status`：执行状态
  - `pr_url`：PR 链接
  - `findings`：执行发现（供后续任务使用）
  
- **标准字段**：
  - `status`：queued, in_progress, completed, failed, completed_no_pr
  - `started_at` / `completed_at`：时间戳
  - `estimated_hours`：预估时长
  
- **执行回调**（`POST /api/brain/execution-callback`）：
  - 原子性更新：status 变更 + payload 更新 + findings 记录
  - 支持幂等性（检查 status='in_progress' 后才更新）

#### 1.3 trace.js 步骤追踪 SDK
- **API**：
  - `traceStep(options)`：创建单个步骤追踪
  - `.start()`：开始步骤（插入 run_events）
  - `.heartbeat()`：更新心跳（每 30s）
  - `.end({status, outputSummary, error})`：结束步骤
  - `.addArtifact(type, backend, key)`：添加工件
  
- **特点**：
  - 自动错误分类（TRANSIENT/PERSISTENT/RESOURCE/CONFIG）
  - 敏感信息自动脱敏（password, token, secret 等）
  - OpenTelemetry 兼容的 span 模型
  - Hard Boundary 约束：run_id 只在 L0 生成，下游继承

### 2. Tick 循环中的进展评估

#### 2.1 Tick 循环结构（`tick.js`）
- **心跳间隔**：
  - 循环：每 5 秒检查一次（TICK_LOOP_INTERVAL_MS）
  - 执行：每 5 分钟执行一次（TICK_INTERVAL_MINUTES）
  - 限流：通过 `_lastExecuteTime` 防止重复执行

- **核心步骤**：
  ```
  0. 警觉等级评估 → 调整行为（PANIC 模式跳过一切）
  1. 丘脑事件路由 → 快速判断或升级到皮层
  2. PR Plans 完成检查（纯 SQL，检查 pr_plans.status）
  3. 定期清理（每小时：数据库清理、知识归档、提案过期清理）
  4. 定期检查（每小时）：
     - Codex 免疫检查（确保 codex_qa 任务存在）
     - Layer 2 运行健康监控（4 项 SQL 检查）
     - 知识流档案化（90 天前已消化的）
  5. Initiative 和 Project 闭环检查（每次 tick）
  6. 决策引擎：对比目标进度 → 生成决策 → 执行决策
  7. 焦点选择（selectDailyFocus）
  8. 存活探针（probeTaskLiveness）：验证 in_progress 任务进程活着
  9. 看门狗（/proc 采样）
  10. 规划（planNextTask）：if queued=0 → 创建新任务
  11. 派发循环（fill all available slots）
  ```

#### 2.2 进展相关的检查
- **PR Plans 完成检查**（`planner.js`）：
  - 检查 pr_plans 表中 status='in_progress' 的计划
  - 查询关联 tasks：如果所有 task 都 completed/failed → pr_plan 标记为 completed
  
- **Initiative 闭环检查**（`initiative-closer.js`）：
  - 查询 initiatives（type='initiative'）
  - 检查关联的 tasks：if all completed → initiative 标记为 completed
  - Project 闭环：if all child initiatives completed → project 标记为 completed

- **健康监控**（`health-monitor.js`，每小时）：
  - 4 项检查：stuck tasks, resource pressure, cascade failures, pattern anomalies

#### 2.3 任务状态管理
- **执行回调流程**（`routes.js:2253`）：
  ```
  1. 接收 execution-callback（task_id, status, result, duration_ms, iterations）
  2. 原子操作（BEGIN TRANSACTION）：
     - 更新 tasks.status（in_progress → completed/failed）
     - 追加 payload 数据（last_run_result, findings）
     - 记录到 decision_log
     - COMMIT
  3. 清理 executor 的 activeProcesses 注册表
  4. 事件发射：task_completed、circuit_breaker success、WebSocket 广播
  5. 触发丘脑决策（thalamus）
  ```

---

## 二、Progress Ledger 应该集成的位置

### 1. 数据库层（新迁移）

#### 1.1 新表：progress_ledger
```sql
CREATE TABLE IF NOT EXISTS progress_ledger (
    -- 主键
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- 关联
    task_id uuid NOT NULL REFERENCES tasks(id),
    run_id uuid NOT NULL,              -- 对应的 run_id
    
    -- 进展步骤
    step_sequence integer NOT NULL,     -- 步骤序号（1, 2, 3...）
    step_name text NOT NULL,            -- 步骤名称（e.g., "validate_input", "execute_logic", "verify_output"）
    step_type text NOT NULL,            -- 步骤类型（exploratory, execution, validation, integration）
    
    -- 状态与执行
    status text NOT NULL,               -- queued, in_progress, completed, failed, skipped
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms integer,                -- 执行时长
    
    -- 进展内容
    description text,                   -- 步骤描述
    checkpoint_id text,                 -- 检查点标识（用于恢复）
    input_summary jsonb,                -- 输入数据
    output_summary jsonb,               -- 输出数据
    findings text,                      -- 发现/日志
    
    -- 失败处理
    error_message text,
    error_code text,
    retry_count integer DEFAULT 0,
    recovery_attempted boolean DEFAULT false,
    
    -- 关联工件
    artifacts jsonb,                    -- {"screenshot_id": "...", "log_id": "..."}
    
    -- 元数据
    metadata jsonb,
    confidence_score numeric(3,2),      -- 0.0-1.0，对步骤成功的信心
    
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
```

#### 1.2 新表：progress_ledger_review
```sql
CREATE TABLE IF NOT EXISTS progress_ledger_review (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- 关联
    task_id uuid NOT NULL REFERENCES tasks(id),
    run_id uuid NOT NULL,
    ledger_entry_id uuid NOT NULL REFERENCES progress_ledger(id),
    
    -- Tick 评估
    tick_id uuid,                       -- 本次 tick 的标识
    tick_number integer NOT NULL,       -- 第几个 tick
    evaluated_at timestamp with time zone DEFAULT now(),
    
    -- 评估内容
    review_action text,                 -- continue, retry, escalate, pause, abandon
    review_reason text,                 -- 评估理由
    next_step_recommendation text,      -- 下一步建议
    risk_assessment text,               -- 风险评估（low/medium/high）
    confidence_score numeric(3,2),      -- 评估信心
    
    -- AI 决策
    ai_model text,                      -- thalamus/cortex/decision-engine
    ai_output jsonb,                    -- 原始 AI 输出
    ai_decision jsonb,                  -- 最终决策（action + rationale）
    
    created_at timestamp with time zone DEFAULT now()
);
```

#### 1.3 索引与视图

```sql
-- 索引
CREATE INDEX idx_progress_ledger_task_run 
    ON progress_ledger(task_id, run_id);
CREATE INDEX idx_progress_ledger_status 
    ON progress_ledger(status);
CREATE INDEX idx_progress_ledger_task_sequence 
    ON progress_ledger(task_id, step_sequence);
CREATE INDEX idx_progress_ledger_created_at 
    ON progress_ledger(created_at DESC);

CREATE INDEX idx_progress_ledger_review_task_run 
    ON progress_ledger_review(task_id, run_id);
CREATE INDEX idx_progress_ledger_review_tick 
    ON progress_ledger_review(tick_number);
CREATE INDEX idx_progress_ledger_review_evaluated_at 
    ON progress_ledger_review(evaluated_at DESC);

-- 视图：任务进展汇总
CREATE OR REPLACE VIEW v_task_progress_summary AS
SELECT
    pl.task_id,
    pl.run_id,
    COUNT(*) as total_steps,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_steps,
    COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_steps,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_steps,
    MIN(pl.started_at) as first_step_start,
    MAX(pl.completed_at) as last_step_end,
    EXTRACT(EPOCH FROM (MAX(pl.completed_at) - MIN(pl.started_at)))::integer as total_duration_seconds,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*), 2) as completion_rate
FROM progress_ledger pl
GROUP BY pl.task_id, pl.run_id;

-- 视图：最新进展步骤（用于仪表板）
CREATE OR REPLACE VIEW v_latest_progress_step AS
SELECT DISTINCT ON (task_id, run_id)
    task_id,
    run_id,
    step_sequence,
    step_name,
    status,
    started_at,
    completed_at,
    findings,
    created_at
FROM progress_ledger
ORDER BY task_id, run_id, step_sequence DESC;
```

---

### 2. Brain 服务集成

#### 2.1 新文件：`progress-ledger.js`

关键模块：

```javascript
/**
 * progress-ledger.js - Progress Ledger 管理
 * 
 * 职责：
 * 1. 记录任务执行步骤
 * 2. 提供进展查询 API
 * 3. 与 tick 循环集成进行评估
 */

// 核心 API
export async function recordProgressStep(taskId, runId, step)
  // step: { sequence, name, type, status, inputSummary, outputSummary, findings, errorCode }
  // 返回：ledger_entry_id

export async function getProgressSteps(taskId, runId)
  // 返回：该任务所有步骤的完整历史

export async function updateProgressStep(ledgerId, updates)
  // 更新某一步的状态（completed_at, findings, error_message 等）

export async function getTaskProgressSummary(taskId)
  // 返回：任务进展汇总（完成率、耗时、当前步骤等）

export async function getLatestProgressByTask(taskId)
  // 返回：该任务的最新进展（仪表板用）

// Tick 循环集成
export async function evaluateProgressInTick(tickId, tickNumber)
  // 1. 查询所有 in_progress 的 tasks
  // 2. 对每个 task 查询 progress_ledger 的最新步骤
  // 3. 分析进展速度、风险
  // 4. 生成评估记录到 progress_ledger_review

export async function getProgressAnomalies(hoursWindow = 1)
  // 检测异常：
  // - 步骤耗时过长
  // - 失败重试过多
  // - 进展停滞
  // 返回：需要关注的任务列表
```

#### 2.2 Tick 循环集成点（`tick.js`）

在 `executeTick()` 中添加新的评估阶段：

```javascript
// 在现有步骤之间，约在步骤 4 之后添加：

// 4.1 Progress Ledger 评估（与 periodic cleanup 同频 1 小时）
if (cleanupElapsed >= CLEANUP_INTERVAL_MS) {
  try {
    const { evaluateProgressInTick, getProgressAnomalies } = await import('./progress-ledger.js');
    
    // 本次 tick 的标识
    const tickId = randomUUID();
    const tickNumber = await getTickNumber(); // 从 working_memory 读取
    
    // 评估进展
    const evaluationResult = await evaluateProgressInTick(tickId, tickNumber);
    
    // 检测异常
    const anomalies = await getProgressAnomalies(1); // 最近 1 小时的异常
    
    if (anomalies.length > 0) {
      console.log(`[tick] Found ${anomalies.length} progress anomalies`);
      actionsTaken.push({
        action: 'progress_ledger_evaluation',
        anomalies_detected: anomalies.length,
        anomalies: anomalies
      });
    }
    
    // 如果发现风险，可能触发丘脑决策或提升警觉等级
    if (evaluationResult.risk_level === 'high') {
      alertnessResult.score += 10; // 提升警觉
    }
  } catch (ledgerErr) {
    console.error('[tick] Progress ledger evaluation failed (non-fatal):', ledgerErr.message);
  }
}
```

#### 2.3 执行回调集成（`routes.js`）

在 `execution-callback` 中记录进展步骤：

```javascript
// 在原子操作内部，UPDATE 之后添加：

// 记录最后的进展步骤
if (newStatus === 'completed' || newStatus === 'failed') {
  try {
    const { recordProgressStep } = await import('./progress-ledger.js');
    
    const ledgerEntry = await recordProgressStep(task_id, run_id, {
      sequence: iterations || 1,
      name: `Task execution complete`,
      type: 'execution',
      status: newStatus === 'completed' ? 'completed' : 'failed',
      inputSummary: null,
      outputSummary: result,
      findings: findingsValue,
      errorCode: newStatus === 'failed' ? 'EXECUTION_FAILED' : null,
      errorMessage: newStatus === 'failed' ? status : null,
      duration_ms: duration_ms
    });
    
    console.log(`[execution-callback] Progress ledger entry created: ${ledgerEntry}`);
  } catch (ledgerErr) {
    console.error('[execution-callback] Failed to record progress step (non-fatal):', ledgerErr.message);
  }
}
```

---

### 3. API 端点

#### 3.1 新增路由（`routes.js`）

```javascript
// GET /api/brain/progress/:task_id
// 获取任务完整进展历史
router.get('/progress/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;
    const steps = await getProgressSteps(task_id);
    const summary = await getTaskProgressSummary(task_id);
    
    res.json({
      task_id,
      summary,
      steps: steps.map(s => ({
        sequence: s.step_sequence,
        name: s.step_name,
        type: s.step_type,
        status: s.status,
        duration_ms: s.duration_ms,
        findings: s.findings,
        started_at: s.started_at,
        completed_at: s.completed_at
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/progress/latest
// 获取所有任务的最新进展（仪表板用）
router.get('/progress/latest', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const latestSteps = await pool.query(`
      SELECT * FROM v_latest_progress_step
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    
    res.json(latestSteps.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/progress/anomalies
// 检测进展异常
router.get('/progress/anomalies', async (req, res) => {
  try {
    const { hours = 1 } = req.query;
    const anomalies = await getProgressAnomalies(parseInt(hours));
    
    res.json({
      window_hours: hours,
      anomalies: anomalies.map(a => ({
        task_id: a.task_id,
        issue: a.issue,
        severity: a.severity,
        recommendation: a.recommendation
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/progress/record
// 手动记录进展步骤（用于测试或特殊场景）
router.post('/progress/record', async (req, res) => {
  try {
    const { task_id, run_id, step } = req.body;
    const ledgerId = await recordProgressStep(task_id, run_id, step);
    
    res.json({ success: true, ledger_id: ledgerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 三、数据流与工作机制

### 1. 完整的数据流

```
┌─────────────────────────────────────────────────────────────┐
│  Task 执行阶段（Caramel/外部 Agent）                          │
│  - 执行 5 个步骤（validate, execute, verify 等）              │
│  - 每一步完成后调用 trace SDK（新增）                        │
└────────────────┬────────────────────────────────────────────┘
                 │ 每步记录到 progress_ledger
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  trace.js - 记录 progress 步骤                               │
│  - recordProgressStep(taskId, runId, stepData)              │
│  - INSERT INTO progress_ledger                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  execution-callback 钩子                                     │
│  - 任务完成时汇总所有进展                                    │
│  - 记录最后一个 progress 条目                               │
│  - payload 中记录 findings                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Tick 循环 - Progress Ledger 评估                            │
│  （每小时一次，与 periodic cleanup 同频）                    │
│                                                             │
│  1. 查询 progress_ledger 最新数据                            │
│  2. 计算进展指标（完成率、耗时、风险）                       │
│  3. 检测异常（停滞、过慢、重试过多）                         │
│  4. 生成评估记录到 progress_ledger_review                    │
│  5. 如果风险过高 → 触发 thalamus 或 cortex                  │
│  6. 推送到 WebSocket（仪表板实时更新）                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  仪表板更新                                                   │
│  - 实时显示任务进展                                          │
│  - 显示步骤完成情况                                          │
│  - 显示异常警告                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. Tick 循环内的评估算法

```javascript
evaluateProgressInTick() {
  // 1. 收集所有 in_progress 的任务
  const activeTasks = await getInProgressTasks();
  
  for (const task of activeTasks) {
    // 2. 查询该任务的进展历史
    const steps = await getProgressSteps(task.id, task.current_run_id);
    
    // 3. 计算进展指标
    const metrics = {
      total_steps: steps.length,
      completed_steps: steps.filter(s => s.status === 'completed').length,
      failed_steps: steps.filter(s => s.status === 'failed').length,
      completion_rate: completed_steps / total_steps,
      elapsed_time: now - task.started_at,
      estimated_time_left: (estimated_hours * 60) * (1 - completion_rate)
    };
    
    // 4. 识别异常
    const anomalies = [];
    
    // 异常 1：进展停滞（1小时没有新步骤）
    if (now - steps[-1].completed_at > 1h) {
      anomalies.push({
        type: 'stalled_progress',
        severity: 'high',
        recommendation: 'check_executor_health'
      });
    }
    
    // 异常 2：步骤耗时过长（> 2 × estimated_time / total_steps）
    for (const step of steps) {
      const step_duration = step.completed_at - step.started_at;
      const expected_duration = (estimated_hours * 60) / total_steps;
      if (step_duration > 2 * expected_duration) {
        anomalies.push({
          type: 'slow_step',
          step_name: step.step_name,
          severity: 'medium',
          recommendation: 'investigate_step_performance'
        });
      }
    }
    
    // 异常 3：失败重试过多（> 3 次）
    if (metrics.failed_steps > 3) {
      anomalies.push({
        type: 'repeated_failures',
        severity: 'high',
        recommendation: 'escalate_to_cortex'
      });
    }
    
    // 5. 生成评估记录
    if (anomalies.length > 0) {
      await recordProgressReview({
        task_id: task.id,
        run_id: task.current_run_id,
        tick_id: tickId,
        tick_number: tickNumber,
        anomalies: anomalies,
        risk_level: calculateRiskLevel(anomalies),
        ai_model: 'decision_engine', // 初始为规则引擎
        ai_decision: {
          action: 'escalate_to_thalamus', // 或 'continue', 'retry', 'pause'
          rationale: 'Multiple anomalies detected',
          confidence: 0.85
        }
      });
    }
  }
}
```

---

## 四、与现有系统的适配

### 1. 与 run_events 的关系

| 特性 | run_events | progress_ledger |
|------|-----------|-----------------|
| **粒度** | 细粒度（每个步骤的 span） | 中粒度（任务级别的进展块） |
| **覆盖范围** | 全层（L0-L4 所有层） | 任务执行层（L2-L3） |
| **生成者** | trace.js SDK（执行者） | Agent + Brain（执行者 + 决策者）|
| **用途** | 可观测性、故障诊断 | 进展评估、异常检测 |
| **查询频率** | 按需查询（高精度） | Tick 循环评估（决策用）|
| **生存期** | 长期保存（审计） | 短期+归档（进展跟踪）|

**关系**：
- `progress_ledger` 是对 `run_events` 的高层抽象（汇总）
- 两者共存：run_events 提供细节，progress_ledger 提供决策依据
- `progress_ledger_review` 是 Tick 评估的记录，不在 run_events 中

### 2. 与 tick 循环的集成点

**现有的进展检查**（保留）：
- PR Plans 完成检查
- Initiative/Project 闭环检查
- 健康监控

**新增的 Progress Ledger 评估**：
- 在 periodic cleanup 同频（每小时）
- 目的：细粒度的进展异常检测和决策
- 输出：actionsTaken 数组、潜在的警觉升级、WebSocket 广播

### 3. 与决策引擎的集成

**可能的决策流**：

```
Progress Ledger 检测异常
  ↓
根据异常类型生成 AI 决策
  ↓
┌─ Low 风险 → log_event（仅记录）
├─ Medium 风险 → 触发 thalamus → 快速路由 (L1)
└─ High 风险 → 升级到 cortex → 深度分析 (L2)
```

**白名单 action 扩展**（如需要）：
- `adjust_progress_checkpoint`：调整进展检查点
- `escalate_task_due_to_progress`：基于进展状况升级任务

---

## 五、实现建议

### 1. 开发序列

**Phase 1**（基础）：
1. 创建迁移文件 087（progress_ledger 和 progress_ledger_review 表）
2. 编写 progress-ledger.js 模块
3. 在 execution-callback 中集成进度记录
4. 添加基础查询 API

**Phase 2**（Tick 集成）：
1. 在 tick.js 中添加 evaluateProgressInTick
2. 实现异常检测算法
3. 添加异常告警

**Phase 3**（决策集成）：
1. 生成 progress_ledger_review 记录
2. 触发 thalamus 或 cortex
3. 记录 AI 决策

**Phase 4**（仪表板）：
1. 添加 WebSocket 广播
2. 前端实时展示进展

### 2. 测试策略

- 单元测试：progress-ledger.js 的各个函数
- 集成测试：execution-callback + progress_ledger + tick 评估
- 压力测试：100+ 任务并发的性能
- 异常检测测试：模拟各种进展异常场景

### 3. 监控指标

- `progress_ledger` 表的行数增长（每小时）
- 平均步骤耗时（分位数：p50, p95, p99）
- 异常检测率（误报率、漏报率）
- Tick 评估耗时（应 < 1s）

---

## 六、关键文件地图

| 文件 | 用途 |
|------|------|
| `packages/brain/migrations/087_progress_ledger.sql` | 新表定义 |
| `packages/brain/src/progress-ledger.js` | 核心模块 |
| `packages/brain/src/tick.js` | Tick 循环集成 |
| `packages/brain/src/routes.js` | API 端点 |
| `packages/brain/src/trace.js` | 步骤追踪（已有，不修改） |
| `packages/brain/src/routes/progress-ledger.js` | 专用路由（可选）|

---

## 七、预期效果

### 1. 功能增强

- ✅ 实时进展可视化（步骤级别）
- ✅ 进展异常自动检测（停滞、缓慢、失败重试）
- ✅ 基于进展状况的自适应决策
- ✅ 任务执行的完整审计链

### 2. 性能影响

- 数据库：新增 ~2 万行/天（假设 100 任务 × 200 步骤）
- API：新增 3 个查询端点，查询耗时 < 100ms
- Tick 循环：新增 < 1s 的评估耗时（每小时）

### 3. 业务价值

- 提早发现执行问题（异常检测）
- 更智能的任务调度（基于进展数据）
- 完整的执行透明度（用户可见）
- 自动化学习（可训练异常模式识别）

