# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应；`resolveValidationClock` 继续返回既有 `{pipeline_started_at, deadline_at}` 内部对象。

## 已知约束

- [packages/brain/src/orchestrator/__tests__/validation-clock.test.js] → 首次 Generator 建钟、下游复用、existing-PR Evaluator 特例、畸形时钟 fail-closed、authoring role 不建钟。
- [累积FR] context-manifest: unavailable。
- [Unified Map] `[MAP_NOT_CONFIGURED]`：task payload 有 `map_scope=["F1"]` 但缺 `map_repo`，因此不回退领域硬编码；`must_run_assertions=[]`。
- implementation baseline 固定为 `422633217348366974b6c28ceeaba7f587070a51`；本角色 checkout SHA 不替换该基线。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 每个成功 `spawn:generator-fix` 日志行把 pipeline validation clock 原点推进到该行，最多采用前 6 次 fix。 |
| NFR（做得多好） | 纯函数、按 hop 确定性重放；`timeout_seconds` 默认值与算法不变。 |
| Invariant（永不违反） | 无 fix、existing-PR、fail-closed、人审 deadline 语义不回退；不得读取墙钟或进程内计数。 |
| 判定点（怎么知道） | decision log 中的 `spawn:generator-fix` 行即既有成功派发决策事实，按数值 hop 升序计数。 |
| 保质期（何时过期） | 只要 decision-log action/hop 契约有效即有效；其契约变化时由 Kernel owner 更新。 |
| 死亡告警（停了谁知道） | 第 6 次 fix 的新 deadline 到期后仍由既有 validation clock fail-closed 路径告警/判死。 |
| 失败语义（挂了怎么办） | 缺时钟或畸形时间继续抛既有错误；第 7 次及以后 fix 不延长，不降级放行。 |
| 效果确认（已发≠已生效） | 真 import 纯函数，以精确 ISO 原点与 deadline 证明有效 fix 生效并证明超限不生效。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 日志无 pipeline 原点 | 保持 `validation_clock_required` | 是 | fail-closed |
| 原点时间畸形 | 保持 `validation_clock_invalid` | 是 | fail-closed |
| fix 次数超过 6 | 沿用第 6 次 fix 的 deadline，到期照常判死 | 是 | 不继续顺延 |

### 输入对抗面

N/A — 纯内部 Kernel 判定函数，不对外暴露 agent 输入。

## Golden Path

覆盖父路 F1「工厂 · 开发闭环」第 3-3 步。

[首次 Generator 建钟] → [有效 fix 按 hop 重置原点] → [最多采用 6 次] → [Evaluator/Judge 复用确定期限]

### Step 1: 无 fix 时沿用首次 Generator 原点
**来源**: `[FROM_PRD]` — PRD「边界情况：没有 spawn:generator-fix 时，原点与现有语义完全一致」。

**可观测行为**: 相同日志与 timeout 始终返回首次 Generator 的精确 ISO 原点和期限。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t '无 fix 轮时保持首次 generator 原点语义'
```
**硬阈值**: 原点 `2026-08-20T00:00:00.000Z`，deadline 精确为 5400 秒后；以上命令 exit 0。

### Step 2: r50 型长跑由有效 fix 获得新期限
**来源**: `[FROM_PRD]` — PRD「r50 型长跑场景在旧期限之后、有效新期限之内不再误判死亡」。

**可观测行为**: 第 1 次 fix 成为新原点，旧期限之后且新期限之前的观测仍为存活。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t 'r50 型长跑在第 1 次 fix 新期限内保持存活'
```
**硬阈值**: 新原点精确等于 fix 行时间，新 deadline 精确为其后 5400 秒；以上命令 exit 0。

### Step 3: hop 重放最多采用前 6 次 fix
**来源**: `[FROM_PRD]` — PRD「仅依据日志行及 hop 时序，选择不超过 6 次的最后有效 fix 派发作为新原点」。

