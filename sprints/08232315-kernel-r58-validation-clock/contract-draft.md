# Sprint Contract Draft (Round 2)

## Notes

- authoritative implementation baseline: `422633217348366974b6c28ceeaba7f587070a51`（冻结；角色 checkout SHA 不替换它）
- `[MAP_NOT_CONFIGURED]`：task payload 有 `map_scope=["F1"]`，但 `map_repo` 缺失；不得猜测 radius 或 must_run_assertions。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- context-manifest: unavailable（Brain API 未返回 journey context）

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应；返回值沿用 `resolveValidationClock` 现有 `{pipeline_started_at, deadline_at}` 结构，不新增字段。

## 已知约束（来自回归测试）

- `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` → 首次 Generator 建立时钟、下游复用、verified-existing-PR evaluator 起点、畸形时钟 fail-closed、authoring role 返回 null。
- `tests/gp/f1/step3-judge-uncovered-chain-deferred.test.js` → 合同登记的 `loop.js` 真库接缝只有裁判明确 deferred 且锚命中时才可延期。
- [累积FR] 本 line 暂无历史。

## Golden Path

覆盖父路 `factory/F1 造完真验` 第 1-3 步。

[首次 generator 建钟] → [成功 generator-fix 有界重锚] → [下游角色取得可重放时钟] → [窗口内存活/超限死亡]

### Step 1: 无 fix 轮保持首次 generator 原点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项与边界「完全没有 fix 轮的 run 保持现有判断」。

**可观测行为**: 相同日志与 timeout 输入始终返回首次 generator 的 ISO 起点和 deadline。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t '无 fix 轮时继续以首次 generator 为原点'
```
**硬阈值**: 0 次 fix 时 `pipeline_started_at=首次 generator.created_at` 且 `deadline_at=起点+timeoutSeconds`；由上述 `toEqual` 精确断言。

### Step 2: r50 两轮 fix 后以最近 fix 重锚
**来源**: `[FROM_PRD]` — PRD 要求 1、3：每次成功 fix 成为新原点，复刻两轮 fix 后旧窗口耗尽但新窗口存活。

**可观测行为**: hop 20、30 两轮 fix 后，返回 hop 30 的起点；在旧 deadline 之后、新 deadline 之前仍存活。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t 'r50 两轮 fix 后原窗口耗尽但最近 fix 窗口内仍存活'
```
**硬阈值**: 起点精确等于第二轮 fix 的 `created_at`，deadline 精确等于该时间加 100 秒且晚于观察时刻；由上述测试精确断言。

### Step 3: 顺延最多六次且按 hop 可重放
**来源**: `[FROM_PRD]` — PRD 要求 2、3 与第 7 次及后续不再顺延的负向场景。

**可观测行为**: 输入顺序打乱不改变 hop 语义；前六次 fix 最后落在第六次原点，第七次不续命，观察时刻超过第六次 deadline 即死亡。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t '前六次 fix 各自按 hop 顺序成为新原点且输入可重放|第七次 fix 不再顺延并保留第六次原点使超时照常判死'
```
**硬阈值**: 最多 6 次顺延；第七次输入时仍返回第六次的 `00:06:00Z` 起点及 `00:07:40Z` deadline；由上述两个测试精确断言。

### Step 4: 失败或非派发行不得重锚
**来源**: `[FROM_PRD]` — PRD「边界情况」明确要求只计算成功派发的 `spawn:generator-fix`，失败或非派发行不得改变原点。

**可观测行为**: 首次 generator 后出现失败 callback 与非派发请求行时，时钟仍严格锚定首次 generator。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts -t '失败或非派发行不得改变时钟原点'
```
**硬阈值**: `pipeline_started_at=00:00:00Z`、`deadline_at=00:01:40Z`，失败 callback 与非 `spawn:generator-fix` action 均不参与计数；由上述 `toEqual` 精确断言。

### Step 5: 防伪约束保持
**来源**: `[AI_ADDED]` — 防止实现通过修改默认 timeout、人审 deadline 或依赖当前时间/数组输入顺序绕过 PRD。

**可观测行为**: 实现只从 decision log 的 action/hop/持久化时间推导，且改动不触及 timeout 默认值和人审 deadline。

**验证命令**:
```bash
git diff 422633217348366974b6c28ceeaba7f587070a51...HEAD -- packages/brain/src/orchestrator/validation-clock.js packages/brain/src/orchestrator/loop.js | grep -q 'validation-clock.js' && ! git diff 422633217348366974b6c28ceeaba7f587070a51...HEAD -- packages/brain/src/orchestrator/loop.js | grep -E 'timeout_seconds[^=]*\?\? 5400|human.*deadline'
```
**硬阈值**: 目标纯函数有变更，默认 5400 与人审 deadline 无差异；由上述 diff 命令返回 0 断言。

## 禁 mock 边清单

- `orchestrator_decision_log 行序列 ↔ resolveValidationClock`：本单改变 action/hop 到时钟原点的边，测试必须构造真实行 shape 并真 import `packages/brain/src/orchestrator/validation-clock.js`，禁止 `vi.mock`、stub 或替代实现。

## 真实调用方请求 shape

N/A — 纯函数由 `loop.js` 直接调用，不含设备、agent 或 HTTP 调用方。

