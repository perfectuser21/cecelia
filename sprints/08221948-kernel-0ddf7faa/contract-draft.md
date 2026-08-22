# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路） — 本 sprint 是 kernel 内部编排纯逻辑修复（`resolveValidationClock` 窗口计算），无业务 Golden Path 父路依赖。

**journey_type**: autonomous
**target_environment**: local_api（实为纯 Brain 内部逻辑，验证 oracle = vitest + node 直调 `resolveValidationClock`，无需 DB/HTTP 服务；postgres=false）

**contract-gate**: present（cecelia worktree），本合同断言按 Contract Gate 合规惯用法编写。
**gp-anchor**: skipped (product-map.json not found)
**map**: `[MAP_NOT_CONFIGURED]`（task.payload 无 map_scope/map_repo，不回退领域硬编码）

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 只改 `packages/brain/src/orchestrator/validation-clock.js` 的纯函数 `resolveValidationClock`（输入 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}` → 输出 `{pipeline_started_at, deadline_at}` 或 `null` 或 throw）。无端点、无 DB 写路径。Reviewer 第 6 维按行为 oracle（vitest + node 直调）审查，非 HTTP schema。

**函数契约（本 sprint 修改点）**:
- 锚 hop = decisionLog 中第一个 generator intent（`spawn:generator`/`spawn:generator-fix`，按 hop 升序取首）或 verified_existing_pr 的 `spawn:evaluator`（不变）。
- `fixCount` = decisionLog 中 hop ≥ 锚 hop 且 `action === 'spawn:generator-fix'` 的行数（ASSUMPTION：以 decisionLog 已落库的 fix 行为准，不含当前正在派发、尚未入 log 的动作）。
- **返回 deadline = `pipeline_started_at`(锚 started) + (1 + fixCount) * timeoutSeconds * 1000**。
- persisted 校验容忍窗口：锚 detail 的 `deadline_at` 若存在，必须可解析且等于 `started + k*timeout`（k 为 1..(1+fixCount) 的整数）之一，否则 throw `validation_clock_invalid`（保留既有 malformed 失败闭合语义）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` 既有 11 断言必须全部保持绿：
  - `starts one shared window at the first Generator intent`
  - `reuses the persisted clock for spawn:generator-fix/spawn:evaluator/spawn:evaluator-evidence-repair/spawn:judge`（decisionLog 无 fix 行 → fixCount=0 → base，不变）
  - `recovers a pre-fix in-flight run from the first Generator intent created_at`（fixCount=0 → base）
  - `fails closed when a downstream role has no Generator clock`（throw `validation_clock_required`）
  - `starts one shared window at a verified existing-PR Evaluator intent`
  - `reuses the persisted verified existing-PR Evaluator clock for Judge`
  - `fails closed when the persisted clock is malformed`（detail.deadline_at 不可解析 → throw `validation_clock_invalid`；fixCount=0 时 base 校验仍必须拒绝 `not-a-time`）
  - `does not create a validation clock for authoring roles`（非 VALIDATION_ACTIONS → null）
- [累积FR] context-manifest: unavailable（Brain journey context-manifest 端点未在本 attempt 查询；本 line 暂无历史 FR，PRD 已注明）

---

## Golden Path

[kernel 派发 validation 角色] → [resolveValidationClock 读锚 hop + 统计锚后 generator-fix 次数] → [deadline 随 fix 轮线性顺延] → [runner 断言预算恒正，judge 不再零测试假 FAIL]

### Step 1: 一条在途 run 在锚 hop 之后已发生 N 次 generator-fix，首窗被 LLM 时延吃光
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 1」直接定义。

**可观测行为**: decisionLog 含 1 个锚 `spawn:generator`（hop 70，persisted base clock）+ N 个 `spawn:generator-fix`（hop > 70）。

**验证命令**:
```bash
node --input-type=module -e 'import("./packages/brain/src/orchestrator/validation-clock.js").then(()=>console.log("module loads"))'
# 期望：module loads
```
**硬阈值**: 模块可加载；decisionLog fixCount 由已落库 fix 行数决定。

---

### Step 2: kernel 派发 evaluator/judge 时调 resolveValidationClock，窗口随 fix 顺延
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 2」：`deadline = anchor_started + (1 + fixCount) * timeout_seconds`。

**可观测行为**: 对同一锚 started，2 次 fix 的 decisionLog → deadline = started + 3*timeout（+6h）；1 次 fix → started + 2*timeout（+4h）。

