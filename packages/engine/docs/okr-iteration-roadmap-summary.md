---
id: okr-iteration-roadmap-summary
version: 1.0.0
created: 2026-02-08
updated: 2026-02-08
---

# OKR 迭代拆解 Roadmap - 完整演进历程

## 🎯 总体目标

**让 Cecelia Brain 可以自动拆解 OKR → 派发 Task → Engine 执行 → 反馈回 Brain → 形成闭环**

---

## 📊 演进路线图

```
Phase 3a              Phase 3b              Phase 4a              Phase 4b
Engine 主动传 ID  →  Brain 注入元数据  →  Engine 反馈上传  →  Brain 接收反馈

Engine                Brain                 Engine                Brain
  ↓                    ↓                     ↓                     ↓
传递 task_id      读取 Task 详情        上传 feedback         存储 feedback
到 Brain          写入 PRD 文件         同步 status           更新 status_history
```

---

## 🔄 完整数据流

### 现在（Phase 4a 完成）

```
1. Cecelia Brain 拆解 OKR
   └─> 生成 Task (id: task_123, title: "实现功能 X", ...)

2. Brain 派发 Task 给 Engine
   └─> 调用: /dev --task-id task_123

3. Engine Step 1 (PRD)
   ├─> 调用 Brain API: GET /tasks/task_123
   ├─> 获取: title, description, priority, acceptance_criteria
   ├─> 生成 PRD 文件: .prd-task_123.md
   └─> 更新状态: PATCH /tasks/task_123 {"status": "in_progress"} ✅ (Phase 4a)

4. Engine Step 2-8: 执行开发流程
   └─> Branch → DoD → Code → Test → Quality → PR

5. Engine Step 10 (Learning)
   ├─> 生成反馈报告: .dev-feedback-report.json
   ├─> 上传反馈: POST /tasks/task_123/feedback {...} ✅ (Phase 4a)
   └─> 更新状态: PATCH /tasks/task_123 {"status": "completed"} ✅ (Phase 4a)

6. Brain 接收反馈 ❌ (Phase 4b 待实现)
   ├─> 存储反馈到 tasks.feedback 字段
   ├─> 记录状态历史到 tasks.status_history
   └─> 触发下游事件（通知、统计等）
```

---

## 📝 各 Phase 详细说明

### Phase 3a: Task ID 传递机制 ✅

**PR**: #547
**版本**: v12.15.0
**完成时间**: 2026-02-07

#### 问题
- Brain 派发 Task 给 Engine，但 Engine 不知道自己在干哪个 Task
- 无法回传结果，无法追踪进度

#### 解决方案
```bash
# Brain 派发时带上 task_id
cecelia-run /dev --task-id task_123

# Engine 接收并传递
/dev 接收 --task-id 参数 → 写入 .dev-mode → Step 10 读取 → 回传
```

#### 实现内容
1. **skills/dev/SKILL.md**: 添加 `--task-id` 参数解析
2. **.dev-mode 格式扩展**: 添加 `task_id: xxx` 字段
3. **Step 10 集成**: 读取 task_id，调用 Brain API（占位符）

#### 成果
✅ Engine 知道自己在执行哪个 Task
✅ 为后续反馈上传打下基础
❌ 但还没有实际调用 Brain API

---

### Phase 3b: Task 元数据注入 ✅

**PR**: #551
**版本**: v12.16.0
**完成时间**: 2026-02-08

#### 问题
- Engine 有 task_id，但不知道 Task 的具体内容
- PRD 还需要 AI 从零开始写，浪费时间
- Brain 已经有详细的 Task 信息（title, description, acceptance_criteria）

#### 解决方案
```bash
# Step 1: 从 Brain 读取 Task 元数据
curl http://localhost:5221/api/brain/tasks/$task_id

# 注入到 PRD
echo "# PRD - $task_title" > .prd.md
echo "$description" >> .prd.md
echo "## 验收标准" >> .prd.md
echo "$acceptance_criteria" >> .prd.md
```

#### 实现内容
1. **skills/dev/scripts/fetch-task.sh**: 新增，调用 Brain API 获取 Task
2. **skills/dev/steps/01-prd.md**: 修改，集成 fetch-task.sh
3. **降级处理**: Brain 不可用时回退到 AI 生成 PRD
4. **测试**: tests/dev/test-fetch-task.sh

#### 成果
✅ PRD 自动注入 Brain 的 Task 内容
✅ 省去 AI 思考时间，更快启动
✅ Brain 和 Engine 数据一致
✅ 降级友好（本地开发时 Brain 可能不运行）