## 接缝清单

| 接缝 | 真目标验证 | 状态 |
|---|---|---|
| `loop.js` 从真 Postgres 读取 `orchestrator_decision_log`，将顺延时钟写回下一 hop detail | 带 Postgres 的 `brain-integration` 环境运行真实 loop 一 hop，核对下一行 `pipeline_started_at/deadline_at` | `logic-done-pending` / CANNOT_VERIFY（本 attempt `postgres=false`） |

## 未覆盖真实链路清单

| 真实链路点 | 为什么未覆盖 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| `loop.js` 真 Postgres 集成：真实 decision log 装载 → `resolveValidationClock` → deadline 写回下一 hop detail | 本 proposer attempt 明确 `runtime_resources.postgres=false`，不能伪造真库结果 | Evaluator 在 `brain-integration` Postgres job 运行真实 loop 一 hop；未完成前保持 `logic-done-pending`、CANNOT_VERIFY |

除此接缝外，本合同无 mock 豁免。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 成功 generator-fix 最多六次成为 validation clock 新原点。 |
| NFR（做得多好） | 纯函数、相同日志重放结果相同；默认 5400 秒不变。 |
| Invariant（永不违反） | 第七次不得续命；无 fix、人审 deadline、角色身份和冻结基线语义不变。 |
| 判定点（怎么知道） | 以 decision log 中 `action=spawn:generator-fix` 且已落行为成功派发事实，按数值 hop 升序。 |
| 保质期（何时过期） | 随 decision-log action schema 变更复审；当前无 token/外部数据过期。 |
| 死亡告警（停了谁知道） | 回归测试在 required CI 当次运行内失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 畸形持久化时钟继续 fail-closed；超限照常超时，不降级为无界续命。 |
| 效果确认（已发≠已生效） | 精确核对起点、deadline 与观察时刻关系，而非仅断言函数有返回。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 成功 fix 派发事实 | A. task callback；B. 已持久化 decision-log spawn 行 | B. 已持久化 `spawn:generator-fix` 行 | PRD 要求纯依赖 decision log 可重放 | 失败派发错误续命或健康 run 被误杀 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 无 generator 原点的下游角色 | 抛 `validation_clock_required` | 相同日志重试一致 | fail-closed |
| 持久化时钟畸形 | 抛 `validation_clock_invalid` | 相同日志重试一致 | fail-closed |
| fix 超过六次 | 不再重锚，按第六次 deadline 超时 | 是 | 无降级、禁止无界续命 |

### 输入对抗面

N/A — 不对外暴露 agent 输入；输入是 Kernel 内部 decision log。

## Invariant 覆盖映射

- [重试身份] 固定按 action 字面区分首次 generator 与 generator-fix，测试分别覆盖。
- [Planner 分支] N/A：不触及 planner workspace 或分支。
- [Brain URL] N/A：纯函数无 Brain URL 与网络预检。
- [真实门禁] 冻结测试真 import 目标模块且无 mock。
- [基线冻结] 所有 diff 与任务计划均以 `422633217348366974b6c28ceeaba7f587070a51` 为 implementation baseline。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 重复 hop、非数值 hop、畸形 `created_at`。
- 重复提交: 同一 fix 行重复出现时不得意外突破六次上限。
- 中途中断: 仅落 generator、尚未落 fix 的日志前缀应保持旧语义。
- 边界值: 0、1、6、7 次 fix，以及乱序 decisionLog。
发现分级: P0/P1（无界续命或健康 run 误杀）阻塞 merge；P2/P3 记 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current role identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
BASE_SHA=422633217348366974b6c28ceeaba7f587070a51
TEST_FILE=sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts
test "$(git merge-base "$BASE_SHA" HEAD)" = "$BASE_SHA"
! grep -nE 'vi\.mock|jest\.mock|sinon\.stub' "$TEST_FILE"
npx vitest run --no-cache "$TEST_FILE" --reporter=verbose
git diff "$BASE_SHA"...HEAD -- packages/brain/src/orchestrator/loop.js | grep -E 'timeout_seconds[^=]*\?\? 5400|human.*deadline' && exit 1 || true
printf 'validation-clock E2E passed; attempt=%s snapshot=%s\n' "$HARNESS_ATTEMPT_ID" "$CAPABILITY_SNAPSHOT_ID"
```

通过标准：五个测试全部通过，冻结基线为 implementation baseline，测试无 mock，默认 timeout 与人审 deadline 未被更改。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结 RED 合同 | `sprints/08232315-kernel-r58-validation-clock/tests/validation-clock-bounded-fix-extension.test.ts` | `r50 两轮 fix 后原窗口耗尽但最近 fix 窗口内仍存活`; `前六次 fix 各自按 hop 顺序成为新原点且输入可重放`; `第七次 fix 不再顺延并保留第六次原点使超时照常判死`; `无 fix 轮时继续以首次 generator 为原点`; `失败或非派发行不得改变时钟原点` | 现实现选择首次 generator，前三个新增语义失败；边界用例永久防止错误扩大可重锚 action 集合 |
| 永久 GP 回归（Generator 落盘） | `tests/gp/f1/validation-clock-bounded-fix-extension.test.js` | 同上五个测试名逐字保留 | RED commit 后实现 commit 点绿 |
