# Design: 退役 harness_planner pipeline + cleanup stub 文件

**日期**：2026-04-26
**Brain Task**：10413e0d-0c22-4dee-8970-e32f98f33df6
**分支**：cp-0426202418-retire-harness-planner
**接续**：PR #2652（flip default LangGraph flags）→ 本 PR 把 harness_planner 老 pipeline + 4 个 stub 一并清

---

## 一、问题陈述

PR #2640 把 `harness_initiative` 投产成 full graph A+B+C 后，老的 `harness_planner` 6 节点 GAN pipeline 功能被覆盖。但**没人清退役**，结果：
- `executor.js:2841` 还有 `harness_planner` 路由 → `runHarnessPipeline`（6 节点 pipeline）
- 4 个 stub 文件（PR #2640 缩成 deprecation 标记）继续躺在 `packages/brain/src/`
- routes 层（goals/status/harness）仍 SQL 查询 `WHERE task_type='harness_planner'`
- `task-router.js` VALID_TASK_TYPES 仍接受 `harness_planner`

**Audit 数据（2026-04-12 ~ 04-26）**：
- 14 天 17 个 `harness_planner` task：**16 个 auto 都是 watchdog 重派的 zombie**（payload 含 `liveness_probe_failed` / `process_disappeared` / `watchdog_retry_count`），1 个 manual 是测试派的
- 生产代码 0 处 `INSERT INTO tasks(... task_type='harness_planner' ...)`（仅 integration test）
- `harness-initiative.graph.js:117/603/856` 的 `task_type:'harness_planner'` 是 **docker spawn 时的 CECELIA_TASK_TYPE env 标签**（让容器内选 Planner SKILL），不入 Brain queue

可以**安全退役**。

---

## 二、目标

让 `harness_initiative` 成为唯一 harness pipeline 入口。删 6 节点 GAN pipeline 实现 + 4 个 stub + 路由 + routes 查询。

---

## 三、不做（明确边界）

- L1/L3 三层架构切完 — 单独立项
- Pipeline 注册协议（各 repo 注册自己的 graph）— 单独立项
- content-pipeline 搬回 Cecelia — 边界另议
- **不删** `harness-initiative.graph.js:117/603/856` 的 `task_type:'harness_planner'` 标签 — 它是 docker 容器内部 SKILL 路由用的 env 字符串，不入 Brain queue，与本 PR 无关
- **不删** `harness-final-e2e.js` — Sprint 1 后仅剩 5 个工具函数（runScenarioCommand / normalizeAcceptance / bootstrapE2E / teardownE2E / attributeFailures），仍被 `harness-initiative.graph.js` 的 `finalE2eNode` 调用

---

## 四、设计

### 4.1 改动单元（7 处）

**单元 A：抽 harness-shared 工具集（3 函数 + 3 处 import）**
- **新建** `packages/brain/src/harness-shared.js`（~80 行）
- 把 `harness-graph.js` 的 **3 个被外部依赖的 export** 整体搬过去（保持 signature 不变）：
  - `parseDockerOutput(stdout)` (line 154)
  - `extractField(text, fieldName)` (line 209)
  - `loadSkillContent(skillName)` (line 46)
- 更新 **3 处生产 import**（一处都不能漏）：
  - `packages/brain/src/docker-executor.js:56`：`from './harness-graph.js'` → `from './harness-shared.js'`（imports `parseDockerOutput`, `extractField`）
  - `packages/brain/src/workflows/harness-initiative.graph.js:30`：`from '../harness-graph.js'` → `from '../harness-shared.js'`（imports `parseDockerOutput`, `loadSkillContent`）
  - `packages/brain/src/workflows/harness-task.graph.js:33`：`from '../harness-graph.js'` → `from '../harness-shared.js'`（imports `parseDockerOutput`, `extractField`）
- `harness-task-dispatch.js:5` 不用改（整文件即将删除）
- **不影响** `workflows/content-pipeline.graph.js` —— 它自己 copy 了一份相同名称的函数（line 43/61/82），独立不依赖 harness-graph.js

