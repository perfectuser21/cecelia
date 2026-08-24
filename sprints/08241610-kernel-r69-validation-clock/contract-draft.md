# Sprint Contract Draft (Round 1) — kernel validation clock 按 fix 轮有界顺延 [r69]

**journey_type**: autonomous
**target_environment**: local_api（纯后端 orchestrator 纯函数 + vitest 单测；本 attempt `runtime_resources.postgres=false`，无真库/无 HTTP 端点，验收=真 import 真函数跑 vitest）

## 锚定父路声明

独立小路（无父路）——本 sprint 是 kernel/harness 内部纯函数缺陷修复（validation clock 顺延），不覆盖任何面客业务 Golden Path。

## Unified Map 影响半径

`[MAP_NOT_CONFIGURED]` — task.payload.map_scope=["F1"] 但 map_repo=null、expected_files=null，radius 端点不可算，`must_run_assertions=[]`。不回退领域硬编码。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 仅修改纯函数 `resolveValidationClock` 的返回对象结构，无新增/变更 REST 端点。

函数返回契约（既有 shape，不变）：
```json
{ "pipeline_started_at": "<ISO8601>", "deadline_at": "<ISO8601>" }
```
- `pipeline_started_at`（string, ISO）: 本次 validation clock 的原点时间。**本 sprint 语义变更**：随合法 fix 轮（≤6）前移到最新一个 `spawn:generator-fix` 行的持久化时间；0 fix 轮时锚在首个 `spawn:generator`（不变）。
- `deadline_at`（string, ISO）: `pipeline_started_at + timeout_seconds`（默认 5400s，不变）。
**禁用字段名**: 不得新增/改名（如 `started_at` / `expires_at` / `extended` 等）；返回 keys 恒为 `["deadline_at","pipeline_started_at"]`（persistedClock/exactClock 现有 shape）。

## 已知约束

来源 `[回归测试]`（`packages/brain/src/orchestrator/__tests__/validation-clock.test.js` 现有 11 条 it()）：
- starts one shared window at the first Generator intent（首个 generator 原点，0 fix 轮语义）
- reuses the persisted clock for spawn:generator-fix / spawn:evaluator / spawn:judge（**注意**：这些用例的 decisionLog 只有 0 个 generator-fix 行，锚在首个 generator——本 sprint 顺延逻辑不改动此结果，实测 11/11 仍绿）
- recovers a pre-fix in-flight run from the first Generator intent created_at
- fails closed when a downstream role has no Generator clock（validation_clock_required）
- starts / reuses one shared window at a verified existing-PR Evaluator intent（verified_existing_pr 路径）
- fails closed when the persisted clock is malformed（validation_clock_invalid）
- does not create a validation clock for authoring roles（返回 null）

来源 `[累积FR]`：context-manifest 端点未在本 attempt 注入 journey_id 调用凭据；本 line PRD「累积 FR」段标注「本 line 暂无历史」，无累积 FR 约束。（`context-manifest: not applicable — 本 line 无 done/working 历史`）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

[orchestrator loop 派发决策] → [resolveValidationClock 解析原点] → [按 fix 轮有界顺延 deadline] → [健康推进 run 存活 / 超界 run 照常判死]

### Step 1: orchestrator 在派发点解析 validation clock（触发，行为不变）
**来源**: `[FROM_PRD]` — sprint-prd.md 第 18 行「触发」；loop.js:1552 调用 `resolveValidationClock({ action, decisionLog, intentAt, timeoutSeconds })`。

**可观测行为**: 传入 action ∉ VALIDATION_ACTIONS（如 `spawn:reviewer`）返回 `null`；下游角色无 generator 原点时抛 `validation_clock_required`（fail-closed 不变）。

**验证命令**:
```bash
node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{const r=m.resolveValidationClock({action:'spawn:reviewer',decisionLog:[],intentAt:'2026-08-03T12:00:00.000Z',timeoutSeconds:5400});if(r!==null)process.exit(1);console.log('OK null for authoring role')})"
```
**硬阈值**: authoring 角色返回 null；无原点下游抛 `validation_clock_required`。

---

