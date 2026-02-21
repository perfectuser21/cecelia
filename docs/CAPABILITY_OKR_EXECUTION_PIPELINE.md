# OKR 执行流程 - 端到端 Pipeline

**Capability ID**: `okr_execution_pipeline`
**Owner**: Brain
**Status**: Active
**Version**: 1.0.0
**Created**: 2026-02-17

## 概述

OKR 执行流程是 Cecelia 的核心能力，将战略目标（Global OKR）层层分解到可执行任务（Task），并通过边拆边做（Exploratory）模式实现渐进式交付。

## 6 层架构

```
Global OKR (季度目标)
  ↓ parent_id
Global KR (关键结果)
  ↓ metadata.aligned_to_global_krs (指导关系)
Area OKR (月度目标，按器官分)
  ↓ parent_id
Area KR (关键结果)
  ↓ project_kr_links
Project (项目)
  ↓ parent_id
Initiative (功能模块)
  ↓ project_id, goal_id
Task (PR)
```

## 端到端流程

### Phase 1: OKR 状态机（okr-tick.js）

**触发**: 每 5 分钟一次（OKR_TICK_INTERVAL_MS）

**状态转换**:
```
pending → needs_info → ready → decomposing → in_progress → completed
```

**关键逻辑**:
```javascript
// 1. 检查 status='ready' 的 Goal（KR）
const readyGoals = await getGoalsByStatus('ready');

// 2. 为每个 KR 创建拆解任务
for (const kr of readyGoals) {
  await createTask({
    title: `OKR 拆解: ${kr.title}`,
    task_type: 'dev',
    goal_id: kr.id,
    payload: {
      decomposition: 'true',  // 首次拆解标志
      kr_id: kr.id,
      kr_goal: kr.description
    }
  });

  // 3. 更新 KR 状态为 decomposing
  await updateGoalStatus(kr.id, 'decomposing');
}
```

### Phase 2: 秋米拆解（executor.js + /okr skill）

**触发**: Task payload.decomposition='true'

**执行者**: 秋米（Opus 模型 + /okr skill）

**Prompt 生成** (executor.js):
```javascript
if (payload.decomposition === 'true') {
  const prompt = `/okr
# OKR 拆解: ${krTitle}

## 6 层架构
Global OKR → Global KR → Area OKR → Area KR → Project → Initiative → Task

## 你的任务
1. **确定 Repository**（必须是已存在的 repo 路径）
2. **判断拆解模式**:
   - known: 一次性拆完所有任务（已知方案）
   - exploratory: 边拆边做（未知领域，推荐）
3. **创建 Initiative**（通过 Brain API）
4. **创建 Task + PRD**（每个 Task 必须有 prd_content）
`;
}
```

**秋米输出**:
- 创建 Initiative (project, type='initiative', parent_id=Project)
- 创建 1-N 个 Task，根据模式：
  - **Exploratory 模式**: 创建 1 个 task_type='exploratory' 的探索任务
  - **Known 模式**: 创建 N 个 task_type='dev' 的开发任务
- 每个 Task 包含：
  - prd_content（PRD 内容）
  - repo_path（通过 project_id 关联）
  - payload.exploratory: true/false（标识模式）

### Phase 3: Planner 选择任务（planner.js）

**触发**: 每次 tick（5 分钟）

**KR 轮转评分机制**:
```javascript
// 1. 从所有 KR 中选择评分最高的
const topKr = selectTopKrByRotation();

// 2. 查找该 KR 下的 queued 任务
const tasks = await pool.query(`
  SELECT t.*
  FROM tasks t
  JOIN project_kr_links pkl ON t.project_id = pkl.project_id
  WHERE pkl.kr_id = $1
    AND t.status = 'queued'
    AND t.prd_content IS NOT NULL  -- 必须有 PRD
`, [topKr.id]);

// 3. 检查 Project 的 repo_path
const project = await getProject(task.project_id);
if (!project.repo_path) {
  console.log('❌ Project missing repo_path, skip');
  continue;
}

// 4. 派发任务
await dispatchTask(task);
```

**Pre-flight 检查**:
- ✅ prd_content 存在
- ✅ repo_path 存在
- ✅ 资源可用（slot_budget.taskPool.available > 0）
- ✅ 无熔断

### Phase 4: Exploratory 继续拆解（decomposition-checker.js Check 7）