**单元 B：删 GAN pipeline 实现**
- 删 `packages/brain/src/harness-graph.js`（43KB，6 节点）
- 删 `packages/brain/src/harness-graph-runner.js`（5KB，runHarnessPipeline 入口）

**单元 C：删 4 个 stub / dead-code 文件**
- 删 `packages/brain/src/harness-watcher.js`（PR #2640 缩成 stub）
- 删 `packages/brain/src/harness-phase-advancer.js`（PR #2640 缩成 stub）
- 删 `packages/brain/src/harness-initiative-runner.js`（v2 Phase C4 re-export shim）
- 删 `packages/brain/src/harness-task-dispatch.js`（Phase B harness_task dispatcher，dead code，harness_task 已 retired）

**单元 D：路由收紧**
- `packages/brain/src/executor.js:2841` 删 `if (task.task_type === 'harness_planner')` 整段路由分支
- 把 `harness_planner` 加入 `_RETIRED_HARNESS_TYPES` Set（line 2861 附近，与 4 retired type 同处理 → terminal_failure）
- 删 `executor.js` 顶部 dynamic import `runHarnessPipeline` / 任何残留引用

**单元 E：routes 清理**
- `packages/brain/src/routes/goals.js:89` 删 harness_planner 计数 SQL
- `packages/brain/src/routes/status.js:518` 同上
- `packages/brain/src/routes/harness.js:104,729,738,767` 删 / 改 SQL（评估每处实际语义后定夺：planner pipeline 列表 / 阶段统计这种页面相关的查询要么改成 LIKE 'harness_%' 要么直接删 row）

**单元 F：task-router 规整**
- `packages/brain/src/task-router.js` VALID_TASK_TYPES 把 `harness_planner` 移除
- LOCATION_MAP 同步删 `'harness_planner': 'us'`
- 加注释 `// harness_planner: retired in PR <this>; subsumed by harness_initiative full graph`

**单元 G：Brain 版本 bump 1.224.0 → 1.225.0**
- `packages/brain/package.json` + `package-lock.json`（双处）+ `.brain-versions` + `DEFINITION.md` 同步

### 4.2 测试更新

**删用例**：
- `packages/brain/src/__tests__/harness-graph.test.js`（整文件）
- `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js`（整文件）
- `packages/brain/src/__tests__/harness-pipeline-steps.test.js`（如只测 harness_planner）
- `packages/brain/src/__tests__/executor-default-langgraph.test.js`（PR #2652 加的，验证 harness_planner 走 LangGraph）
- `packages/brain/src/__tests__/harness-pipelines-list.test.js` 中 harness_planner stage 用例
- `packages/brain/src/__tests__/harness-task-dispatch.test.js`（如存在；harness_task 已 retired）
- 任何 import 删除文件的测试 → 同步删

**新增**：
- `packages/brain/src/__tests__/executor-harness-planner-retired.test.js` — 验证 harness_planner task 路由到 terminal_failure，**不**进 6 节点 pipeline
- `packages/brain/src/__tests__/parse-docker-output.test.js` — 把搬出去的纯函数测试覆盖（如原 harness-graph.test.js 包含这两个函数的用例，迁过来）

---

## 五、数据流

**改动前**（`harness_planner` task 进 Brain queue）：
```
Brain task (harness_planner)
  → tick → executor.js:2841
  → runHarnessPipeline → 6 节点 GAN graph (harness-graph.js)
  → 每节点 spawn docker
```

**改动后**（`harness_planner` task 进 Brain queue）：
```
Brain task (harness_planner)
  → tick → executor.js retired branch
  → terminal_failure 标记，不 spawn docker
```

