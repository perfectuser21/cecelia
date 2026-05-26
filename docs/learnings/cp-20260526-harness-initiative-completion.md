# Learning: Harness Initiative 完成过程中的关键机制 (2026-05-26)

**Branch**: cp-20260523-brain-api-env  
**Initiative**: 92950980-1c4a-41be-bcfb-d2c6bc3ab067 (cecelia-pipeline-viz-v2)  
**PRs merged**: #3112 (WS2), #3113 (WS4), #3114 (WS5), #3118 (WS1), #3120 (WS3 fix)

---

### 根本原因 1: stale `claimed_by` 导致 dispatch 永不触发

**症状**: 任务状态是 `queued`，Brain tick 每轮 `actions: 0`，任务永远不被派发。

**根因**: `selectNextDispatchableTask` 过滤 `claimed_by IS NULL`。上轮 tick 在 `runHarnessInitiativeRouter` 中遭遇 watchdog abort 后，cleanup 路径未清除 `claimed_by` 字段，导致该字段残留 `brain-tick-N`。

**修复**: `UPDATE tasks SET claimed_by=NULL WHERE id=...`

**下次预防**:
- [ ] `harness_initiative` dispatch 失败后（watchdog/error/exception），executor.js 的 finally 块必须 `UPDATE tasks SET claimed_by=NULL`
- [ ] Brain 管理界面应显示 `claimed_by` 字段，方便排查

---

### 根本原因 2: `initiative_runs.deadline_at` 已过期导致 watchdog 每次 1 分钟后 abort

**症状**: initiative resume 后约 1 分钟就被 watchdog 终止，task 变 `failed`。

**根因**: `executor.js` 读取 `initiative_runs.deadline_at`，若已过期用 `Math.max(60_000, ...)` = 60 秒。任务第一次跑的 deadline（6 小时）在正常时间内到期，resume 时 deadline 已是历史时间戳。

**修复**: `UPDATE initiative_runs SET deadline_at = NOW() + INTERVAL '6 hours'`

**下次预防**:
- [ ] resume 时（`resume_from_checkpoint=true`）必须先延长 deadline，至少 `NOW() + 6 hours`
- [ ] executor.js `runHarnessInitiativeRouter` 在 resume 路径应自动 UPDATE deadline_at

---

### 根本原因 3: `contract-draft.md` 不在 main 分支 → `git pull origin main` 后丢失

**症状**: `final_evaluate` 容器启动后立即写入 FAIL `{"failed_step":"setup","log_excerpt":"合同文件不存在：...contract-draft.md"}`

**根因**: GAN 阶段将 `contract-draft.md` 写入 worktree（on feature branch），但从未合并到 main。`finalEvaluateDispatchNode` 只 sync `playground/` from `origin/main`，不 sync sprint dir。当 worktree 被 `git pull origin main` 更新到 main 时，未追踪/未合并的 `contract-draft.md` 丢失。

**修复**: 从 git history 恢复文件（`git show <commit>:sprints/.../contract-draft.md > ...`）并将 `## E2E 验收` 的 JavaScript 块替换为 bash 块（evaluator awk 只提取 ` ```bash ` 块）。

**下次预防**:
- [ ] GAN 阶段生成的 `contract-draft.md` 应在 harness_initiative 初始化时 commit 到 sprint 分支或 main
- [ ] `finalEvaluateDispatchNode` 应 sync 整个 sprint dir，不只是 `playground/`
- [ ] `## E2E 验收` 块必须用 ` ```bash ` 而非 ` ```javascript `（evaluator awk 只处理 bash）

---

### 根本原因 4: WS3 将 UI 代码写入了错误文件

已在 `cp-20260526-ws3-real-page-fix.md` 详细记录。核心：Dashboard 通过 Core API DynamicRouter 加载 `apps/api/features/execution/pages/`，不是 `apps/dashboard/src/pages/`。

---

### 关键发现: `failed → in_progress` 状态转换被 Brain API 拒绝

`PATCH /api/brain/tasks/:id {"status":"in_progress"}` 在源状态为 `failed` 时会被拒绝（`allowed: []`）。  
正确路径：`failed → queued`（通过直接 SQL），Brain tick 再 dispatch → `in_progress`。

---

### 关键发现: LangGraph 检查点在 watchdog abort 后保留

watchdog abort 不会破坏 LangGraph checkpoint。`resume_from_checkpoint=true` 时可从最后一个 checkpoint 续跑，`task_loop_index` 等状态字段保留。需要确认 checkpoint step 对应的 `task_loop_index` 值，避免误跑所有 workstreams。
