# 设计：机器+执行器路由 phase 2 — executor.js 派发收编

日期：2026-06-03
分支：cp-06031148-routing-phase2-executor
状态：设计已确认（主理人 2026-06-03），待实现
前置：phase 1（PR #3262，已合并）—— resolveExecutor + DB 设备表 + harness 收编

## 背景（探查修正）

phase 1 spec 说 phase 2 "把 executor.js 的 `selectBestMachine` 派发入口改走 resolveExecutor"。
探查发现:**`selectBestMachine` + 静态 `MACHINE_REGISTRY` 是死代码**——全文件只有定义（executor.js:202/228），
派发链从未调用（grep `selectBestMachine(` 仅命中定义本身）。

非 harness 任务的真实派发是 `triggerCeceliaRun(task)`（executor.js:3129）：按 task-router.js 的
`LOCATION_MAP` + `task_type_configs` 缓存（`getCachedLocation` / `getCachedConfig().executor`）分流：
- `location='xian'` → `triggerCodexBridge(task)`
- `location='xian_m1'` → `triggerCodexBridge(task, XIAN_M1_BRIDGE_URL)`
- `spec_review`/`code_review_gate` → `triggerLocalCodexExec`
- `location='us' + executor='codex'` → `triggerLocalCodexExec`
- `harness_initiative` → harness graph（phase 1 已收编）
- 默认 → US Claude（`EXECUTOR_BRIDGE_URL` cecelia-bridge :3457）

## 目标

让**经 `triggerCeceliaRun` 派发的非 harness 任务**（codex_qa / general / B 类等）也能按
`payload.{machine,executor}` 显式 override 路由（默认行为不变），并清掉死代码
`selectBestMachine` / `MACHINE_REGISTRY`。

**范围修正（探查发现，主理人决策）**：`dev` 任务走 dispatcher 的 `_dispatchViaWorkflowRuntime`
→ `runWorkflow('dev-task')` 的 **v2 workflow runtime，不经过 `triggerCeceliaRun`**，故本期
override 对 `dev` 不生效。这是有意的：**dev 跑 codex 已有独立 task_type `codex_dev`**
（location-map 天然路由西安），无需用 dev+override 重复表达。v2 runtime 接 override 留作后续，
本期不做（高风险动 graph-runtime、低价值）。

**用户规则**：默认美国 M4 + Claude；codex/西安仅按需（显式指定）。见 [[feedback-default-us-claude]]。

## 架构

### 单元 1：`triggerCeceliaRun` 顶部加显式 override 分支（接线）

在 `triggerCeceliaRun(task)` **最前面**（REVIEW 短路之后、location 路由之前）插入：

```
if (task.payload?.machine || task.payload?.executor) {
  let route;
  try { route = await resolveExecutor(task); }
  catch (err) {            // 非法组合 / 显式+DB失败 → loud-fail（不静默改派）
    await updateTaskStatus(task.id, 'failed', { error_message: `executor route: ${err.message}`.slice(0,500) });
    return { success: false, taskId: task.id, error: err.message, executor: 'route-rejected' };
  }
  if (route.executor === 'codex') return triggerCodexBridge(task, route.url);
  // route.executor === 'claude' → 落到下面 US Claude 默认派发（route.url 当前=us-m4 cecelia-bridge）
}
```

- codex override → `triggerCodexBridge(task, route.url)`（route.url = 该机器 codex daemon，如 xian-m4 worker-daemon）。
- claude override → 继续走函数下方 US Claude 默认路径（本期 claude 只在 us-m4 部署，route.url 即 EXECUTOR_BRIDGE_URL；不另起分支，避免重复派发逻辑）。
- resolveExecutor 抛错 → 任务 failed + 清晰 reason，**不偷偷改派**。
- **无 `payload.machine`/`payload.executor` → 完全跳过本分支，走现有 location-map 路由（零回归）。**

### 单元 2：删死代码 `selectBestMachine` / `MACHINE_REGISTRY`

- 删 executor.js:202-249 的 `MACHINE_REGISTRY` 常量 + `selectBestMachine` 函数。
- 删 module.exports 里的 `MACHINE_REGISTRY` / `selectBestMachine`（executor.js:4042-4043）。
- 删/更新引用它们的测试（grep `MACHINE_REGISTRY`/`selectBestMachine` 全 repo；任何 import 这两个的测试改成 resolveExecutor 或删除）。
- `selectBestBridge`（codex 多 bridge 负载）保留——它仍被 triggerCodexBridge 实际使用，不是死代码。

## 错误处理

- 显式 `{machine,executor}` 非法组合 / 显式+DB读取失败 → resolveExecutor 抛 `ExecutorRouteError` → 任务 failed（loud），不降级改派。
- 无显式偏好 → 现有 location-map 路由（含其自身降级）完全不变。

## 测试策略

- **单元**（`executor.test.js` 或新 `triggerCeceliaRun-route-override.test.js`，注入 resolveExecutor / trigger* mock）：
  - payload.executor=codex + machine=xian-m4 → 调 `triggerCodexBridge(task, <route.url>)`。
  - payload.executor=claude → 不调 codex bridge，落默认 US 路径。
  - resolveExecutor 抛错 → 任务标 failed + 不派发。
  - **无 payload.machine/executor → 现有 location 路由完全不变**（回归保护：location='xian' 仍 triggerCodexBridge，默认仍 US claude）。
- **死代码删除回归**：grep 确认全 repo 无 `selectBestMachine` / `MACHINE_REGISTRY` 残留引用；现有 executor 测试套件全绿。
- **CI 治理**：feat+brain/src → 配 `packages/brain/scripts/smoke/<feature>-smoke.sh`（≥5 实行 + ≥1 真命令）；改/增 brain/src js → 配套 test（lint-test-pairing）。

## 不做（YAGNI）

- 不改 task-router.js 的 LOCATION_MAP / task_type_configs 默认（默认路由维持现状）。
- 不加新 executor 类型 / 新机器组合（海口 M5 等用 machines POST 注册即可）。
- 不动 worker-daemon、不动 harness 路径（phase 1 已完成）。