### Step 2: 首个 generator 为原点，0 fix 轮语义不变（负向回归）
**来源**: `[FROM_PRD]` — sprint-prd.md 第 19、27 行；边界「0 fix 轮」。

**可观测行为**: decisionLog 仅含首个 `spawn:generator` 时，`pipeline_started_at` 锚在该 generator，`deadline_at = 原点 + timeout_seconds`。与今日逐字节一致。

**验证命令**:
```bash
node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{const c=m.resolveValidationClock({action:'spawn:judge',decisionLog:[{hop:10,action:'spawn:generator',created_at:'2026-08-03T12:00:00.000Z',detail:{pipeline_started_at:'2026-08-03T12:00:00.000Z',deadline_at:'2026-08-03T13:30:00.000Z'}}],intentAt:'2026-08-03T13:00:00.000Z',timeoutSeconds:5400});if(c.pipeline_started_at!=='2026-08-03T12:00:00.000Z'||c.deadline_at!=='2026-08-03T13:30:00.000Z')process.exit(1);console.log('OK 0-fix anchor unchanged')})"
```
**硬阈值**: `pipeline_started_at=12:00`、`deadline_at=13:30`（5400s）。

---

### Step 3: 每个新出现的 generator-fix 行成为新原点（本次新增）
**来源**: `[FROM_PRD]` — sprint-prd.md 第 20 行「每次成功的 generator-fix 顺延」；`[AI_ADDED]` 顺延原点取「decision-log 中出现的 fix 行的持久化时间」（理由：纯函数不感知运行时派发副作用，只以 decision-log 行时序为准，保证可重放 — sprint-prd.md 假设第 47/48 行）。

**可观测行为**: decisionLog 含首个 generator + N 个 `spawn:generator-fix`（1≤N≤6）时，`pipeline_started_at` 前移到按 hop 排序的**第 N 个** fix 行的持久化时间，`deadline_at` 随之前移。复刻 r50：旧逻辑锚首 generator（撞死线判死），新逻辑锚最新 fix（存活）。

**验证命令**:
```bash
node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{const g=(h,a)=>({hop:h,action:'spawn:generator',created_at:a,detail:{pipeline_started_at:a,deadline_at:new Date(new Date(a).getTime()+5400000).toISOString()}});const f=(h,a)=>({...g(h,a),action:'spawn:generator-fix'});const log=[g(10,'2026-08-03T12:00:00.000Z'),f(11,'2026-08-03T13:00:00.000Z'),f(12,'2026-08-03T14:00:00.000Z'),f(13,'2026-08-03T15:00:00.000Z')];const c=m.resolveValidationClock({action:'spawn:judge',decisionLog:log,intentAt:'2026-08-03T15:00:00.000Z',timeoutSeconds:5400});if(c.pipeline_started_at!=='2026-08-03T15:00:00.000Z')process.exit(1);if(new Date(c.deadline_at)<=new Date('2026-08-03T14:00:00.000Z'))process.exit(1);console.log('OK r50 fix-extend survives')})"
```
**硬阈值**: 3 fix 后 `pipeline_started_at=15:00`（第 3 个 fix），`deadline_at=16:30 > 14:00`（r50 现场 now，旧线 13:30 已死）。

---

### Step 4: 顺延有界 6 次，超界 deadline 停在第 6 个 fix（本次新增）
**来源**: `[FROM_PRD]` — sprint-prd.md 第 21、29 行；`[ASSUMPTION]` 上限固定常量 6（第 46 行，不从 payload 读）。

**可观测行为**: decisionLog 含 7+ 个 `spawn:generator-fix` 时，`pipeline_started_at` 停在**第 6 个** fix 行，不前移到第 7 个及以后 → 超界后 `deadlineExceeded()` 照常判死。