**触发**: 每次 tick（5 分钟）

**条件检测**:
```javascript
// 查找已完成的 exploratory 任务
const expTasks = await pool.query(`
  SELECT t.id, t.title, t.project_id, t.goal_id, t.payload
  FROM tasks t
  WHERE t.task_type = 'exploratory'          -- 必须是探索任务
    AND t.status = 'completed'               -- 已完成
    AND t.payload->>'next_action' = 'decompose'  -- 标记需要续拆
    AND t.completed_at > NOW() - INTERVAL '24 hours'  -- 去重窗口
`);

// 为每个 exploratory 任务创建"探索续拆"任务
for (const expTask of expTasks) {
  await createTask({
    title: `探索续拆: ${expTask.title}`,
    task_type: 'dev',
    payload: {
      decomposition: 'continue',       // 续拆标志
      exploratory_source: expTask.id,  -- 源探索任务
      findings: expTask.payload.findings  -- 探索结果
    }
  });
}
```

**秋米续拆**:
- 接收探索结果（findings）
- 基于探索结果创建具体的 dev Tasks
- 通过 Brain API 创建任务（POST /api/brain/action/create-task）

### Phase 5: Task 完成回调（routes.js POST /api/brain/execution-callback）

**触发**: Agent Worker（Caramel/小检/小审）完成任务后回调

**回调处理**:
```javascript
app.post('/api/brain/execution-callback', async (req, res) => {
  const { task_id, status, result } = req.body;

  // 1. 更新 Task 状态
  await pool.query(`
    UPDATE tasks
    SET status = $1, completed_at = NOW(), result = $2
    WHERE id = $3
  `, [status, result, task_id]);

  // 2. 发送事件给 Thalamus（L1 大脑）分析
  await emit('task_completed', { task_id, status, result });

  // 3. 如果是 exploratory 任务，Check 7 会在下次 tick 触发续拆
});
```

## 组件依赖

| 组件 | 文件 | 职责 |
|------|------|------|
| **OKR Tick** | brain/src/okr-tick.js | OKR 状态机，触发首次拆解 |
| **Executor** | brain/src/executor.js | 生成拆解 prompt，召唤秋米 |
| **秋米** | ~/.claude/skills/okr/ | OKR 拆解专家（Opus + /okr skill） |
| **Planner** | brain/src/planner.js | KR 轮转评分，任务选择 |
| **Decomposition Checker** | brain/src/decomposition-checker.js | Check 7: exploratory 续拆 |
| **Callback Handler** | brain/src/routes.js | POST /api/brain/execution-callback |
| **Thalamus** | brain/src/thalamus.js | L1 大脑，事件路由 |

## 关键数据库表

| 表 | 用途 |
|---|------|
| **goals** | 存储 Global OKR, Area OKR, KR (6 层前 3 层) |
| **projects** | 存储 Project 和 Initiative (type='project'/'initiative') |
| **project_kr_links** | 连接 KR 和 Project 的中间表 |
| **tasks** | 存储 Task（6 层最底层） |
| **project_repos** | Project 到 Repo 的多对多关联 |

## 关键字段

| 表.字段 | 说明 |
|---------|------|
| **goals.type** | 'global_okr', 'area_okr', 'kr' |
| **goals.parent_id** | 父子关系（Global OKR → Global KR, Area OKR → Area KR） |
| **goals.metadata.aligned_to_global_krs** | 指导关系（Global KR → Area OKR） |
| **projects.type** | 'project', 'initiative' |
| **projects.parent_id** | Initiative 的 parent_id 指向 Project |
| **tasks.task_type** | 'exploratory', 'dev', 'review', 'qa', 'audit' |
| **tasks.payload.decomposition** | 'true'(首次), 'continue'(续拆) |
| **tasks.payload.exploratory** | true/false（标识 exploratory 模式） |
| **tasks.payload.next_action** | 'decompose'（exploratory 任务完成后标记） |
| **tasks.prd_content** | PRD 内容（Planner 派发前检查） |

## Exploratory vs Known 模式对比

| 维度 | Exploratory（推荐） | Known |
|------|-------------------|-------|
| **适用场景** | 未知领域、需要探索 | 已知方案、明确需求 |
| **拆解策略** | 边拆边做，渐进式 | 一次性拆完 |
| **首次拆解** | 创建 1 个 exploratory 任务 | 创建 N 个 dev 任务 |
| **续拆触发** | Check 7 自动触发 | 无续拆 |
| **Task 类型** | task_type='exploratory' | task_type='dev' |
| **next_action** | 完成后设置 'decompose' | 无 |
| **风险控制** | 低（逐步验证） | 高（可能走弯路） |