**验证命令**:
```bash
node --input-type=module -e '
import { resolveValidationClock } from "./packages/brain/src/orchestrator/validation-clock.js";
const s = "2026-08-03T19:02:13.199Z";
const a = { hop:70, action:"spawn:generator", created_at:s, detail:{ pipeline_started_at:s, deadline_at:"2026-08-03T21:02:13.199Z" } };
const fx = (h,at) => ({ hop:h, action:"spawn:generator-fix", created_at:at, detail:{} });
const d = resolveValidationClock({ action:"spawn:evaluator", decisionLog:[a, fx(72,"2026-08-03T20:00:00.000Z"), fx(74,"2026-08-03T20:30:00.000Z")], intentAt:"2026-08-03T21:30:00.000Z", timeoutSeconds:7200 }).deadline_at;
if (d !== "2026-08-04T01:02:13.199Z") { console.error("FAIL", d); process.exit(1); }
console.log("OK", d);
'
# 期望：OK 2026-08-04T01:02:13.199Z
```
**硬阈值**: deadline == `started + 3*7200s`（2 次 fix）；线性顺延。

---

### Step 3: deadline 顺延后 runner 断言预算恒正、judge 不再零测试假 FAIL；零 fix 逐字节零回归
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 3」+「边界情况·零 fix 轮」。
**来源**: `[AI_ADDED]` — persisted 容忍窗口（锚 detail 已顺延值不误判 invalid），理由：PRD「边界·恢复/在途 run」要求 persistedClock 重算容忍顺延后 deadline，否则在途 run 恢复即 `validation_clock_invalid`。

**可观测行为**: fixCount=0 时 deadline == base（与现行为逐字节一致）；锚 detail 已写成顺延后 deadline 时不 throw `validation_clock_invalid`。

**验证命令**:
```bash
node --input-type=module -e '
import { resolveValidationClock } from "./packages/brain/src/orchestrator/validation-clock.js";
const s = "2026-08-03T19:02:13.199Z";
const a0 = { hop:70, action:"spawn:generator", created_at:s, detail:{ pipeline_started_at:s, deadline_at:"2026-08-03T21:02:13.199Z" } };
const z = resolveValidationClock({ action:"spawn:evaluator", decisionLog:[a0], intentAt:"2026-08-03T19:30:00.000Z", timeoutSeconds:7200 }).deadline_at;
if (z !== "2026-08-03T21:02:13.199Z") { console.error("FAIL zero-regression", z); process.exit(1); }
console.log("OK zero-regression", z);
'
# 期望：OK zero-regression 2026-08-03T21:02:13.199Z
```
**硬阈值**: fixCount=0 → deadline == `started + 1*7200s`（base，零回归）。

---

## 禁 mock 边清单

- 代码 ↔ `resolveValidationClock` 窗口计算逻辑（本单改此纯函数）：冻结测试 / BEHAVIOR / E2E 必须**真调** `resolveValidationClock`（构造真实 `decisionLog` 数组），禁止 `vi.mock`/stub 该模块或桩化其返回值。被改的是「decisionLog → deadline」这条计算边，桩掉即结构性抓不到顺延缺陷。
- （本单为 kernel 纯计算函数改动，无 DB 写路径、无跨进程调度接缝、无生命周期钩子改动，故仅上述一条边。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | `resolveValidationClock` 在锚 hop 之后每出现一次 `spawn:generator-fix` 即把 validation 窗口顺延一个 `timeoutSeconds`：deadline = anchor_started + (1+fixCount)*timeout |
| **NFR（做得多好）** | | 纯函数，同步计算，无 I/O；timeoutSeconds 默认 5400s（调用侧 `timeout_seconds ?? 5400`），本 sprint 顺延单位 |
| **Invariant（永不违反）** | | ①有界：fixCount 由既有 fix 轮上限约束，顺延窗口有界不无界增长；②零回归：fixCount=0 逐字节等于现行为；③runner 断言预算逻辑不改；④malformed persisted clock 仍失败闭合 |
| **判定点（怎么知道）** | | N/A（本任务无接缝判定点，纯函数按 decisionLog 结构化数据计算，不推断外部真实状态） |
| **保质期（何时过期）** | | N/A（无 token/凭据/时效数据） |
| **死亡告警（停了谁知道）** | | 若顺延逻辑回退 → 冻结测试 + 既有 validation-clock.test.js 转红，CI Sprint Tests 拦截 |
| **失败语义（挂了怎么办）** | | 见下「失败语义声明」——拦截型：非法/缺失 clock 仍 throw（fail-closed），不放行 |
| **效果确认（已发≠已生效）** | | deadline 值由 vitest `toEqual` + node 直调断言精确校验（非「测试通过」空泛断言） |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A — `resolveValidationClock` 仅对已落库 `decisionLog` 结构化数组做确定性计算，不监听/推断真机或外部 API 真实状态。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 下游角色无 Generator clock | throw `validation_clock_required`（fail-closed，不放行） | 是（纯函数无副作用） | 无（调用侧按现有逻辑处理） |
| persisted clock 不可解析/超出容忍窗口 | throw `validation_clock_invalid` | 是 | 无 |
| timeoutSeconds 非正整数 | throw `validation_clock_timeout_invalid` | 是 | 无 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本函数不对外暴露，输入来自 kernel 内部 `decisionLog`（已落库可信数据），无 prompt injection / 越权面。

