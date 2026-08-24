# Sprint Contract Draft (Round 1) — validation clock 按 fix 轮自动顺延（有界）[r70]

**锚定父路声明**: 独立小路（无父路）—— journey e6f803f2 的 golden-paths 均为 planned 态，本 sprint 为 kernel 内部稳定性小路，PrepPRD step_id=none。

**journey_type**: autonomous
**target_environment**: local_api（纯后端 kernel 纯函数；E2E 走本地 node ESM 直调 + vitest 直跑冻结测试，无 DB、无真机、无浏览器）

> 说明：runtime_resources.postgres=false。被改对象 `resolveValidationClock` 是纯函数（只依赖入参 decision_log 的 action+hop），DoD/E2E 全部为无 DB 的进程内断言，与 local_api 纯函数场景一致。

## Response Schema（推导来源: PRD 明确 — 纯内部函数无 HTTP）

N/A — 本任务无 HTTP 响应（纯 kernel 函数 `resolveValidationClock` 的返回对象），无端点、无 DB 写路径。返回对象 shape 由既有实现固定为 `{ pipeline_started_at: ISO8601, deadline_at: ISO8601 }`（`exactClock` 已冻结），本 sprint 不改 shape，只改 **origin 选点逻辑**（deadline_at 前移）。Reviewer 第 6 维按纯函数处理。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/orchestrator/__tests__/validation-clock.test.js`（brain-ci required）现有 11 条断言必须全绿不得回退，尤其：
  - "starts one shared window at the first Generator intent"（无 fix 行 → 首 generator 原点）
  - "recovers a pre-fix in-flight run from the first Generator intent created_at"（decisionLog 仅 1 条 generator、无 generator-fix **行** → 首 generator 原点）
  - "reuses the persisted clock for spawn:generator-fix"（action 为 generator-fix 但 decisionLog 无 fix **行** → 复用首 generator 持久 clock）
  - "fails closed when a downstream role has no Generator clock" → 抛 `validation_clock_required`
  - "fails closed when the persisted clock is malformed" → 抛 `validation_clock_invalid`
  - "starts one shared window at a verified existing-PR Evaluator intent"（allowEvaluatorOrigin=true）
  已核实：以上所有 decisionLog **均不含** `action:'spawn:generator-fix'` 的行，故顺延分支（仅在存在 fix 行时触发）对它们零影响。
- [累积FR] context-manifest: unavailable（本 sprint 无 line context-manifest 端点可达，postgres=false）；PRD 累积 FR 段声明本 line 暂无历史已验收行为，无 FR 回退风险。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

[进入 validation 阶段的多 fix 轮 run] → [decision_log 出现 N 条 spawn:generator-fix] → [resolveValidationClock 以第 min(N,6) 条 fix 为新原点顺延 deadline] → [管线健康时不被误杀 / 超限第 7+ 次冻结在第 6 原点照常判死]

### Step 1: run 进入 validation，decision_log 先有 spawn:generator 再陆续出现多条 spawn:generator-fix
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1（PRD 第 18 行）

**可观测行为**: `resolveValidationClock` 入参 decisionLog 含 1 条 `spawn:generator` + N 条 `spawn:generator-fix`（每条 = 一次 fix 轮派发成功）。

**验证命令**:
```bash
# 见 ## E2E 验收 脚本 step B-01；node ESM 直调，无 DB
```
**硬阈值**: N=2、管线健康时新 deadline = 最后一条 fix.created_at + timeout_seconds（5400s）
**验证命令（硬阈值）**: `resolveValidationClock(...).deadline_at === '2026-08-03T13:30:00.000Z'`（fix 原点 12:00 + 90min）

---

### Step 2: clock 以 hop 时序中第 min(N,6) 条 spawn:generator-fix 为新原点重新起算
**来源**: `[FROM_PRD]` — Golden Path 步骤 2、3（PRD 第 19-20 行）

**可观测行为**: fix 行按 `hop` 数值排序后，origin = 第 min(N,6) 条 fix 行；deadline = persistedClock(该行, timeout)。乱序数组传入按 hop 排序后同结果（可重放）。

**验证命令**:
```bash
# 见 ## E2E 验收 脚本 step B-02（超限冻结）、B-05（乱序可重放）
```
**硬阈值**: N=7 时 origin=第 6 条 fix（hop 70=16:00），deadline=17:30（**不是**第 7 条 17:00→18:30）
**验证命令（硬阈值）**: `resolveValidationClock(...).pipeline_started_at === '2026-08-03T16:00:00.000Z' && .deadline_at === '2026-08-03T17:30:00.000Z'`

---

### Step 3: 管线健康 → 不被误杀；超限 / 无原点 → fail-closed 照常判死
**来源**: `[FROM_PRD]` — Golden Path 步骤 4、5 + 边界情况（PRD 第 21-22、28-32 行）

**可观测行为**:
- 无 `spawn:generator-fix` 行 → 结果与现状逐字节一致（首 generator 原点，deadline 11:30）。
- decisionLog 缺原点（下游角色无 generator clock）→ 抛 `validation_clock_required`（fail-closed 不削弱）。

**验证命令**:
```bash
# 见 ## E2E 验收 脚本 step B-03（无 fix 回归）、B-04（fail-closed）
```
**硬阈值**: 无 fix → deadline 11:30（与 base 一致）；空 decisionLog + downstream → throw `validation_clock_required`
**验证命令（硬阈值）**: 见 B-03 / B-04 node 断言（deadline 相等 / catch 到指定错误码）

---

### Step 4: 顺延原点复用 persistedClock 一致性校验（fail-closed 防造假）
**来源**: `[AI_ADDED]` — 理由：防止 generator 把顺延原点选点实现成"绕过 persistedClock 一致性校验"，若 fix 行携带自相矛盾的 detail(pipeline_started_at/deadline_at) 必须抛 `validation_clock_invalid`，不得静默取用（PRD 假设 3 明示复用一致性语义）。

**可观测行为**: fix 原点 detail 自洽 → 复用其持久 clock；不自洽 → 抛 `validation_clock_invalid`。

**验证命令**:
```bash
# 见 ## E2E 验收 脚本 step B-06
```
**硬阈值**: 不自洽 detail → throw `validation_clock_invalid`
**验证命令（硬阈值）**: 见 B-06 node 断言（catch 到 `validation_clock_invalid`）

---

## 可写白名单（合同边界铁律 — r68/r69 双向教训，Reviewer 逐条核对）

本合同 claim 范围 = generator（GREEN PR）**可写文件全集**，显式包含全部 CI 门禁必需产物。除下述清单外，**禁止创建/修改任何计划外文件**（r68：不得在 tests/regression/ 等目录放副本）；同时**禁止把白名单锁死为仅实现文件**（r69：锁死 = 与门禁互斥 = 无绿态可达，已由 generator attempt 56a09164 死局分析证实）。

| # | 文件/目录 | 用途 | 门禁 |
|---|---|---|---|
| 1 | `packages/brain/src/orchestrator/validation-clock.js` | 实现 `resolveValidationClock` 顺延逻辑主体 | 功能 |
| 2 | `tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js` | F1 step3 gp 冻结 RED 测试（proposer 已 commit；generator 不重写，如需可微调） | gp-anchor / feature-has-smoke 闸 |
| 3 | `packages/brain/package.json` | version bump | check-version-sync |
| 4 | `package-lock.json`（根） | version bump 同步 | check-version-sync |
| 5 | `.brain-versions` | version bump 追加 | check-version-sync |
| 6 | `DEFINITION.md` | version bump + facts 同步 | facts-check / check-version-sync |
| 7 | `DoD.md`（根） | 本 sprint DoD ↔ Test 映射（generator 覆盖为本 sprint 内容） | check-dod-mapping |
| 8 | `sprints/08250010-kernel-r70-validation-clock/**` | 合同四件套（sprint-prd / contract-draft / contract-dod / tests/ 冻结测试） | 合同封印 |

**Green commit message 前缀**: `fix(`（本任务即 `fix(kernel): ...`）。`lint-feature-has-smoke` 对 `fix(` 前缀按规则跳过（无需新增 feature smoke）；gp step3 冻结测试仍已落 `tests/gp/f1/`。

## 禁 mock 边清单

本单改动属"状态机 / 判定逻辑"类（deadline 判死判活的原点选择），但被改对象是**纯函数**、无跨模块 / 无 DB 写路径 / 无生命周期钩子。禁 mock 的边：

- 代码 ↔ `resolveValidationClock`（本单改其内部 origin 选点逻辑）：所有测试（`tests/gp/f1/step3-*.test.js`、`sprints/<dir>/tests/*.test.js`）必须**真 import** `packages/brain/src/orchestrator/validation-clock.js` 并直调，**禁止** `vi.mock`/stub 该模块或其内部 `persistedClock`/`exactClock`。入参 decision_log 为 POJO 数组（纯数据，非替身）。
- 无真实相邻模块 / 无真 Postgres 边（纯函数，不触达 DB / loop.js）——真库 loop.js 集成接缝显式登记进「未覆盖真实链路清单」，交后续 sprint。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | `resolveValidationClock` 在 decision_log 含 N 条 `spawn:generator-fix` 行时，以第 min(N,6) 条 fix 行为新原点重算 deadline（顺延有界 6）；N=0 语义不变 |
| **NFR（做得多好）** | | `timeout_seconds` 默认 5400s 不改；顺延上限 6 次；纯函数 O(len(log))，可重放 |
| **Invariant（永不违反）** | | ① `validation_clock_required` fail-closed 默认语义不削弱；② 只依赖入参 action+hop，不读真实时钟/外部状态；③ 无 fix 行时结果与现状逐字节一致 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 无 token/凭据；行为随 orchestrator 语义长期有效，无退役计划 |
| **死亡告警（停了谁知道）** | | 顺延逻辑回退（误杀复现）→ 长跑 run 再次需人工 psql 续命（r50/r51 同类），watchdog 判死会写 decision_log，可回溯；本 sprint 不新增告警通道 |
| **失败语义（挂了怎么办）** | | 缺原点 / detail 不自洽 → 抛错 fail-closed（拦截，不静默放行）；纯函数无重试语义，同输入必同输出 |
| **效果确认（已发≠已生效）** | | 返回对象 deadline_at 即刻可断言（进程内），无异步生效延迟 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| 一次"fix 轮派发成功"如何计数 | A. decision_log 一条 `action='spawn:generator-fix'` 行; B. 独立成功标记字段 | A（一条 generator-fix 行 = 一次派发成功） | 无独立成功标记字段（PRD 假设 1）；append 发生在派发成功后 | 顺延计数偏差；但有界 6 兜底 + fail-closed 保留，不会静默放行判活 |

> 本判定点误判后果非严重（有界 + fail-closed 双重兜底，不会导致不可逆动作或面客错误），不标 ⚠️。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 下游角色缺 generator 原点 | 抛 `validation_clock_required`（拦截） | 是（纯函数同输入同输出） | 无降级，fail-closed |
| fix 原点 detail 自相矛盾 | 抛 `validation_clock_invalid`（拦截） | 是 | 无降级，fail-closed |
| `timeout_seconds` 非正整数 | 抛 `validation_clock_timeout_invalid`（既有） | 是 | 无降级 |

### 输入对抗面

N/A — 非对外暴露 agent；入参 decision_log 由 orchestrator 内部从 DB 读出的可信数据，无外部用户直写路径、无 prompt injection 面。

## 未覆盖真实链路清单

| 被 mock/未覆盖的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| 真库 `loop.js` 集成接缝（resolveValidationClock 在真实 orchestrator loop 中随新 fix 行推进 deadline，watchdog 真读 deadline 判活） | PRD 范围限定明确"不做真库 loop.js 集成接缝"，且本 attempt runtime_resources.postgres=false 无真库 | 交后续 sprint：真 Postgres 起 orchestrator loop，构造多 fix 轮 run，断言 watchdog 在管线健康时不判死（local_api + postgres=true 环境） |

> 本 sprint 交付纯函数逻辑（logic-done）；上表接缝为 `logic-done-pending`，不标 done。

## E2E 验收（final-e2e — target_environment=local_api，node ESM 直调 + vitest 直跑，无 DB）

**journey_type**: autonomous
**target_environment**: local_api

> 全部断言为进程内纯函数直调（无 DB / 无网络 / 无真机）。evaluator 从仓库根执行；`tests/**` 与 `sprints/**` 均在根 vitest include 内，可从根 `npx vitest run` 直跑冻结测试。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

VC="./packages/brain/src/orchestrator/validation-clock.js"

echo "▶ 1) 直跑两处冻结测试（gp 闸 + sprint 封印），断言全绿"
npx vitest run \
  tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js \
  sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js \
  --reporter=basic

echo "▶ 2) 直跑既有 brain 单测，断言无回归"
( cd packages/brain && npx vitest run ./src/orchestrator/__tests__/validation-clock.test.js --reporter=basic )

echo "▶ B-01 r50 replay：2 条 fix → deadline 顺延到 13:30（旧判死新存活）"
node --input-type=module -e "const {resolveValidationClock}=await import('$VC'); const log=[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'},{hop:20,action:'spawn:generator-fix',created_at:'2026-08-03T11:00:00.000Z'},{hop:30,action:'spawn:generator-fix',created_at:'2026-08-03T12:00:00.000Z'}]; const r=resolveValidationClock({action:'spawn:evaluator',decisionLog:log,intentAt:'2026-08-03T12:30:00.000Z',timeoutSeconds:5400}); if(r.pipeline_started_at!=='2026-08-03T12:00:00.000Z'||r.deadline_at!=='2026-08-03T13:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)"

echo "▶ B-02 有界冻结：7 条 fix → deadline 冻结在第 6 条原点 17:30"
node --input-type=module -e "const {resolveValidationClock}=await import('$VC'); const log=[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'}]; for(let i=0;i<7;i++){log.push({hop:20+i*10,action:'spawn:generator-fix',created_at:'2026-08-03T'+String(11+i).padStart(2,'0')+':00:00.000Z'})} const r=resolveValidationClock({action:'spawn:judge',decisionLog:log,intentAt:'2026-08-03T18:00:00.000Z',timeoutSeconds:5400}); if(r.pipeline_started_at!=='2026-08-03T16:00:00.000Z'||r.deadline_at!=='2026-08-03T17:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)"

echo "▶ B-03 无 fix 回归：0 条 fix → deadline 与现状一致 11:30"
node --input-type=module -e "const {resolveValidationClock}=await import('$VC'); const r=resolveValidationClock({action:'spawn:evaluator',decisionLog:[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'}],intentAt:'2026-08-03T10:20:00.000Z',timeoutSeconds:5400}); if(r.pipeline_started_at!=='2026-08-03T10:00:00.000Z'||r.deadline_at!=='2026-08-03T11:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)"

echo "▶ B-04 fail-closed：downstream 缺原点 → 抛 validation_clock_required"
node --input-type=module -e "const {resolveValidationClock}=await import('$VC'); try{resolveValidationClock({action:'spawn:evaluator',decisionLog:[],intentAt:'2026-08-03T10:00:00.000Z',timeoutSeconds:5400});console.error('FAIL no throw');process.exit(1)}catch(e){if(!String(e.message).includes('validation_clock_required')){console.error('FAIL',e.message);process.exit(1)} console.log('OK threw',e.message)}"

echo "▶ B-05 乱序可重放：打乱数组 → 同结果 13:30"
node --input-type=module -e "const {resolveValidationClock}=await import('$VC'); const log=[{hop:30,action:'spawn:generator-fix',created_at:'2026-08-03T12:00:00.000Z'},{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'},{hop:20,action:'spawn:generator-fix',created_at:'2026-08-03T11:00:00.000Z'}]; const r=resolveValidationClock({action:'spawn:evaluator',decisionLog:log,intentAt:'2026-08-03T12:30:00.000Z',timeoutSeconds:5400}); if(r.deadline_at!=='2026-08-03T13:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)"

echo "▶ B-06 顺延原点 detail 不自洽 → fail-closed 抛 validation_clock_invalid"
node --input-type=module -e "const {resolveValidationClock}=await import('$VC'); const log=[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'},{hop:20,action:'spawn:generator-fix',created_at:'2026-08-03T12:05:00.000Z',detail:{pipeline_started_at:'2026-08-03T12:00:00.000Z',deadline_at:'2026-08-03T14:00:00.000Z'}}]; try{resolveValidationClock({action:'spawn:evaluator',decisionLog:log,intentAt:'2026-08-03T12:30:00.000Z',timeoutSeconds:5400});console.error('FAIL no throw');process.exit(1)}catch(e){if(!String(e.message).includes('validation_clock_invalid')){console.error('FAIL',e.message);process.exit(1)} console.log('OK threw',e.message)}"

echo "✅ Golden Path 全部验证通过（顺延存活 / 有界冻结 / 无 fix 回归 / fail-closed）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数低风险，不上调）
高风险面:
- 错输入: `hop` 为字符串 / null / NaN 的 fix 行（`Number(hop)` 排序稳定性）；`created_at` 非法字符串（应 fail-closed 抛 `validation_clock_invalid`）
- 重复提交: 同一 fix 行 hop 重复（相同 hop 的稳定排序不应导致原点跳变）
- 中途中断: N/A（纯函数无中断态）
- 边界值: N=6（恰好 6 条，第 6 条生效）；N=1（单条 fix 即顺延一次）；混入 `spawn:evaluator` validation_origin=verified_existing_pr 行 + fix 行（fix 行优先取原点）
发现分级: P0/P1（顺延逻辑让 fail-closed 失效 / 无 fix 行时结果漂移）→ 阻塞 merge；P2/P3（排序边界毛刺）→ 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 顺延主体 + 有界 + 回归 + fail-closed（sprint 封印冻结测试） | `sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js` | r50 replay / bounded / exactly 6 / replay-order / interleaved / persisted-consistent / persisted-inconsistent / regression-nofix / invariant-failclosed / determinism | base 上 9 fail（顺延未实现返回旧原点 11:30 / 有界返回旧值 / 不自洽未抛）+ 4 guard pass |
| 核心 RED（gp 闸必需产物） | `tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js` | r50 replay / bounded / regression-nofix | base 上 2 fail（r50/bounded 返回 11:30）+ 1 regression pass |

> 冻结测试路径为完整真实路径（非省略号）。两文件均真 import `packages/brain/src/orchestrator/validation-clock.js`，禁 mock 被改的边。既有 `packages/brain/.../validation-clock.test.js` 为 repo 既有测试，仅作补充回归护栏，不替代上述两行 sprint/gp 冻结测试。