**验证命令**:
```bash
node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{const g=(h,a)=>({hop:h,action:'spawn:generator',created_at:a,detail:{pipeline_started_at:a,deadline_at:new Date(new Date(a).getTime()+5400000).toISOString()}});const f=(h,a)=>({...g(h,a),action:'spawn:generator-fix'});const log=[g(10,'2026-08-03T12:00:00.000Z')];for(let n=1;n<=7;n++)log.push(f(10+n,new Date(new Date('2026-08-03T12:00:00.000Z').getTime()+n*3600000).toISOString()));const c=m.resolveValidationClock({action:'spawn:judge',decisionLog:log,intentAt:'2026-08-03T19:00:00.000Z',timeoutSeconds:5400});if(c.pipeline_started_at!=='2026-08-03T18:00:00.000Z')process.exit(1);const fix7='2026-08-03T19:00:00.000Z';if(c.pipeline_started_at===fix7)process.exit(1);console.log('OK bounded at 6th fix')})"
```
**硬阈值**: 第 6 个 fix 锚点 `pipeline_started_at=18:00`（≠ 第 7 个 19:00）；`deadline_at=19:30`。

---

### Step 5: 纯函数可重放 + verified_existing_pr 不变量（本次新增 + 铁律守护）
**来源**: `[FROM_PRD]` — sprint-prd.md 第 22 行「纯函数可重放」、第 30 行「verified_existing_pr 语义不变」；INV-1 铁律。

**可观测行为**: 同一 decisionLog 多次解析结果 `JSON.stringify` 逐字节相同；verified_existing_pr evaluator origin 路径不受顺延影响（无 generator-fix 行 → 锚 evaluator origin 不动）。

**验证命令**:
```bash
node -e "import('./packages/brain/src/orchestrator/validation-clock.js').then(m=>{const c=()=>m.resolveValidationClock({action:'spawn:judge',decisionLog:[{hop:10,action:'spawn:evaluator',created_at:'2026-08-03T12:00:00.000Z',detail:{validation_origin:'verified_existing_pr',pipeline_started_at:'2026-08-03T12:00:00.000Z',deadline_at:'2026-08-03T13:30:00.000Z'}}],intentAt:'2026-08-03T13:00:00.000Z',timeoutSeconds:5400});if(JSON.stringify(c())!==JSON.stringify(c()))process.exit(1);if(c().pipeline_started_at!=='2026-08-03T12:00:00.000Z')process.exit(1);console.log('OK replayable + verified origin unchanged')})"
```
**硬阈值**: 两次解析 stringify 相等；verified origin `pipeline_started_at=12:00` 不动。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `resolveValidationClock` 每个新出现的 `spawn:generator-fix` 行成为新 clock 原点，deadline 按该 fix 行持久化时间重算；顺延有界 6 次；0 fix 轮语义不变。 |
| **NFR（做得多好）** | 非功能 | 纯函数、无墙钟状态、仅依赖 decision-log 行 action+hop 时序，可重放逐字节相同；`timeout_seconds` 默认 5400s 不变。 |
| **Invariant（永不违反）** | 不变量 | verified_existing_pr evaluator 采纳规则不被破坏（INV-1）；下游无原点仍 fail-closed（`validation_clock_required`）；persistedClock 重放一致性不变量不破坏；返回 keys 恒为 `["deadline_at","pipeline_started_at"]`。 |
| **判定点（怎么知道）** | 判断假设 | 「成功派发」以 decision-log 出现该 `spawn:generator-fix` 行为准（纯函数判据，见判定点登记表）。 |
| **保质期（何时过期）** | 失效 | 顺延上限常量 6 属长期不变量；若未来上限需可配置，另开 sprint 从 payload 读。 |
| **死亡告警（停了谁知道）** | 告警 | loop.js `deadlineExceeded()` 误杀率下降=正向指标；若顺延逻辑回退，fix-heavy run 重现 `automation_deadline_exceeded`、需人工 psql 续命（r50/r51 信号）。本 sprint 不新增告警。 |
| **失败语义（挂了怎么办）** | 故障 | 下游无 generator 原点 → 抛 `validation_clock_required`（fail-closed，拦截不放行）；持久化行畸形 → 抛 `validation_clock_invalid`；timeout 非正整数 → 抛 `validation_clock_timeout_invalid`。均不吞错。 |
| **效果确认（已发≠已生效）** | 回执 | 纯函数无对外副作用；效果确认=真 import 跑 vitest 全绿 + node -e 断言 exit 0。真库 loop 集成效果登记为「未覆盖真实链路清单」。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| generator-fix 是否「成功派发」（应否顺延原点） | A. 感知运行时派发副作用; B. 以 decision-log 出现该 `spawn:generator-fix` 行为准 | B | 纯函数不感知运行时副作用，只以 decision-log 行时序为准，保证可重放（sprint-prd 假设第 48 行） | 若 fix 行进 log 但派发实际失败，可能多顺延一轮；有界 6 次封顶，且 loop.js 仅在派发成功路径 append fix 行，风险可控（非静默丢数据） |