---

## E2E 验收（final-e2e — target_environment=local_api，纯 vitest + node 直调 oracle）

> 本 sprint 无 DB/HTTP 服务依赖（postgres=false）；Golden Path 可观测输出 = `resolveValidationClock` 返回的 deadline 随 fix 轮线性顺延。oracle = 冻结 sprint 测试（从仓库根跑，命中根 vitest include `sprints/**`）+ node 直调值断言 + 既有 kernel 测试回归（子 shell cd 进 `packages/brain` 用其自身 vitest 配置）。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace
FROZEN="sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js"

# 1. 冻结 sprint 测试（从仓库根跑，命中根 vitest include sprints/**）
npx vitest run "$FROZEN" --no-cache 2>&1 | tee /tmp/frozen.log
grep -qE "[0-9]+ failed" /tmp/frozen.log && { echo "FAIL: 冻结测试有失败用例"; exit 1; } || true
grep -qE "Tests +[0-9]+ passed" /tmp/frozen.log || { echo "FAIL: 冻结测试无通过用例"; exit 1; }

# 2. Golden Path 可观测输出直验：deadline 随 fix 次数线性顺延（真实调用 resolveValidationClock）
node --input-type=module -e '
import { resolveValidationClock } from "./packages/brain/src/orchestrator/validation-clock.js";
const s = "2026-08-03T19:02:13.199Z";
const a = { hop: 70, action: "spawn:generator", created_at: s, detail: { pipeline_started_at: s, deadline_at: "2026-08-03T21:02:13.199Z" } };
const fx = (h, at) => ({ hop: h, action: "spawn:generator-fix", created_at: at, detail: {} });
const call = (log) => resolveValidationClock({ action: "spawn:evaluator", decisionLog: log, intentAt: "2026-08-03T21:30:00.000Z", timeoutSeconds: 7200 }).deadline_at;
const zero = call([a]);
const one = call([a, fx(72, "2026-08-03T20:00:00.000Z")]);
const two = call([a, fx(72, "2026-08-03T20:00:00.000Z"), fx(74, "2026-08-03T20:30:00.000Z")]);
const ok = zero === "2026-08-03T21:02:13.199Z" && one === "2026-08-03T23:02:13.199Z" && two === "2026-08-04T01:02:13.199Z";
if (!ok) { console.error("FAIL deadline 顺延不符", { zero, one, two }); process.exit(1); }
console.log("OK deadline 顺延:", zero, one, two);
'

# 3. 既有 kernel 单元测试回归（用该包自己的 vitest 配置，子 shell cd 进包根）
( cd packages/brain && npx vitest run src/orchestrator/__tests__/validation-clock.test.js --no-cache 2>&1 | tee /tmp/pkg.log )
grep -qE "[0-9]+ failed" /tmp/pkg.log && { echo "FAIL: 既有 validation-clock 测试回归"; exit 1; } || true

echo "✅ Golden Path 验证通过：验证窗随 fix 轮顺延，零回归保持"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveValidationClock` 传 `timeoutSeconds` 为 0/负数/非整数 → 必须 throw `validation_clock_timeout_invalid`（不得因顺延乘法把 0 静默放行）
- 边界值: fixCount 极大（decisionLog 含大量 generator-fix 行）→ deadline 仍是有限值，不溢出、不无界（有界性铁律）
- 中途中断/在途: 锚 detail 的 `deadline_at` 写成任意历史 base（k=1）或任意中间档（1<k<1+fixCount）→ 应容忍返回当前 fixCount 顺延值，不误判 invalid
- 重复计数: 锚 hop 本身是 `spawn:generator`（非 fix）时不得把锚计入 fixCount；hop < 锚 hop 的 fix 行（若存在乱序）不得计入
发现分级: P0/P1（顺延回退 / 零回归破坏 / 无界增长）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 多轮 fix 验证窗顺延（冻结） | `sprints/08221948-kernel-0ddf7faa/tests/validation-clock-fix-extension.test.js` | one timeout per generator-fix；exactly one timeout for a single generator-fix；tolerates a persisted anchor clock already advanced；finite and exactly linear for a bounded fix count；byte-for-byte unchanged when no generator-fix | → 4 failing（extend×2 值不符 + tolerance throw invalid + boundedness 值不符），zero-regression 用例本就 green（RED 实证：`Tests 4 failed \| 1 passed`） |
| 既有 clock 语义回归（补充行） | `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` | 既有 11 断言（reuses the persisted clock；recovers a pre-fix in-flight run；fails closed …malformed 等） | → 修复后仍全绿（零回归） |