---

### Phase 4a: Dev Feedback Upload & Task Status Sync ✅

**PR**: #552
**版本**: v12.17.0
**完成时间**: 2026-02-08

#### 问题
- Engine 执行完 Task，Brain 不知道结果
- Brain 不知道 Task 当前状态（pending/in_progress/completed）
- 无法自动统计成功率、耗时等指标

#### 解决方案
```bash
# Step 1: 启动时同步状态
bash skills/dev/scripts/update-task-status.sh $task_id "in_progress"
# → PATCH /api/brain/tasks/:task_id {"status": "in_progress"}

# Step 10: 完成时上传反馈
bash skills/dev/scripts/upload-feedback.sh $task_id
# → POST /api/brain/tasks/:task_id/feedback {
#     "status": "completed",
#     "summary": "...",
#     "metrics": {...},
#     "artifacts": {...}
#   }

# Step 10: 完成时更新状态
bash skills/dev/scripts/update-task-status.sh $task_id "completed"
# → PATCH /api/brain/tasks/:task_id {"status": "completed"}
```

#### 实现内容
1. **skills/dev/scripts/upload-feedback.sh**: 上传反馈到 Brain
2. **skills/dev/scripts/update-task-status.sh**: 同步状态到 Brain
3. **skills/dev/steps/01-prd.md**: 集成状态同步（启动时 → in_progress）
4. **skills/dev/steps/10-learning.md**: 集成反馈上传 + 状态同步（完成时 → completed）
5. **降级处理**: Brain 不可用时静默失败，不阻塞 /dev
6. **测试**: test-upload-feedback.sh, test-update-task-status.sh

#### 核心设计
```bash
# 降级处理模式
if bash script.sh 2>/dev/null || true; then
    echo "✅ 成功"
else
    echo "⚠️  失败（Brain 可能不可用，继续执行）"
fi
```

#### 成果
✅ Engine 可以主动上传反馈到 Brain（Engine 侧实现）
✅ Engine 可以同步状态到 Brain（Engine 侧实现）
✅ 降级处理完善（Brain 不可用时不阻塞）
❌ 但 Brain 还没有对应的 API 端点（需要 Phase 4b）

---

### Phase 4b: Brain Feedback API Implementation ⏳

**PR**: 待创建
**版本**: 待定
**预计时间**: 2026-02-08（2-3 小时）

#### 问题
- Phase 4a 实现了 Engine 侧的反馈上传
- 但 Brain 没有对应的 API 端点接收
- 数据库没有存储反馈和状态历史的字段

#### 解决方案

##### 1. 数据库扩展
```sql
-- tasks 表添加字段
ALTER TABLE tasks ADD COLUMN feedback JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN status_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN feedback_count INTEGER DEFAULT 0;

-- 索引优化
CREATE INDEX idx_tasks_feedback ON tasks USING gin(feedback);
CREATE INDEX idx_tasks_status_history ON tasks USING gin(status_history);
```

##### 2. API 端点实现

**POST /api/brain/tasks/:task_id/feedback**
```javascript
// 接收反馈
{
  "status": "completed",
  "summary": "实现了功能 X，PR #552 已合并",
  "metrics": {
    "duration_seconds": 4800,
    "commits": 3,
    "files_changed": 8,
    "lines_added": 326
  },
  "artifacts": {
    "pr_url": "https://github.com/.../pull/552",
    "pr_number": 552,
    "branch": "cp-02081004-xxx"
  }
}

// 存储到数据库
UPDATE tasks
SET
  feedback = feedback || $1::jsonb,
  feedback_count = feedback_count + 1,
  updated_at = NOW()
WHERE id = $2
```

**PATCH /api/brain/tasks/:task_id**
```javascript
// 更新状态
{
  "status": "in_progress"  // 或 "completed", "failed"
}

// 记录状态历史
UPDATE tasks
SET
  status = $1,
  status_history = status_history || $2::jsonb,
  updated_at = NOW()
WHERE id = $3

// $2 = {
//   "from": "pending",
//   "to": "in_progress",
//   "changed_at": "2026-02-08T10:30:00Z",
//   "source": "engine"
// }
```

##### 3. 状态转换规则
```
pending → in_progress ✅
in_progress → completed ✅
in_progress → failed ✅
completed → * ❌ (已完成不可更改)
failed → * ❌ (已失败不可更改)
```

