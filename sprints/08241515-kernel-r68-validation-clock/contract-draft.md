# Sprint Contract Draft (Round 1) — kernel validation clock 按 fix 轮自动顺延（有界）[r68]

**journey_type**: autonomous
**target_environment**: local_api（纯 brain 后端纯函数；postgres:false，无 DB / 无服务端，evaluator 本地 vitest 真跑冻结测试）
**被改文件**: `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（`packages/brain/src/lib/contract-gate.js` 存在），本合同断言按 Contract Gate 速查表书写

---

## 锚定父路声明

独立小路（无父路）——本 sprint 只改 kernel validation clock 纯函数 `resolveValidationClock` 的顺延逻辑，不挂任何既有 Golden Path 步骤。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。被改对象是纯函数 `resolveValidationClock({action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin, maxFixExtensions})`，返回 `{pipeline_started_at, deadline_at}` 对象或 `null`，不经任何 HTTP 端点。字段契约由下方冻结测试逐条 codify。

---

## 真实调用方请求 shape

N/A — 本 sprint 无设备/agent 调服务端；被改对象是 orchestrator 内部纯函数，唯一真实调用方是 `packages/brain/src/orchestrator/loop.js`（同进程内 import，见「未覆盖真实链路清单」）。

---

## Golden Path

[tick 调 `resolveValidationClock`] → [按 hop 时序识别 generator origin 并按 fix 轮顺延原点（有界 6 次）] → [返回顺延后的 deadline，健康长跑 run 不被误杀]

### Step 1: downstream 角色复核 deadline 时采纳最近一次 generator-fix 原点
**来源**: `[FROM_PRD]` — sprint-prd.md 第 20-23 行「deadline 原点 = 最近一次成功派发的 spawn:generator-fix 行时间，重新起算 timeout_seconds」

**可观测行为**: `decisionLog` 含初始 `spawn:generator`（t0）+ 多轮 `spawn:generator-fix`（t1<t2<…，均在 6 轮内）时，`resolveValidationClock` 返回的 `pipeline_started_at` 指向**最近一次** generator-fix 行的 `created_at`，`deadline_at = 最近 fix 的 created_at + timeout_seconds`。旧逻辑固定取初始 t0，健康长跑 run 撞旧 deadline 被判死；新逻辑存活。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-01 顺延" --reporter=verbose 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
# 期望：B-01 绿（pipeline_started_at=最近 fix 原点，deadline 顺延）
```

**硬阈值**: B-01 通过；返回 `pipeline_started_at='2026-08-24T01:20:00.000Z'`、`deadline_at='2026-08-24T02:50:00.000Z'`（最近 fix 原点 + 5400s）

---

### Step 2: 顺延有界——超过 6 次时原点冻结在第 6 次 fix
**来源**: `[FROM_PRD]` — sprint-prd.md 第 22/28 行「顺延次数上限 6 次；出现第 7 次及以后的 fix 轮时，原点冻结在第 6 次 fix 派发，deadline 照常到点判死」

**可观测行为**: `decisionLog` 含 > 6 轮 generator-fix 时，采纳的原点为第 6 次 fix 的 `created_at`（不再前进到更近的 fix）；deadline 不再增长，超时照常判死。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-02 有界" --reporter=verbose 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
# 期望：B-02 绿（原点冻结第 6 次 fix，deadline=02:30 而非 02:50）
```

**硬阈值**: B-02 通过；8 轮 fix 时 `pipeline_started_at='2026-08-24T01:00:00.000Z'`（第 6 次）、`deadline_at='2026-08-24T02:30:00.000Z'`，且 `deadline_at != '2026-08-24T02:50:00.000Z'`（未被第 8 次 fix 顶到）

---

### Step 3: 无 fix 轮时语义与旧逻辑逐字节一致
**来源**: `[FROM_PRD]` — sprint-prd.md 第 27 行「无 fix 轮 → 顺延次数为 0，deadline 与旧逻辑逐字节一致」

**可观测行为**: `decisionLog` 只含初始 `spawn:generator`（无任何 generator-fix 行）时，返回值与改动前逐字节相同（`pipeline_started_at=t0`、`deadline_at=t0+timeout`）。零回归。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-03 语义不变" --reporter=verbose 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=dot ) 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
# 期望：B-03 绿 + 既有 11 条 validation-clock 单测全绿（无回归）
```

