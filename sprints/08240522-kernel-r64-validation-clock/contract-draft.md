# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应；对外结果为 `resolveValidationClock()` 返回的 `pipeline_started_at` 与 `deadline_at`。

## 已知约束

- `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` → 首次 Generator 建立共享时钟；下游复用持久化时钟；畸形时钟 fail-closed；authoring role 不建钟。
- `[累积FR]` 本 line 暂无历史行为。
- `[MAP_NOT_CONFIGURED]` payload 缺 `map_repo`，无 `must_run_assertions`；不回退到领域硬编码。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 成功派发的 `spawn:generator-fix` 以派发 intent 的 `created_at` 重置 pipeline clock，最多 6 次。 |
| NFR（做得多好） | 默认 5400 秒不变；纯函数按 hop 可重放。 |
| Invariant（永不违反） | 仅有匹配 `attempt:launched` receipt 的 fix 生效；第 7 次不生效；无 fix 语义不变。 |
| 判定点（怎么知道） | `attempt:launched.detail.dispatch_hop` 与 `dispatch_action` 共同证明对应 fix 派发成功。 |
| 保质期（何时过期） | 随 decision-log schema 变更复核；常量 6 由本合同冻结。 |
| 死亡告警（停了谁知道） | required Sprint Tests/F1 regression 在 CI 当次失败即通知 PR 作者。 |
| 失败语义（挂了怎么办） | 缺失/不匹配 launch receipt 不顺延；畸形持久化时钟继续 fail-closed。 |
| 效果确认（已发≠已生效） | 比较纯函数返回的新原点和 deadline，并由调用方用 deadline 判活。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| fix 是否成功派发 | 仅看 spawn intent；匹配 attempt:launched receipt | 匹配 receipt 的 dispatch_hop 与 dispatch_action | `loop.js` 仅在 controlStatus=LAUNCHED 后追加该 receipt | 未派发的 fix 错误续命 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| fix intent 无 launch receipt | 不顺延 | 是，重放同日志结果一致 | 沿用上一个合法原点 |
| 超过 6 次成功 fix | 第 7 次起不顺延 | 是 | 沿用第 6 次 deadline 并照常超时 |
| 持久化 clock 畸形 | 抛 `validation_clock_invalid` | 是 | fail-closed |

### 输入对抗面

N/A — 内部纯函数，不对外暴露 agent 输入。

gp-anchor: skipped (product-map.json not found)

## Golden Path

覆盖父路 `kernel Harness validation pipeline` 第 1-4 步

[已建钟 run] → [识别成功 fix receipt] → [取前 6 次中最新原点] → [返回有界 deadline]

### Step 1: 保留原始 validation clock
**来源**: `[FROM_PRD]` — “无 fix 轮的 run 继续以原始 spawn:generator 为时钟原点”。

**可观测行为**: 无成功 fix 时返回原始 `pipeline_started_at` 和原 deadline。

**验证命令**: `npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t '没有成功 launch receipt'`

**硬阈值**: 原点与 deadline 字面相等；命令 exit 0。

### Step 2: 用成功 fix 派发重置时钟
**来源**: `[FROM_PRD]` — “每次 spawn:generator-fix 派发成功时以该行为新原点”。

**可观测行为**: r50 型场景返回最近一次成功 fix intent 的 `created_at` 及其加 `timeout_seconds` 的 deadline。

**验证命令**: `npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t 'r50 场景'`

**硬阈值**: 三次成功 fix 后原点为 `00:03:00Z`、deadline 为 `00:04:40Z`；命令 exit 0。

### Step 3: 按 hop 可重放且最多顺延六次
**来源**: `[FROM_PRD]` — “顺延有界：上限 6 次”及“只依赖 orchestrator_decision_log 行 hop 时序”。

**可观测行为**: 输入数组物理顺序变化不改变结果；第 7 次 receipt 不替换第 6 次建立的原点。

**验证命令**: `npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t '六次|第七次'`

**硬阈值**: 原点固定为第 6 次 `00:06:00Z`、deadline `00:07:40Z`；命令 exit 0。

### Step 4: 仅成功派发贡献顺延
**来源**: `[AI_ADDED]` — 把 PRD 的“派发成功”冻结为 loop.js 的 `attempt:launched` receipt，防止仅持久化 intent 但 dispatch 前失败时假续命。

**可观测行为**: 无匹配 launch receipt 的 fix intent 不改变时钟；receipt 必须同时匹配 fix intent 的 `dispatch_hop` 与 `dispatch_action=spawn:generator-fix`；同一 fix 的重复 receipt 最多计数一次。

**验证命令**: `npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts -t '没有成功 launch receipt|重复 launch receipt|dispatch_hop 或 dispatch_action'`

**硬阈值**: 无 receipt 或 hop/action 不匹配时返回原始 clock；重复 receipt 不占用额外顺延名额，第六个唯一 fix 仍建立 `00:06:00Z` 原点；命令 exit 0。

## 真实调用方请求 shape

N/A — 纯函数由 `loop.js` 以 `{ action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin }` 同进程调用，无设备/agent HTTP 请求。

## 禁 mock 边清单

- `orchestrator_decision_log spawn:generator-fix intent ↔ attempt:launched receipt`：冻结测试以真实日志 row shape 输入，不 mock 解析或 clock 函数。
- `loop.js ↔ validation-clock.js`：测试真 import `packages/brain/src/orchestrator/validation-clock.js`；真实 DB loop 集成不在本 sprint 验证范围，明确登记于未覆盖清单。

## 未覆盖真实链路清单

- 真 PostgreSQL `orchestrator_decision_log` → `loop.js` observe/dispatch → `resolveValidationClock`｜本 sprint 限定纯函数可重放，不启动真实 dispatch｜后续 kernel integration sprint 在 attempt 级 Postgres 上验证；本项在此之前为 `logic-done-pending`。

## 接缝清单

- decision log 真库读取与 `loop.js` 参数接力：真目标验证未覆盖，状态 `logic-done-pending`；本 sprint 只冻结纯函数及真实 row shape。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: fix receipt 的 `dispatch_hop` 指向非 fix action。
- 重复提交: 同一 dispatch hop 出现重复 receipt。
- 中途中断: 只有 fix intent、没有 launch receipt。
- 边界值: 0、6、7 次成功 fix，以及乱序数组。
发现分级: P0/P1（错误续命或健康 run 误杀）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
npx vitest run --no-cache sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fix 有界顺延冻结合同 | `sprints/08240522-kernel-r64-validation-clock/tests/validation-clock-fix-extension.test.ts` | `r50 场景最近一次成功 fix`；`恰好六次成功 fix`；`第七次成功 fix`；`没有成功 launch receipt`；`重复 launch receipt`；`dispatch_hop 或 dispatch_action` | baseline 返回原始 clock，5 failures |
| F1 回归入口 | `tests/gp/f1/validation-clock-fix-extension.test.ts` | `成功派发的 generator-fix 最多六次重置 validation clock` | baseline 返回原始 clock，1 failure |

## Notes

- implementation baseline 固定为 `09d1a044c94f888ea365759dbfbe947a4f5f4801`；role checkout SHA 不替换它。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
