# Progress Ledger 实现快速参考

## 关键代码位置

### 数据库架构
- **现有的进展追踪**：
  - `migration 023`：run_events 表（细粒度 span 追踪）
  - `trace.js`：步骤追踪 SDK

- **新增**：
  - `migration 087`：progress_ledger + progress_ledger_review 表
  - 两个 SQL 视图：v_task_progress_summary, v_latest_progress_step

### Brain 服务代码
- **关键文件**：
  - `packages/brain/src/tick.js`（第 1085 行）：`executeTick()` 函数
    - 现有的检查：PR Plans 完成（行 1169-1182）
    - 现有的检查：Initiative 闭环（行 1281-1293）
    - **新增位置**：periodic cleanup 之后（约行 1221 之后）
  
  - `packages/brain/src/routes.js`（第 2253 行）：`execution-callback`
    - 现有：原子更新 tasks status + payload
    - **新增位置**：COMMIT 之后（约行 2363）
  
  - `packages/brain/src/progress-ledger.js`（新文件）：
    - 核心 API：recordProgressStep, getProgressSteps, evaluateProgressInTick
    - 异常检测：getProgressAnomalies

### API 端点
新增 3 个端点（在 `routes.js`）：
1. `GET /api/brain/progress/:task_id` - 任务完整历史
2. `GET /api/brain/progress/latest` - 最新进展
3. `GET /api/brain/progress/anomalies` - 异常检测

---

## 实现的三个核心集成点

### 1. 执行回调阶段（立即记录）
```
POST /api/brain/execution-callback
  ↓
[原子操作] UPDATE tasks + INSERT decision_log
  ↓
[新增] recordProgressStep(task_id, run_id, {...})
  ↓
INSERT INTO progress_ledger
```

### 2. Tick 循环评估阶段（每小时）
```
executeTick() 每 5 分钟执行一次
  ↓
periodic cleanup 检查（每 1 小时）
  ↓
[新增] evaluateProgressInTick(tickId, tickNumber)
  ↓
SELECT progress_ledger WHERE task_id IN (SELECT id FROM tasks WHERE status='in_progress')
  ↓
计算指标 + 检测异常 → INSERT INTO progress_ledger_review
  ↓
if risk_level='high' → alertnessResult.score += 10
```

### 3. 查询和展示
```
仪表板 / API 客户端
  ↓
GET /api/brain/progress/:task_id
  ↓
SELECT * FROM v_task_progress_summary WHERE task_id=?
  ↓
返回：completion_rate, total_duration, elapsed_time 等
```

---

## 快速检查清单

### 数据库迁移
- [ ] 创建 migration 087 文件
- [ ] 定义 progress_ledger 表（18 个字段）
- [ ] 定义 progress_ledger_review 表（10 个字段）
- [ ] 添加 8 个索引
- [ ] 创建 2 个视图

### 代码实现
- [ ] 创建 progress-ledger.js（6 个主要函数）
- [ ] 修改 tick.js（添加 evaluateProgressInTick 调用）
- [ ] 修改 routes.js execution-callback（添加 recordProgressStep）
- [ ] 添加 3 个 API 端点

### 测试
- [ ] 单元测试：recordProgressStep 的 CRUD
- [ ] 集成测试：execution-callback + tick 评估
- [ ] 数据检查：验证进展流水线中的数据一致性

### 监控
- [ ] 添加日志：progress_ledger 写入计数
- [ ] 添加指标：评估耗时
- [ ] 仪表板：显示进度条和异常

---

## 字段对应关系

### progress_ledger（任务步骤）
```
task_id ──┐
run_id    ├─→ 关联到 execution-callback 的 (task_id, run_id)
          │
step_sequence (1, 2, 3...) 
step_name ("validate_input", "execute_logic", ...)
step_type ("exploratory", "execution", "validation")

status (queued, in_progress, completed, failed, skipped)
started_at / completed_at / duration_ms
  └─ 来自 trace.js 或 agent 报告

findings / output_summary
  └─ 来自 execution-callback 的 result / findings

error_code / error_message / retry_count
  └─ 来自失败的步骤

artifacts ({"screenshot_id": "...", "log_id": "..."})
  └─ 来自 trace.js 的 addArtifact
```