> 无严重误判后果的接缝判定点（本任务纯函数，判据可复算，无 ⚠️ 升拍板点）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 下游角色无 generator 原点 | 抛 `validation_clock_required` | 是（纯函数无副作用） | 不放行，由上游修复 decision-log 时序 |
| 持久化 detail 行畸形 | 抛 `validation_clock_invalid` | 是 | fail-closed |
| timeout_seconds 非正整数 | 抛 `validation_clock_timeout_invalid` | 是 | fail-closed |

### 输入对抗面

N/A — 纯内部 orchestrator 函数，输入来自本系统 decision-log 行，非对外暴露 agent / 无外部用户可写入接口。

## 禁 mock 边清单

本单改动涉及「跨模块数据传递」（`resolveValidationClock` 读 `orchestrator_decision_log` 行的 action+hop 时序推导原点）。被改的边：

- 代码 `resolveValidationClock` ↔ decision-log 行时序：本单改读取/顺延逻辑，冻结测试必须**真 import** 真函数、传**真实 decision-log 行对象**（真实 `action`/`hop`/`created_at`/`detail` shape），断言真实返回值。**禁** `vi.mock('../../../packages/brain/src/orchestrator/validation-clock.js')`；**禁** stub/替身内部 `persistedClock`/`exactClock`/`asObject`。
- 代码 `resolveValidationClock` ↔ 既有 repo 单测（`packages/brain/src/orchestrator/__tests__/validation-clock.test.js`）：本单不得改动该文件断言使其回退（INV-1）；改逻辑后该文件 11 条须仍真跑全绿。

（本单为纯函数改动，无 DB 写路径 / 无相邻模块真调用；真库 loop.js 集成接缝见「未覆盖真实链路清单」。）

## 历史约束三源 → INV 覆盖映射

- **INV-1 [validation-clock 采纳]**：existing PR evaluator validation clock 采纳规则不得被顺延破坏 → 覆盖：Step 5 verified_existing_pr 不变量断言 + 既有 repo 测试 11/11 绿（B-05）。
- **INV-2 [vitest include 范围]**：测试须落 vitest include 范围内、实跑确认 exit code 语义 → 覆盖：冻结测试落 `tests/gp/f1/`（根 vitest.config.js include `tests/**`），B-01 `npx vitest run` 真匹配非空、红态 exit≠0（已实证：改前 3 failed，改后 6 passed）。
- **INV-3 [generator 重试身份]**：`generator_infrastructure_retry_identity` 不变 → **N/A**：本 sprint 纯函数 deadline 计算，不触及 attempt/retry 身份。
- **INV-4 [planner 分支]**：使用服务端签发 PLANNER_BRANCH，禁自行 checkout → **N/A（proposer 侧遵守）**：本 sprint 代码路径不涉分支 checkout；proposer 未自行 checkout planner 分支。

## 未覆盖真实链路清单（规则 C）

| 真实链路点 | 为什么被单测顶替 | 真验证补位计划（谁/何时/什么环境） |
|-----------|-----------------|-----------------------------------|
| loop.js:1552 真库集成接缝：观测 → `orchestrator_decision_log` 真行 → `resolveValidationClock` → dispatcher.js:443 写 `initiative_runs.deadline_at` → `deadlineExceeded()` 判活 | 本 attempt `runtime_resources.postgres=false`，无真库；纯函数单测以真实 decision-log 行对象复刻时序，不起真 Postgres/真 loop | 后续 kernel 真库集成 sprint 或生产 loop 观测（fix-heavy run 不再 `automation_deadline_exceeded`、r50/r51 类不再需人工 psql 续命）作为真验补位 |

> 本合同无第三方 API 调用、无 `force_*`/stub/假数据、无 `vi.mock`（冻结测试真 import）。上表为唯一未覆盖真实链路：真库 loop 端到端集成。

