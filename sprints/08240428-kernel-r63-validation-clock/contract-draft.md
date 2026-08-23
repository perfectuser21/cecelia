# Sprint Contract Draft (Round 2)

## Notes

- 权威实现基线：`09d1a044c94f888ea365759dbfbe947a4f5f4801`；本角色 checkout SHA 不替代该基线。
- `[MAP_NOT_CONFIGURED]`：payload 缺 `map_repo`，不猜测 Unified Map revision 或 must-run assertions。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务是纯函数内部改动，无 HTTP 响应。公开返回仍为冻结对象：
`{pipeline_started_at: ISO-8601 string, deadline_at: ISO-8601 string}`。

## 已知约束

- [sprint-prd.md/Invariant] 冻结测试必须真 import `validation-clock.js`，禁止 mock 被改边。
- [累积FR] 本 line 暂无历史。
- context-manifest: PRD 已冻结为“本 line 暂无历史”，本轮不引入额外 FR。
- [现有实现] `persistedClock` 校验持久化 started/deadline 配对；非法 clock 与 timeout 的异常语义不得回退。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 仅被后续 `effect:attempt_launched` 回执按 `dispatch_hop` 绑定的 `spawn:generator-fix` intent，以 intent 行时间刷新 pipeline clock，最多 6 次。 |
| NFR（做得多好） | 纯函数、可重放；默认/传入 timeout 不变；相同日志得到相同冻结结果。 |
| Invariant（永不违反） | 不改人审 deadline；第 7 次及后续 fix 不延寿；无 fix 路径语义不变。 |
| 判定点（怎么知道） | 见下方；单独的 spawn intent 不代表成功，必须有 `effect:attempt_launched` 且 `detail.dispatch_action="spawn:generator-fix"`、`detail.dispatch_hop=<intent.hop>` 精确回绑。 |
| 保质期（何时过期） | 规则随 validation-clock 合同存在；上限或日志 schema 变化时需新合同更新。 |
| 死亡告警（停了谁知道） | 冻结回归测试在 required CI 首次运行即报告。 |
| 失败语义（挂了怎么办） | clock 输入非法继续 fail-closed 抛错；超过 6 次按第 6 次 deadline 判死。 |
| 效果确认（已发≠已生效） | 直接断言返回原点和 deadline；不以日志存在或测试文件文本自证。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 成功 fix 派发的识别 | A. 仅看 spawn intent；B. 用 `effect:attempt_launched.detail.dispatch_hop` 与 `dispatch_action` 回绑 intent | B | `loop.js` 在真实 dispatch 前先写 intent，只有 `controlStatus === "LAUNCHED"` 才追加 effect marker | 失败 intent 被误算会无故延寿 |
| fix 顺序 | A. 数组物理顺序；B. 数值 hop 顺序 | B | PRD 字面要求 hop 时序与可重放 | 乱序输入产生不同 deadline |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| timeout/时间字段非法 | 抛既有 validation clock 错误 | 是 | 无静默兜底 |
| 第 7 次及后续 fix | 保留第 6 次有效原点，不再刷新 | 是 | deadline 到期照常判死 |
| fix intent 无成功回执或回执 action/hop 不匹配 | 忽略该 intent，不刷新 clock | 是 | 继续使用最近一个已证实成功的原点 |
| 无 fix 行 | 使用初始 generator 原点 | 是 | 保持旧语义 |

### 输入对抗面

N/A — 纯内部编排函数，不对外暴露 agent 输入入口；仍将乱序 hop、无效时间与超限作为测试边界。

## 真实调用方请求 shape

N/A — 本任务不新增设备、agent 或 HTTP 调用；`loop.js` 继续以 `{ action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin }` 调用纯函数。

## 禁 mock 边清单

- `resolveValidationClock` ↔ `orchestrator_decision_log` 行 shape（测试必须使用 `loop.js` 真实持久化的 intent `{hop,action,created_at,detail:{pipeline_started_at,deadline_at,...}}` 与成功 effect `{action:"effect:attempt_launched",detail:{dispatch_hop,dispatch_action,run_id,attempt_id,...}}`，禁止 mock 函数或把 intent 本身当成功）。
- `validation-clock.js` ↔ `loop.js` 调用接缝（本 Sprint 仅冻结函数级真实 import；真库 loop 集成明确登记为未覆盖，不得宣称已验）。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| 真 PostgreSQL `orchestrator_decision_log` → `loop.js` → validation clock | PRD 明确要求本 Sprint 登记而不扩大到真库集成 | 后续独立 integration sprint 在 attempt-scoped Postgres 跑真实 loop；本次状态为 `logic-done-pending` |

## 接缝清单