**可观测行为**: 输入数组乱序不影响结果，第 6 次 fix 是最后可用原点。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t '乱序输入仍按 hop 重放并选第 6 次 fix 为新原点'
```
**硬阈值**: 第 6 次原点及其后 5400 秒期限精确相等；以上命令 exit 0。

### Step 4: 第 7 次及以后不再延长
**来源**: `[FROM_PRD]` — PRD「第 7 次及以后不再延长期限」。

**可观测行为**: 包含 8 次 fix 的日志仍返回第 6 次 fix 的原点和期限。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js -t '第 7 次及以后 fix 不再顺延并沿用第 6 次期限'
```
**硬阈值**: 原点不得晚于第 6 次 fix；以上命令 exit 0，过期后沿既有路径判死。

## Invariant 覆盖映射

- INV-1 重试身份：N/A，本 sprint 不改派发路由，只消费既有成功 action 日志。
- INV-2 现有 PR 时钟：由 repo 既有 validation-clock 测试回归，禁止改变 verified existing-PR origin/fail-closed。
- INV-3 Planner 分支：N/A，本 sprint 不触及 workspace checkout。
- INV-4 目标环境：N/A，本 sprint 不推断 target_environment；合同按 task payload 的 local_api 执行。

## 禁 mock 边清单

- `tests/gp/f1` ↔ `packages/brain/src/orchestrator/validation-clock.js`：冻结测试必须真 import 生产模块，禁止复制函数、`vi.mock`、stub 或替身。
- `resolveValidationClock` ↔ `orchestrator_decision_log` 行 shape：测试必须传真实 `{hop, action, created_at, detail}` shape，禁止以进程内 fix 计数替代日志重放。

## 接缝清单

- `loop.js` 真库读取 decision log → `resolveValidationClock`：按 PRD 明确不补真库集成，状态为 `logic-done-pending`；补位由后续集成 sprint 在 attempt 级 Postgres 验证。

## 真实调用方请求 shape

N/A — 无设备/agent HTTP 调用；真实调用方是 `loop.js`，以 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}` 调用纯函数。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 真验证补位计划 |
|---|---|---|
| 真 Postgres `loop.js` 读取 `orchestrator_decision_log` 后传入纯函数 | PRD 明确排除真库 loop.js 集成 | Kernel owner 在后续 integration sprint 用 attempt 级 Postgres 验证；本 sprint 标 `logic-done-pending` |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: fix 行 `created_at` 畸形时必须 fail-closed，不得跳过后放行。
- 重复提交: 相同 hop 重放不得产生进程内累积差异。
- 中途中断: 输入数组截断后重放只能由现存行决定。
- 边界值: 0、1、6、7 次 fix；hop 数字乱序。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

gp-anchor: skipped (product-map.json not found)

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
test "$(git merge-base HEAD 422633217348366974b6c28ceeaba7f587070a51)" = "422633217348366974b6c28ceeaba7f587070a51"
npx vitest run --no-cache sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js)
```

**通过标准**: 两组真实 import 测试均 exit 0；冻结测试 4/4 通过，既有语义测试全绿。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| r50 新期限 | `sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js` | `r50 型长跑在第 1 次 fix 新期限内保持存活` | 当前实现返回首次 Generator 原点，精确对象断言失败 |
| hop 重放与第 6 次上限 | `sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js` | `乱序输入仍按 hop 重放并选第 6 次 fix 为新原点` | 当前实现返回首次 Generator 原点，精确对象断言失败 |
| 超限判死 | `sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js` | `第 7 次及以后 fix 不再顺延并沿用第 6 次期限` | 当前实现错误停在首次 Generator，而非第 6 次 fix |
| 无 fix 零回归 | `sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js` | `无 fix 轮时保持首次 generator 原点语义` | 补充回归，现实现应保持通过 |

## Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)。
- 本合同不修改 `timeout_seconds` 默认值、不修改人审 deadline、不扩展其他时钟。