### progress_ledger_review（评估记录）
```
task_id / run_id / ledger_entry_id
  └─ 指向某次评估针对的步骤

tick_id / tick_number
  └─ 本次 tick 的标识

review_action ("continue", "retry", "escalate", "pause", "abandon")
risk_assessment ("low", "medium", "high")
confidence_score (0.0-1.0)

ai_model ("decision_engine", "thalamus", "cortex")
ai_decision ({"action": "...", "rationale": "...", "confidence": 0.85})
  └─ 用于从规则引擎升级到 LLM 决策时的记录
```

---

## 异常检测规则

三类主要异常：

### 1. 进展停滞
```
if (now - latest_step.completed_at > 1 hour)
  → severity: 'high'
  → recommendation: 'check_executor_health'
```

### 2. 步骤过慢
```
for (step in steps):
  step_duration = step.completed_at - step.started_at
  expected = (task.estimated_hours * 60) / total_steps
  if (step_duration > 2 * expected)
    → severity: 'medium'
    → recommendation: 'investigate_step_performance'
```

### 3. 失败重试过多
```
if (failed_steps > 3)
  → severity: 'high'
  → recommendation: 'escalate_to_cortex'
```

---

## 性能预期

### 数据量
- 任务执行时平均 5-10 个步骤 → progress_ledger 每天 ~5k 行
- 100 个并发任务 × 10 步骤 = 1000 行/执行周期
- 评估记录 → progress_ledger_review 每天 ~1-2k 行（每小时 1-2 条/任务）

### 查询性能
- `GET /api/brain/progress/:task_id` → 单任务最多 20 行 → < 10ms
- `evaluateProgressInTick()` → 100 个任务扫描 → < 1s
- 索引覆盖（task_run, status, created_at）→ 无全表扫描

### 写入性能
- `recordProgressStep` → 单行 INSERT → < 1ms
- `recordProgressReview` → 单行 INSERT → < 1ms
- Tick 评估 → 批量 INSERT（100 条）→ < 100ms

---

## WebSocket 集成（可选）

Tick 评估完成后广播事件：

```javascript
// 在 tick.js 中，evaluateProgressInTick 完成后：
publishCognitiveState({
  phase: 'progress_ledger_evaluation',
  detail: `${anomalies.length} anomalies detected`,
  meta: {
    anomalies: anomalies,
    risk_level: overallRiskLevel
  }
});

// 或发射事件：
emitEvent('progress_ledger_evaluation', 'tick', {
  anomalies: anomalies,
  risk_level: overallRiskLevel
});
```

---

## 升级路径（v2 功能）

### 短期（1-2 周）
- 基础 ledger 记录 + 异常检测
- 规则引擎评估（不用 LLM）
- API 端点查询

### 中期（2-4 周）
- Thalamus（L1）集成：快速判断异常
- 自适应阈值：根据任务历史调整异常检测参数
- Dashboard 仪表板：实时进度条

### 长期（1-3 月）
- Cortex（L2）集成：根因分析
- ML 模型：学习"正常的进展模式"
- 预测：估计完成时间、预测失败
- 自动恢复：触发自动 retry 或 escalation

---

## 调试技巧

### 查询最新进展
```sql
SELECT * FROM v_latest_progress_step 
WHERE task_id = 'xxx-xxx-xxx'
ORDER BY step_sequence DESC
LIMIT 1;
```

### 查看进展汇总
```sql
SELECT * FROM v_task_progress_summary 
WHERE task_id = 'xxx-xxx-xxx';
```

### 查找异常任务
```sql
SELECT * FROM progress_ledger 
WHERE status = 'in_progress' 
  AND completed_at IS NULL
  AND created_at < now() - interval '1 hour'
ORDER BY created_at ASC;
```

### Tick 评估记录
```sql
SELECT * FROM progress_ledger_review 
WHERE tick_number > (
  SELECT MAX(tick_number) - 10 FROM progress_ledger_review
)
ORDER BY tick_number DESC, evaluated_at DESC;
```