- 真库日志读取与 `loop.js` 参数接力：本合同只验纯函数真实 import，未真验标为 `logic-done-pending`，不作为本 Sprint done 条件冒充完成。

## Golden Path

覆盖父路 `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 第 1-4 步。

[决策日志] → [effect 回绑成功 fix intent] → [按 hop 选最多 6 个] → [重算同一 timeout] → [返回确定 clock]

### Step 1: r50 类健康 fix 刷新原点
**来源**: `[FROM_PRD]` — “最近一次成功 spawn:generator-fix 后仍在时限内，系统判定 run 存活”。

**可观测行为**: r50 真实 shape 中 fix intent 自带旧 clock，随后 `effect:attempt_launched` 以 `dispatch_hop` 回绑；返回 clock 的原点变为该成功 fix intent 的 `created_at`。

**硬阈值与验证命令**: `pipeline_started_at` 等于最新且不超过上限的 fix 时间，deadline 恰为原点 + `timeoutSeconds`。
```bash
npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t 'r50 场景：最近成功 fix 刷新原点并保持存活'
```

### Step 2: 未成功 fix intent 不刷新原点
**来源**: `[FROM_PRD]` — “仅日志行存在但未表达派发成功：不得作为新原点”。

**可观测行为**: 只有 `spawn:generator-fix` intent、或 effect 的 `dispatch_action`/`dispatch_hop` 不匹配时，clock 仍使用此前已证实的原点。

**硬阈值与验证命令**: 未回绑 intent 的时间绝不成为 `pipeline_started_at`。
```bash
npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t '失败或被阻止的 fix intent 不刷新原点'
```

### Step 3: 乱序输入仍按 hop 可重放
**来源**: `[FROM_PRD]` — “只依赖 orchestrator_decision_log 行 hop 时序，相同输入可重放出相同结果”。

**可观测行为**: 物理数组乱序不影响选择，重复调用得到完全相同的冻结 clock。

**硬阈值与验证命令**: 两次结果深相等，原点对应最大合格 hop。
```bash
npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t '乱序日志按 hop 可重放'
```

### Step 4: 顺延严格封顶 6 次
**来源**: `[FROM_PRD]` — “出现第 7 次或更多 fix 轮时不再顺延”。

**可观测行为**: 第 7 次 fix 不改变第 6 次形成的 clock。

**硬阈值与验证命令**: 原点等于第 6 次 fix，绝不等于第 7 次。
```bash
npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t '第 7 次 fix 不再延长 deadline'
```

### Step 5: 无 fix 轮语义不变
**来源**: `[FROM_PRD]` — “没有 fix 轮的日志保持现有 spawn:generator 原点”。

**可观测行为**: 仅初始 generator 时仍按其持久化时间计算 clock。

**硬阈值与验证命令**: 原点和 deadline 与旧算法字面一致。
```bash
npx vitest run --no-cache sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts -t '无 fix 轮保持原有 generator clock'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 重复 hop、非数值 hop、缺 created_at 的 fix intent、effect 回绑不存在的 dispatch hop。
- 重复提交: 相同 decision log 连续求值两次。
- 中途中断: N/A，纯同步函数无中断状态。
- 边界值: 0、1、6、7 个 fix；恰好 deadline 边界。
发现分级: P0/P1（无界延寿或健康 run 误杀）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/08240428-kernel-r63-validation-clock"
test "$(git merge-base HEAD 09d1a044c94f888ea365759dbfbe947a4f5f4801)" = "09d1a044c94f888ea365759dbfbe947a4f5f4801"
npx vitest run --no-cache "$SPRINT_DIR/tests/validation-clock-fix-extension.test.ts" tests/gp/f1/validation-clock-fix-extension.test.js --reporter=verbose
node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{if(typeof m.resolveValidationClock!=='function')process.exit(1)})"
echo 'validation-clock Golden Path verified'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结合同测试 | `sprints/08240428-kernel-r63-validation-clock/tests/validation-clock-fix-extension.test.ts` | `r50 场景：最近成功 fix 刷新原点并保持存活`; `失败或被阻止的 fix intent 不刷新原点`; `乱序日志按 hop 可重放`; `第 7 次 fix 不再延长 deadline`; `无 fix 轮保持原有 generator clock` | 当前实现 r50/乱序/封顶用例失败 |
| required CI 回归测试 | `tests/gp/f1/validation-clock-fix-extension.test.js` | `r50 场景：最近成功 fix 刷新原点并保持存活`; `失败或被阻止的 fix intent 不刷新原点`; `乱序日志按 hop 可重放`; `第 7 次 fix 不再延长 deadline`; `无 fix 轮保持原有 generator clock` | 与冻结测试同源，当前实现 RED |