**硬阈值**: B-03 通过且既有 `validation-clock.test.js` 11 条全绿

---

### Step 4: existing-PR evaluator origin 复用路径不受本改动影响（Invariant）
**来源**: `[AI_ADDED]` — 理由：防止顺延逻辑泄漏进 `validation_origin=verified_existing_pr` 的复用路径，破坏 [existing-PR-clock] 铁律；GAN 加一条对抗守卫锁死此边界

**可观测行为**: `decisionLog` 首个 origin 是 `spawn:evaluator` + `verified_existing_pr` 时（即便日志混入 generator-fix 行），返回复用 evaluator 持久化时钟、**不顺延**。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts -t "B-04 Invariant" --reporter=verbose 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
# 期望：B-04 绿（existing-PR 原点 = t0，未被混入的 fix 行顶动）
```

**硬阈值**: B-04 通过；existing-PR 路径 `pipeline_started_at=t0` 不变

---

## 禁 mock 边清单

本单改动属「状态机 / 生命周期钩子」类（validation clock 决定 pipeline 存活判死），冻结测试必须真 import 被改文件、禁 mock 被改的边：

- 冻结测试 ↔ `packages/brain/src/orchestrator/validation-clock.js`（本单改 `resolveValidationClock` 顺延逻辑，测试必须真 import 该模块，禁 `vi.mock`/stub `resolveValidationClock` / `persistedClock` / `exactClock`）
- `resolveValidationClock` ↔ `decisionLog` 行结构（本单改按 `hop`/`created_at` 时序识别 fix 原点，测试必须传入真实形态的 decision_log 行对象，禁用替身构造器隐藏 hop/created_at 语义）

（`resolveValidationClock` 是纯函数，无 DB 写路径、无外部 IO；本单不涉及真 Postgres。真库消费边 `loop.js → resolveValidationClock` 的端到端集成见「未覆盖真实链路清单」。）

---

## 未覆盖真实链路清单

- **`loop.js` 消费 `resolveValidationClock` 的真库集成接缝**｜为什么：PRD 范围限定明确「不改 `loop.js` 真实链路集成接缝」，本 sprint 只做纯函数单测（`packages/brain/src/orchestrator/loop.js:1552` 调用点 + `dispatcher.js` 落 `pipeline_started_at`/`deadline_at` + `deadlineExceeded` 判死链路未端到端验证）｜真验证补位计划：后续 sprint 用真 Postgres orchestrator loop 集成测试覆盖「多轮 fix 派发 → deadline 顺延 → 健康 run 不被 `automation_deadline_exceeded` 误杀」全链路，标记 `logic-done-pending`。

（接缝清单：本 sprint 唯一接缝 = 上述 loop.js 真库集成，未真验，标 `logic-done-pending`，不得标 done。纯函数顺延逻辑本身为逻辑断言，vitest 绿 = 真 done。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | `resolveValidationClock` 按 `decisionLog` 中 `spawn:generator-fix` 行时序把 deadline 原点顺延到最近一次 fix 派发时间，重新起算 `timeout_seconds` |
| **NFR（做得多好）** | 性能/可靠性/阈值 | 纯函数 O(n) 扫描 decision_log；`timeout_seconds` 默认 5400s 不变；顺延上限 6 次 |
| **Invariant（永不违反）** | 不变量 | ①existing-PR evaluator origin 复用路径不顺延（[existing-PR-clock]）②无 fix 轮时逐字节等于旧逻辑 ③同输入同输出（纯函数，不读系统时钟/外部状态）④基础设施重试不改身份/origin（[retry-identity]） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 纯逻辑函数，无 token/数据保质期；顺延窗口随每轮 fix 滚动，6 次上限即失效边界 |
| **死亡告警（停了谁知道）** | 停摆告警 | N/A（本函数无独立进程）；上游 `automation_deadline_exceeded` 判死路径与既有告警不变 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 效果 = 返回的 `{pipeline_started_at, deadline_at}`；由 5 条冻结 vitest 断言 + 既有 11 条回归逐条确认真实生效 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 「fix 轮派发成功」以何为判据 | A. 查派发回执/HTTP 200; B. `orchestrator_decision_log` 存在对应 `spawn:generator-fix` 行 | B. 存在 `spawn:generator-fix` 行 | 纯函数可重放，只依赖已落库 decision_log 行；不额外查回执（PRD 假设 46 行明确） | 若某 fix 行落库但实际派发失败，会多顺延一轮——有界 6 次封顶，且下轮健康推进覆盖，风险有限 |
| 顺延原点取哪一行的时间 | A. 行 `detail.pipeline_started_at`（持久化时钟）; B. 行 `created_at`（hop 时序时间戳） | B. `created_at` | PRD 第 30 行「只依赖 hop 时序与时间戳」；r50 旧日志的 `detail` 被污染指向 t0，用 `created_at` 才能纯可重放出新行为 | 若误用被污染的 `detail`，replay 退回旧判死行为，修复失效 |

（本任务无面客不可逆接缝判定点，无 ⚠️ 升级项。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| `timeoutSeconds` 非正整数 | 抛 `validation_clock_timeout_invalid`（既有 `exactClock` 语义，不变） | 是（纯函数，同输入同抛） | 上游 fail-closed，不派发 |
| 采纳的 fix 行缺 `created_at` | 抛 `validation_clock_invalid`（fail-closed，不静默取旧原点） | 是 | 上游按既有 `validation_clock_invalid` 处理 |
| downstream 角色无任何 generator origin | 抛 `validation_clock_required`（既有语义，不变） | 是 | 上游 fail-closed |

### 输入对抗面（对外暴露 agent 必填）

N/A — `resolveValidationClock` 不对外暴露，输入仅来自 orchestrator 内部已落库的 `orchestrator_decision_log` 行，无外部用户可写入面、无 prompt injection 面。

---

## 已知约束（来自回归测试 + 累积 FR）

- [既有单测 `packages/brain/src/orchestrator/__tests__/validation-clock.test.js`] → `starts one shared window at the first Generator intent`（首个 generator intent 建立共享窗口）
- [既有单测同上] → `reuses the persisted clock for generator-fix/evaluator/evaluator-evidence-repair/judge`（下游角色复用持久化时钟）
- [既有单测同上] → `recovers a pre-fix in-flight run from the first Generator intent created_at`（无 fix 行的首个 generator-fix 从 t0 恢复——本改动必须保持此语义）
- [既有单测同上] → `fails closed when a downstream role has no Generator clock`（无 origin 时 fail-closed）
- [既有单测同上] → `starts / reuses one shared window at a verified existing-PR Evaluator intent`（existing-PR origin 建立/复用——[existing-PR-clock] 铁律）
- [既有单测同上] → `fails closed when the persisted clock is malformed`（畸形持久化时钟 fail-closed）
- [累积FR] context-manifest: unavailable（本 sprint 运行环境 postgres:false，Brain API 不可达，未取到累积 FR；PRD 第 72 行标注本 line 无 validation-clock 相关已验收历史）
- [Invariant/铁律] [existing-PR-clock] / [retry-identity] / [planner-role-branch]（见 PRD 第 65-67 行，逐条映射见下方 INV 条目）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fix 轮顺延（有界） | `sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts` | `B-01 顺延`、`B-02 有界`、`B-03 语义不变`、`B-04 Invariant`、`B-05 恰好 6 轮 fix` | 未改实现前 B-01/B-02/B-05 红（3 failed），B-03/B-04 绿（2 passed）——实测 3 failed \| 2 passed |
| fix 轮顺延（CI 常驻回归，补充行） | `tests/gp/f1/step3-validation-clock-fix-round-extension.test.js` | 同上五条（`.test.js` 副本，PRD 要求置于 tests/gp/f1/） | 同上 |

> 「BEHAVIOR 覆盖」列每个名（如 `B-01 顺延`）均为对应 `it()` 名的字面子串，可 `grep -F` 命中。冻结测试至少一行在 `sprints/<本sprint目录>/tests/`（第一行，封印闸解析锚点），`tests/gp/f1/` 为补充回归行。

---

## E2E 验收

> 本 sprint 为纯 brain 后端纯函数（postgres:false，无 DB / 无服务端）。final-e2e 由 evaluator 独立 task 按 `target_environment=local_api` 本地执行：从仓库根跑冻结契约测试（`sprints/**` 与 `tests/**` 均在根 vitest include 内）+ 切进包根跑既有回归。身份 late-bound——纯函数 vitest 不注入 HARNESS_* / CAPABILITY_SNAPSHOT_ID，无 UUID 字面值。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

SPRINT_TEST="sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts"
GP_TEST="tests/gp/f1/step3-validation-clock-fix-round-extension.test.js"

# 1. 冻结契约测试从仓库根跑（sprints 与 tests 均在根 vitest include 内，允许根跑）
npx vitest run "$SPRINT_TEST" "$GP_TEST" --reporter=verbose 2>&1 | tee /tmp/vc-e2e.log
grep -qE "Tests +[1-9][0-9]* passed" /tmp/vc-e2e.log || { echo "FAIL: 冻结契约测试无通过计数"; exit 1; }
if grep -q "failed" /tmp/vc-e2e.log; then echo "FAIL: 冻结契约测试存在 failed"; exit 1; fi

# 2. 既有 brain 单测回归（无顺延时逐字节一致），按 vitest 工作目录死规则切进包根跑
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=verbose ) 2>&1 | tee /tmp/vc-reg.log
grep -qE "Tests +[1-9][0-9]* passed" /tmp/vc-reg.log || { echo "FAIL: 既有 validation-clock 回归无通过计数"; exit 1; }
if grep -q "failed" /tmp/vc-reg.log; then echo "FAIL: 既有 validation-clock 回归存在 failed"; exit 1; fi

echo "OK: validation clock 顺延契约 + 既有回归全绿"
```

**通过标准**: 脚本 exit 0（冻结契约 5 条全绿 + 既有 11 条回归全绿）
**失败标准**: 任一 vitest 出现 failed 或无 passed 计数 → exit 1

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveValidationClock` 传 `timeoutSeconds=0` / 负数 / 非整数（应抛 `validation_clock_timeout_invalid`，不得静默返回）；某 `spawn:generator-fix` 行缺 `created_at`（应抛 `validation_clock_invalid`，不得回退旧原点）
- 重复提交: 相同 `decisionLog` 多次调用必返回逐字节相同结果（纯函数幂等性）
- 中途中断: `decisionLog` 乱序（hop 非升序）传入——顺延必须按 hop 排序后取第 6 次 fix，不受数组顺序影响
- 边界值: 恰好 6 轮 fix（采纳第 6 次）vs 7 轮 fix（冻结第 6 次）；0 轮 fix（等于旧逻辑）；fix 行 hop 相同/重复时的稳定性
发现分级: P0/P1（顺延泄漏进 existing-PR 路径 / 无 fix 轮回归 / 纯函数非幂等）→ 阻塞 merge；P2/P3（错误信息措辞等）→ 记 findings 不阻塞
