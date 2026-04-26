# PRD: harness_planner 退役 + cleanup stub 文件

## 背景
PR #2640 投产 harness_initiative full graph A+B+C 后，老的 harness_planner 6 节点 GAN pipeline 功能被覆盖。Audit 显示**没有真实 caller** 派 harness_planner：
- 14 天 17 个 task 全是 watchdog 重派的 zombie（payload 含 `watchdog_retry_count` / `liveness_probe_failed` / `process_disappeared`）
- 生产代码里 0 处 INSERT INTO tasks 写 harness_planner（仅 integration test）
- harness-initiative.graph.js 里的 4 处 `task_type='harness_planner'` 是 docker spawn 时的**容器内部 CECELIA_TASK_TYPE env 标签**（让容器选 Planner SKILL），不入 Brain queue

## 目标
退役 harness_planner 入口 + cleanup PR #2640 / PR #2652 之后留下的 deprecation stub 文件，让 harness_initiative 成为唯一 harness pipeline 入口。

## 范围

### 一、路由收紧（让 harness_planner 入口失效）
- `packages/brain/src/executor.js`：删 harness_planner 路由分支（line 2841-2870 附近），归入 `_RETIRED_HARNESS_TYPES`（terminal_failure 标记，与 4 retired type 同处理）

### 二、抽函数 + 删 GAN pipeline 实现
- **先抽**：把 `harness-graph.js` 里的 `parseDockerOutput` + `extractField` 两个**纯函数**搬到 `packages/brain/src/parse-docker-output.js`（新文件，~50 行），更新 `docker-executor.js:56` 的 import 路径
- **再删**：`packages/brain/src/harness-graph.js`（43KB，6 节点 GAN graph 主文件）
- **再删**：`packages/brain/src/harness-graph-runner.js`（5KB，runHarnessPipeline 入口）

### 三、删 stub / dead-code 文件
- `packages/brain/src/harness-watcher.js`（PR #2640 缩成 stub）
- `packages/brain/src/harness-phase-advancer.js`（PR #2640 缩成 stub）
- `packages/brain/src/harness-initiative-runner.js`（v2 Phase C4 shim，re-export only）
- `packages/brain/src/harness-task-dispatch.js`（Phase B harness_task dispatcher，6.9KB；harness_task 已 retired，dead code）
- **不删** `harness-final-e2e.js` —— Sprint 1 后只剩 5 个工具函数（runScenarioCommand / normalizeAcceptance / bootstrapE2E / teardownE2E / attributeFailures），仍被 `harness-initiative.graph.js` 的 `finalE2eNode` 调用

### 四、清理 routes 查询
- `packages/brain/src/routes/goals.js:89` 删 `WHERE task_type='harness_planner'` 查询行
- `packages/brain/src/routes/status.js:518` 同上
- `packages/brain/src/routes/harness.js:104,729,738,767` 删 / 改成 `task_type='harness_initiative'`

### 五、task-router 规整
- `packages/brain/src/task-router.js` VALID_TASK_TYPES 把 `harness_planner` 移除（移到 retired_types）；LOCATION_MAP 同步删 `'harness_planner': 'us'`

### 六、保留（不删）
- `harness-initiative.graph.js:117/603/856` 的 `task_type: 'harness_planner'` —— 这是 docker spawn 时 CECELIA_TASK_TYPE env 标签，让容器内选 Planner SKILL（与 Brain queue 无关）。**保留**

### 七、测试更新
- 删用例：
  - `packages/brain/src/__tests__/harness-graph.test.js`（整文件，graph 已删）
  - `packages/brain/src/__tests__/harness-graph-runner-default-executor.test.js`（整文件）
  - `packages/brain/src/__tests__/harness-pipeline-steps.test.js`（如只测 harness_planner）
  - `packages/brain/src/__tests__/harness-pipelines-list.test.js` 中 harness_planner stage 用例
  - `packages/brain/src/__tests__/executor-default-langgraph.test.js`（PR #2652 加的，验证 harness_planner 走 LangGraph，现已退役）
- 新增 `packages/brain/src/__tests__/executor-harness-planner-retired.test.js`：验证 harness_planner task 被标 terminal_failure，不进入 pipeline

### 八、Brain 版本 bump
- 1.224.0 → 1.225.0
- 5 处同步：package.json + package-lock.json (双处) + .brain-versions + DEFINITION.md

## 不做
- L1/L3 三层架构（单独立项）
- Pipeline 注册协议（单独立项）
- content-pipeline 搬回 Cecelia
- **不删** docker 容器内的 `CECELIA_TASK_TYPE='harness_planner'` 标签（容器内 SKILL 路由仍需要）

## 成功标准
1. **行为层**：派一个 harness_planner task 到 Brain → executor 立即标 terminal_failure（不进入 6 节点 pipeline，不 spawn docker）
2. **代码层**：grep `harness-graph` / `harness-graph-runner` / `harness-watcher` / `harness-phase-advancer` / `harness-initiative-runner` / `harness-task-dispatch` 在 `packages/brain/src/`（排除 `__tests__/`）→ 0 行
3. **routes 层**：grep `WHERE task_type.*harness_planner` 在 `packages/brain/src/routes/` → 0 行
4. **CI 层**：所有 brain CI 全绿
5. **回归层**：harness_initiative full graph 行为不变（real test 验证）

## DoD
- [ ] [BEHAVIOR] executor.js: harness_planner task 路由到 retired terminal_failure / Test: `packages/brain/src/__tests__/executor-harness-planner-retired.test.js`
- [ ] [ARTIFACT] 删 `harness-graph.js` / Test: `manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-graph.js');process.exit(1)}catch(e){process.exit(0)}"`
- [ ] [ARTIFACT] 删 `harness-graph-runner.js` / Test: `manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-graph-runner.js');process.exit(1)}catch(e){process.exit(0)}"`
- [ ] [ARTIFACT] 删 `harness-watcher.js` / Test: `manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-watcher.js');process.exit(1)}catch(e){process.exit(0)}"`
- [ ] [ARTIFACT] 删 `harness-phase-advancer.js` / Test: `manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-phase-advancer.js');process.exit(1)}catch(e){process.exit(0)}"`
- [ ] [ARTIFACT] 删 `harness-initiative-runner.js` / Test: `manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-initiative-runner.js');process.exit(1)}catch(e){process.exit(0)}"`
- [ ] [BEHAVIOR] routes/goals.js / status.js / harness.js 不再查询 harness_planner / Test: `manual:node -e "['routes/goals.js','routes/status.js','routes/harness.js'].forEach(f=>{const c=require('fs').readFileSync('packages/brain/src/'+f,'utf8');if(c.match(/WHERE\s+task_type[^=]*=[^=]*['\"]harness_planner/i))process.exit(1);});process.exit(0)"`
- [ ] [ARTIFACT] task-router.js VALID_TASK_TYPES 不含 harness_planner / Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const m=c.match(/VALID_TASK_TYPES[\s\S]+?\]/);if(!m||m[0].includes('harness_planner'))process.exit(1)"`

## 风险与缓解
- **风险**：还有 zombie harness_planner task 在 queue 里被 watchdog 重派 → terminal_failure 标记后会突然变多失败 task
- **缓解**：本 PR 合并前先批量 cancel 所有 queued/in_progress 的 harness_planner task（DB 一条 UPDATE）
- **风险**：dashboard 的 pipeline 列表页面如果显示 harness_planner stage 信息可能会缺
- **缓解**：harness_initiative 的 planner 节点状态由 graph trace / cecelia_events 体现，dashboard 改为读 graph_checkpoints 即可（如真有缺失，单独 PR 修 dashboard）