## 监控指标

| 指标 | API 端点 | 说明 |
|------|----------|------|
| **OKR Tick 状态** | GET /api/brain/tick/status | enabled, loop_running, last_tick |
| **队列任务数** | GET /api/brain/tasks?status=queued | 当前排队任务数 |
| **Planner 派发率** | GET /api/brain/tick/status | last_dispatch |
| **Exploratory 续拆** | logs: `[decomp-checker] Created exploratory continue` | Check 7 触发日志 |
| **KR 进度** | GET /api/brain/goals?type=kr | 各 KR 的 status, progress |

## 常见问题排查

### 问题 1: 任务无法派发

**症状**: 队列有任务，但 Planner 不派发（last_dispatch: null）

**排查步骤**:
1. 检查任务是否有 PRD:
   ```sql
   SELECT title, (prd_content IS NOT NULL) as has_prd
   FROM tasks WHERE status = 'queued';
   ```
2. 检查 Project 是否有 repo_path:
   ```sql
   SELECT p.name, p.repo_path
   FROM projects p
   JOIN tasks t ON t.project_id = p.id
   WHERE t.status = 'queued';
   ```
3. 检查 project_kr_links 是否存在:
   ```sql
   SELECT * FROM project_kr_links;
   ```

**解决方案**:
- 补充 prd_content: 让秋米重新拆解或手动补充
- 补充 repo_path: UPDATE projects SET repo_path = '...' WHERE id = '...';
- 创建 project_kr_links: INSERT INTO project_kr_links ...

### 问题 2: Exploratory 续拆未触发

**症状**: exploratory 任务完成，但没有创建续拆任务

**排查步骤**:
1. 检查任务类型和 next_action:
   ```sql
   SELECT title, task_type, status, payload->>'next_action' as next_action
   FROM tasks
   WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours';
   ```
2. 检查是否已经创建续拆任务（去重）:
   ```sql
   SELECT title, payload->>'decomposition' as decomp_type
   FROM tasks
   WHERE payload->>'decomposition' = 'continue';
   ```

**解决方案**:
- task_type 必须是 'exploratory'（不是 'dev'）
- payload.next_action 必须是 'decompose'
- 如果是 known 模式，需要重新拆解为 exploratory 模式

### 问题 3: KR 一直停在 decomposing

**症状**: KR status='decomposing'，但没有任务创建

**排查步骤**:
1. 检查是否有 decomposition='true' 的任务:
   ```sql
   SELECT title, status, payload->>'decomposition'
   FROM tasks
   WHERE goal_id = '<kr_id>';
   ```
2. 检查 OKR Tick 是否运行:
   ```bash
   curl http://localhost:5221/api/brain/tick/status | jq '.enabled, .loop_running'
   ```

**解决方案**:
- 如果拆解任务失败，手动重置 KR: UPDATE goals SET status='ready' WHERE id='<kr_id>';
- 如果 OKR Tick 停止，重启 Brain 容器

## 最佳实践

1. **优先使用 Exploratory 模式**:
   - 未知领域必须用 exploratory
   - 已知领域也可以用 exploratory（验证假设）

2. **确保数据完整性**:
   - Project 必须有 repo_path
   - Task 必须有 prd_content
   - project_kr_links 必须建立关联

3. **监控关键指标**:
   - 每天检查队列任务数（应该逐渐减少）
   - 每周检查 KR 进度（应该逐步增长）
   - 失败任务率 < 10%

4. **定期清理**:
   - 完成的 KR 标记为 completed
   - 过期的 Area OKR 归档
   - 隔离区任务定期审查

## 相关文档

- `/home/xx/perfect21/cecelia/core/DEFINITION.md` - Cecelia 完整定义
- `/home/xx/perfect21/cecelia/core/docs/6-LAYER-OKR-HIERARCHY.md` - 6 层 OKR 架构详解
- `~/.claude/skills/okr/SKILL.md` - 秋米（OKR 拆解专家）定义
- `brain/src/decomposition-checker.js` - Check 7 源码
- `brain/src/planner.js` - Planner v2 源码