#### 实现内容（待完成）
1. **brain/routes/tasks.js**: 添加两个端点路由
2. **brain/controllers/taskController.js**: 添加控制器方法
3. **brain/services/feedbackService.js**: 新增反馈处理服务
4. **brain/services/taskService.js**: 扩展状态更新逻辑
5. **brain/migrations/XXX_add_feedback.sql**: 数据库迁移脚本
6. **brain/tests/**: 单元测试 + 集成测试

#### 成果（预期）
✅ Brain 可以接收 Engine 上传的反馈
✅ Brain 可以记录 Task 状态变更历史
✅ 数据库持久化反馈和状态
✅ 完整的错误处理和验证
✅ 与 Engine Phase 4a 端到端联调通过
✅ **闭环完成！** 🎉

---

## 🔗 完整闭环演示（Phase 4b 完成后）

### 1. Brain 派发 Task

```javascript
// Cecelia Brain 拆解 OKR
const task = await brain.createTask({
  title: "实现 XXX 功能",
  description: "详细描述...",
  acceptance_criteria: ["标准1", "标准2"],
  priority: "P0"
});
// → task.id = "task_123"

// Brain 派发 Task
await cecelia.dispatch('/dev', { taskId: task.id });
```

### 2. Engine 执行 Task

```bash
# Engine 启动
/dev --task-id task_123

# Step 1: PRD 生成
# ├─> 调用: GET /api/brain/tasks/task_123
# ├─> 获取: title, description, acceptance_criteria
# ├─> 生成: .prd-task_123.md
# └─> 更新状态: PATCH /api/brain/tasks/task_123 {"status": "in_progress"}

# Step 2-8: 开发流程
# Branch → DoD → Code → Test → Quality → PR

# Step 10: Learning
# ├─> 生成反馈: .dev-feedback-report.json
# ├─> 上传反馈: POST /api/brain/tasks/task_123/feedback
# └─> 更新状态: PATCH /api/brain/tasks/task_123 {"status": "completed"}
```

### 3. Brain 接收反馈

```javascript
// Brain 接收反馈（Phase 4b）
POST /api/brain/tasks/task_123/feedback
{
  "status": "completed",
  "summary": "功能 XXX 已实现，PR #552 已合并到 develop",
  "metrics": {
    "duration_seconds": 4800,      // 80 分钟
    "commits": 3,
    "files_changed": 8,
    "lines_added": 326,
    "lines_removed": 31
  },
  "artifacts": {
    "pr_url": "https://github.com/perfectuser21/cecelia-engine/pull/552",
    "pr_number": 552,
    "branch": "cp-02081004-dev-feedback-upload",
    "commits": ["1f9c8a2", "3d7b5e1", "8a2f4c3"]
  },
  "issues": [],
  "learnings": ["实现顺利，CI 一次通过"]
}

// Brain 存储反馈
tasks.feedback = [
  {
    "id": "feedback_uuid",
    "status": "completed",
    "summary": "...",
    "metrics": {...},
    "artifacts": {...},
    "received_at": "2026-02-08T14:30:00Z"
  }
]

// Brain 记录状态历史
tasks.status_history = [
  {
    "from": "pending",
    "to": "in_progress",
    "changed_at": "2026-02-08T10:00:00Z",
    "source": "engine"
  },
  {
    "from": "in_progress",
    "to": "completed",
    "changed_at": "2026-02-08T14:30:00Z",
    "source": "engine",
    "metadata": {
      "pr_url": "...",
      "pr_number": 552
    }
  }
]
```

### 4. Brain 分析和决策

```javascript
// Brain 可以做的事情：

// 1. 统计成功率
const successRate = await brain.calculateSuccessRate();
// → 85% 的 Task 成功完成

// 2. 分析平均耗时
const avgDuration = await brain.calculateAvgDuration();
// → 平均 4800 秒（80 分钟）

// 3. 识别失败模式
const failedTasks = await brain.getFailedTasks();
// → ["task_456", "task_789"] 失败原因：CI 失败

// 4. 自动调整策略
if (successRate < 0.7) {
  await brain.adjustStrategy({
    action: "reduce_parallelism",  // 减少并行任务
    reason: "成功率过低"
  });
}

// 5. 触发下游任务
if (task.status === 'completed' && task.depends_on.length > 0) {
  await brain.triggerDependentTasks(task.id);
}
```

---

## 📊 各 Phase 对比表

| Phase | 目标 | Engine 变更 | Brain 变更 | 数据流向 | 状态 |
|-------|------|------------|-----------|---------|------|
| **3a** | Task ID 传递 | ✅ 接收 --task-id<br>✅ 写入 .dev-mode | ❌ 无 | Engine ← Brain | ✅ 完成 |
| **3b** | Task 元数据注入 | ✅ fetch-task.sh<br>✅ 注入 PRD | ✅ GET /tasks/:id | Engine ← Brain | ✅ 完成 |
| **4a** | 反馈上传（Engine 侧）| ✅ upload-feedback.sh<br>✅ update-task-status.sh | ❌ 无 | Engine → Brain | ✅ 完成 |
| **4b** | 反馈接收（Brain 侧）| ❌ 无 | ✅ POST /feedback<br>✅ PATCH /status<br>✅ 数据库扩展 | Engine → Brain | ⏳ 待实现 |

---

## 🎯 Phase 4b 完成后的能力

### Brain 可以做到：

1. **实时追踪 Task 状态**
   ```javascript
   // 查询某个 Task 的当前状态
   const task = await brain.getTask('task_123');
   console.log(task.status);  // "in_progress"
   ```

2. **查看执行历史**
   ```javascript
   // 查看状态变更历史
   console.log(task.status_history);
   // [
   //   { from: "pending", to: "in_progress", changed_at: "..." },
   //   { from: "in_progress", to: "completed", changed_at: "..." }
   // ]
   ```

3. **分析执行反馈**
   ```javascript
   // 查看 Task 的执行反馈
   console.log(task.feedback[0].metrics);
   // {
   //   duration_seconds: 4800,
   //   commits: 3,
   //   files_changed: 8,
   //   lines_added: 326
   // }
   ```

4. **统计和优化**
   ```javascript
   // 计算平均执行时间
   const avgTime = await brain.calculateAvgDuration('P0');
   // → P0 任务平均 4800 秒

   // 识别瓶颈
   const bottlenecks = await brain.identifyBottlenecks();
   // → "CI 检查耗时过长（平均 600 秒）"
   ```

5. **自动化决策**
   ```javascript
   // 根据历史数据自动调整
   if (task.feedback.length > 3 && allFailed(task.feedback)) {
     await brain.quarantineTask(task.id, "多次失败，需要人工介入");
   }
   ```

6. **触发下游任务**
   ```javascript
   // Task A 完成后自动启动 Task B
   brain.on('task_completed', async (taskId) => {
     const dependents = await brain.getDependentTasks(taskId);
     for (const dep of dependents) {
       await brain.dispatchTask(dep.id);
     }
   });
   ```

---

## 🚀 未来扩展（Phase 5+）

### Phase 5: 前端可视化 ⏳

- Task 详情页展示反馈
- 状态变更时间线
- Metrics 图表（耗时、成功率、代码量）
- Artifacts 下载（PR 链接、Commit 列表）

### Phase 6: 智能分析 ⏳

- 失败原因自动分类
- 瓶颈自动识别
- 优化建议（"该任务类型平均耗时 2 小时，你的用了 4 小时"）
- 预测任务难度和耗时

### Phase 7: 自动化闭环 ⏳

- 失败任务自动重试
- 依赖任务自动触发
- 资源自动调度（并行度动态调整）
- 异常自动告警

---

## 📚 相关资源

### PRs

- **Phase 3a**: perfectuser21/cecelia-engine#547
- **Phase 3b**: perfectuser21/cecelia-engine#551
- **Phase 4a**: perfectuser21/cecelia-engine#552
- **Phase 4b**: 待创建（cecelia-core 项目）

### 文档

- **Phase 3a Learning**: `docs/learning/dev-task-id-phase3a-learning.md`
- **Phase 3b Learning**: `docs/learning/dev-task-id-phase3b-learning.md`
- **Phase 4a Learning**: `docs/learning/dev-feedback-upload-phase4a-learning.md`
- **Phase 4b PRD**: `.prd-phase4b-brain-feedback-api.md`

### 代码

- **Engine Scripts**:
  - `skills/dev/scripts/fetch-task.sh` (Phase 3b)
  - `skills/dev/scripts/upload-feedback.sh` (Phase 4a)
  - `skills/dev/scripts/update-task-status.sh` (Phase 4a)
- **Brain API**:
  - `GET /api/brain/tasks/:id` (Phase 3b，已存在)
  - `POST /api/brain/tasks/:id/feedback` (Phase 4b，待实现)
  - `PATCH /api/brain/tasks/:id` (Phase 4b，待实现)

---

**更新时间**: 2026-02-08
**当前进度**: Phase 4a 完成，Phase 4b 待实现
**预计完成**: Phase 4b 预计 2-3 小时完成，闭环将全部打通 🎉