**主路径不变**（`harness_initiative` task 进 Brain queue）：
```
Brain task (harness_initiative)
  → tick → executor.js (default LangGraph)
  → compileHarnessFullGraph → 7+ 节点 (planner→...→fanout→sub_task→join→finalE2e→report)
  → 节点内 spawn docker（其中 planner / ganLoop / inferTaskPlan 节点 spawn 时把 CECELIA_TASK_TYPE='harness_planner' 当 SKILL 路由标签传给容器；这是容器内部用，不入 Brain queue）
```

---

## 六、风险与缓解

**风险 1**：还有 zombie `harness_planner` task 在 queue 里被 watchdog 重派 → 退役后会突然变多 terminal_failure 标记
**缓解**：本 PR 合并前先批量 cancel 所有 queued/in_progress 的 `harness_planner` task：
```sql
UPDATE tasks SET status='canceled', completed_at=NOW(),
  error_message='superseded by harness_initiative; manually canceled before retirement PR merge'
WHERE task_type='harness_planner' AND status IN ('queued','in_progress');
```

**风险 2**：dashboard 的 pipeline 列表页面如果显示 harness_planner stage 信息可能会缺
**缓解**：harness_initiative full graph 的 planner 节点状态由 `cecelia_events` (event_type='langgraph_step') 和 PgCheckpointer 体现。dashboard 改读 graph_checkpoints 即可（如真有缺失，单独 PR 修 dashboard）

**风险 3**：抽 `parseDockerOutput` / `extractField` 时如果 signature 变了会破坏 docker-executor.js
**缓解**：纯文本搬运，不改函数签名；改 import 路径后跑全 brain 测试套件（docker-executor 的 unit + integration test 都会触发）

**风险 4**：还有别人未发现的代码 import 删除文件
**缓解**：删除前 grep `from.*harness-graph|from.*harness-graph-runner|from.*harness-watcher|from.*harness-phase-advancer|from.*harness-initiative-runner|from.*harness-task-dispatch` 在整个 monorepo 内（非 docs/specs/learnings）→ 必须 0 行后再删

---

## 七、测试策略

### 单测（CI 自动跑）
- 新增 `executor-harness-planner-retired.test.js`：mock executor 输入一个 `harness_planner` task，验证 status='failed' 且 `failure_class='pipeline_terminal_failure'`
- 新增 `parse-docker-output.test.js`：覆盖 `parseDockerOutput` + `extractField` 各种输入（迁移自 harness-graph.test.js 相关用例）
- 跑 `docker-executor` 现有 test 验证 import 路径切换无破坏
- 全 brain 套件 GREEN

### 手动验证（PR 合并后真实测试）
- DB 派一个 `harness_planner` task 到 Brain queue → 派发后立刻看到 status='failed' + error_message 含 'retired'
- DB 派一个 `harness_initiative` task → full graph 正常跑（行为不变）
- grep `harness-graph` / `harness-graph-runner` / `harness-watcher` / `harness-phase-advancer` / `harness-initiative-runner` / `harness-task-dispatch` 在 `packages/brain/src/`（排除 `__tests__/`）→ 0 行

---

## 八、成功标准

1. **代码层**：
   - `packages/brain/src/` 下不存在 6 个被删文件
   - `executor.js` 不再有 `harness_planner` 路由分支
   - `task-router.js` VALID_TASK_TYPES 不含 `harness_planner`
   - routes/goals.js / status.js / harness.js 不再 SQL 查询 `harness_planner`
2. **行为层**：派 `harness_planner` task → terminal_failure 标记，不 spawn docker
3. **回归层**：`harness_initiative` full graph 行为不变（PgCheckpointer 落库 + 7 节点 trace）
4. **CI 层**：所有 brain CI（L1/L2/L3/L4）全绿

---

## 九、依赖与前置

- ✅ PR #2652 已合并（删 fallback gate，graph 是唯一路径）
- ✅ PR #2640 已合并（投产 full graph + 4 task_type retired）
- ✅ harness-final-e2e.js 是工具集（确认未删）
- ✅ Audit 完成：14 天无真实 caller 派 harness_planner（仅 zombie + 测试）

无新增依赖。