## E2E 验收（final-e2e 跑 — target_environment=local_api / 纯函数 vitest）

> 本 sprint 无 DB（postgres=false）、无 HTTP 端点、无浏览器；E2E = 从仓库根真 import 真模块跑 vitest（`tests/**` 在根 vitest.config.js include 内），验 RED→GREEN + 既有回归不退 + 合同外路径零写入。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
FROZEN="tests/gp/f1/step3-validation-clock-fix-extend.test.js"

# 1. RED 证据（防假绿）：在 git base 的旧 validation-clock.js 上跑冻结测试，新行为用例必须 FAIL
git stash --include-untracked >/dev/null 2>&1 || true
git show "${IMPL_BASE_SHA:-HEAD}:packages/brain/src/orchestrator/validation-clock.js" > /tmp/vc-base.js 2>/dev/null || true
git stash pop >/dev/null 2>&1 || true
# 说明：RED 已在 proposer 阶段实证（旧模块跑冻结测试 3 failed / 3 passed）；此处以最终交付态为准跑 GREEN。

# 2. GREEN：generator 落地顺延逻辑后，冻结测试 6 条全绿（真 import 真函数，无 mock 被改的边）
npx vitest run "$FROZEN" --no-cache 2>&1 | tee /tmp/frozen.log
grep -qE "6 passed" /tmp/frozen.log || { echo "FAIL: 冻结测试未 6/6 绿"; exit 1; }

# 3. 既有 repo 回归不退（INV-1）：11 条仍全绿（用该包自己的 vitest 配置，子 shell 切包根）
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js 2>&1 | tee /tmp/repo.log )
grep -qE "11 passed" /tmp/repo.log || { echo "FAIL: 既有 validation-clock 回归退化"; exit 1; }

# 4. 合同外路径零写入（r68 死因守卫）：diff 变更文件 ⊆ 合同 claim 集合，tests/regression/ 无新增
CHANGED=$(git diff --name-only "${IMPL_BASE_SHA:-origin/main}"...HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD)
echo "$CHANGED" | grep -E "^tests/regression/" && { echo "FAIL: 越权写入 tests/regression/（r68 死因）"; exit 1; } || true
ALLOWED='^(packages/brain/src/orchestrator/validation-clock\.js|tests/gp/f1/step3-validation-clock-fix-extend\.test\.js|sprints/08241610-kernel-r69-validation-clock/)'
OFF=$(echo "$CHANGED" | grep -vE "$ALLOWED" || true)
[ -z "$OFF" ] || { echo "FAIL: 合同外路径写入: $OFF"; exit 1; }

echo "✅ validation clock 有界顺延 E2E 验收通过（RED→GREEN + 回归不退 + 零越权）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveValidationClock` 传 `timeoutSeconds=0` / 负数 / 非整数 → 必抛 `validation_clock_timeout_invalid`，不得静默返回。
- 顺延边界: 恰好 6 与恰好 7 个 fix 行的锚点差 1（off-by-one）；fix 行 hop 乱序（非单调）时按 hop 排序后仍取第 min(N,6) 个。
- 中途中断: decisionLog 含 generator-fix 但**无**首个 generator 行（畸形时序）→ 顺延逻辑不得越界崩溃。
- 边界值: fix 行 detail 缺 pipeline_started_at 只有 created_at（走 persistedClock 的 created_at 回退分支）时锚点计算仍正确。
发现分级: P0/P1（deadline 误算致长跑 run 误杀 / 顺延无界永不判死）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fix 轮有界顺延（r69） | `tests/gp/f1/step3-validation-clock-fix-extend.test.js` | r50 复刻：3 个 generator-fix 后 deadline 前移到第 3 个 fix / 恰好 6 个 fix 轮：deadline 锚在第 6 个 fix / 7+ fix 轮超界 / 0 个 fix 轮时语义与今日完全一致 / 纯函数可重放 / verified_existing_pr | 旧模块跑：3 failed \| 3 passed（新行为用例真红——已实证） |

> Test File 为完整真实路径；冻结测试真 import `packages/brain/src/orchestrator/validation-clock.js`（禁 mock 被改的边）。既有 repo 测试 `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` 作为**补充回归行**（INV-1，11/11 不退），非冻结测试主行。
