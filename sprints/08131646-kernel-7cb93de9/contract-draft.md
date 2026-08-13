# Sprint Contract Draft (Round 1)

fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle

**journey_type**: autonomous
**target_environment**: local_api（纯 packages/brain orchestrator 逻辑，vitest 单测层验证；无 HTTP 端点、无 DB、无真机）

gp-anchor: skipped (product-map.json not found)
contract-gate: present (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在，走代码层 + skill 内置双审查)

## 锚定父路声明

独立小路（无父路）——本 sprint 是 harness orchestrator 内部反馈闭环缺陷修复（judge FAIL 裁决未回填到下轮 evaluator bundle），不推进任何产品 Golden Path。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本改动是 `orchestrator/dispatcher.js` 内部 TaskBundle 组装（`buildInputs`）的字段注入，不新增/修改任何 HTTP 端点。验收 oracle 为 vitest 单测直接调用 `__test__.buildInputs`/`__test__.buildBundle` 断言 `inputs.judge_feedback` 结构，非 curl。

**注入契约（内部数据结构，非 HTTP）**：`role=evaluator` 且本 run 存在 `verdict:judge` FAIL 裁决时，`TaskBundle.inputs.judge_feedback` 结构为：
```json
{
  "verdict": "FAIL",
  "summary": "<sanitizeDiagnostic 脱敏+截断（≤2000）后的 judge 裁决 feedback，含点名缺失证据清单>",
  "failure_class": "<judgeVerdict.failure_class，如 evidence_insufficient，脱敏；缺失时为 null>",
  "round": "<number，本 run decisionLog 中 verdict:judge 行的条数 = 当前 fix loop 轮次>"
}
```
- 无 `verdict:judge` FAIL 裁决（首轮）→ 不含 `judge_feedback` 键。
- 仅 `role === 'evaluator'`（覆盖 `spawn:evaluator` 与 `spawn:evaluator-evidence-repair` 两个动作，均 role=evaluator）注入；其余角色（planner/proposer/reviewer/generator/judge）不注入。

## 已知约束

### 来自回归测试（Step 1.2）
- [dispatcher.test.js] → `generator-fix 只接收与当前 PR SHA 和 Attempt 绑定的安全 Evaluator 反馈`（既有 `buildEvaluatorFeedback` 脱敏范式，本 sprint 的 `judge_feedback` 注入必须复用同一 `sanitizeDiagnostic` 脱敏路径，不得引入未脱敏旁路）。
- [dispatcher.test.js] → `运行时依赖预装：evaluator TaskBundle 默认注入 runtime_resources.node_deps=true`（不得回退）。
- [dispatcher.test.js] → `把 payload.required_command_evidence 只读复制进 evaluator TaskBundle`（evaluator inputs 既有字段不得被本改动破坏）。

### 累积 FR（[累积FR]，Step 1.3）
- context-manifest: unavailable（本地无 localhost:5221，未取到累积 FR 摘要）。PRD「累积 FR」段声明「本 line 暂无历史」，与之一致，无额外约束。

### Unified Map 影响半径（Step 1.0）
- [MAP_NOT_CONFIGURED]：task.payload 无 map_scope/map_repo（无 localhost:5221 可达），无 `must_run_assertions`/`fact_revisions` 可注入。回归护栏改由「全量 orchestrator dispatcher 单测绿」BEHAVIOR 兜底。

### 铁律映射（Step 1.3 — PRD Invariant 逐条）
- INV-1 [证据先分类]：本 sprint 正是「evidence_insufficient 时优先走 evaluator 补证轮而非改代码」的支撑设施——把 judge 点名的缺失证据接回 evaluator，使补证轮有的放矢。合同不改 judge 裁决逻辑本身。→ B-01/B-05 覆盖（judge_feedback 携带 failure_class + 点名 summary）。
- INV-2 [证据窗口]（前 8×600）：本 sprint 不改动窗口；注入的 `summary` 经 `sanitizeDiagnostic` 截断至 ≤2000 字符，落在 evaluator 可读范围内。→ N/A（不触及窗口逻辑），由 B-03 截断回归间接保护体积。
- INV-3 [命令实跑]：本合同全部 [BEHAVIOR] 验证命令均为实跑 `npx vitest run <src 内测试文件>`，exit code 语义已实测（见 ## E2E 验收 备注：测试文件位于 `src/**` include 内，非范围外绿态误判）。→ B-01..B-05 全部实跑。
- INV-4 [已有PR时钟]：本 sprint 不建共享时钟、不改 validation_clock_required。→ N/A（不触及时钟逻辑）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `role=evaluator` bundle 组装时，读取本 run 最近一次 `verdict:judge` FAIL 裁决，注入 `inputs.judge_feedback`（summary + failure_class + round，脱敏+截断）；无 judge verdict 不注入。 |
| **NFR（做得多好）** | 性能/体积 | 注入后整条 TaskBundle ≤ 256KB（HARNESS_BUNDLE_MAX_BYTES）；summary 超长必截断（`sanitizeDiagnostic` ≤2000 字符）。 |
| **Invariant（永不违反）** | 不变量 | 只注入最近一次 judge FAIL；只对 evaluator 角色注入；summary/failure_class 必经 `sanitizeDiagnostic` 脱敏（无未脱敏旁路）；PASS 裁决不注入。 |
| **判定点（怎么知道）** | 判断假设 | 「本 run 是否存在 judge FAIL」判据 = `observed.judgeVerdict?.verdict === 'FAIL'`（ground-truth 已 latestRow 取最近一次 `verdict:judge` detail）。见判定点登记表。 |
| **保质期（何时过期）** | 失效 | judge_feedback 随 run 生命周期，无独立保质期；每轮 evaluator 重派时按当轮 observed 现算，不缓存。 |
| **死亡告警（停了谁知道）** | 告警 | 若注入逻辑回退，fix loop 重回「盲重跑→judge 原样 FAIL→升级人审」老路，由 issue 47c4434d 追踪的人审升级频次即信号；单测（本合同）红即挡在 CI。 |
| **失败语义（挂了怎么办）** | 故障 | judgeVerdict 缺失/字段不全 → 不注入（fail-safe，行为回退到现状，绝不抛错阻断派发）。见失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | 注入信号可判别：`inputs.judge_feedback` 有无即信号（可观测，NFR 呼应）；evaluator skill 消费侧提示词在含该字段时输出「优先补齐点名证据」指引。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 本 run 是否已有 judge FAIL 裁决可回填 | A. 读 `observed.judgeVerdict`（ground-truth latestRow 取最近 verdict:judge detail）；B. 直接 SQL 查 orchestrator_decision_log | A. 读 `observed.judgeVerdict` | dispatcher 只消费 ground-truth 组装好的 observed，不自查 DB（PRD 假设：无需新增持久化通道）；ground-truth 已保证「最近一次」语义 | 误判为无 → 退回盲重跑（回退现状，非新错误）；误判为有 → 注入旧轮反馈误导，但 ground-truth 的 latestRow 已锁最近一次，风险受控 |
| 当前 fix loop 轮次 round 取值 | A. count(`decisionLog` 中 action=verdict:judge 行)；B. 新增独立轮次计数器 | A. count judge 行 | 纯从 observed.decisionLog 可推（PRD 只列 dispatcher/test/skill 受影响文件，不改 ground-truth）；语义 = 已发生的 judge 裁决次数 = 当前轮次 | round 偏差只影响提示文案的轮次标注，不影响补证正确性（summary 才是承载点名清单的关键字段） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `observed.judgeVerdict` 为 null/undefined（首轮或无裁决） | 不注入 `judge_feedback`，evaluator 行为与现状逐字节一致 | 是（每轮按当轮 observed 现算，无副作用） | 天然降级到现状 |
| `judgeVerdict.verdict !== 'FAIL'`（如 PASS） | 不注入 | 是 | 同上 |
| `judgeVerdict.feedback` 为空/非字符串 | 不注入（无可承载的点名清单则回填无意义） | 是 | 同上 |
| judge summary 超长 | `sanitizeDiagnostic` 截断至 ≤2000 字符后注入，守住 256KB 闸 | 是 | 截断降级，保留前 2000 字符（点名清单通常在前列） |

### 输入对抗面

N/A — 本改动是 orchestrator 内部数据流（judge 裁决 → evaluator bundle），数据源为系统自产的 verdict:judge 决策日志，非对外暴露 agent 输入面。脱敏（`sanitizeDiagnostic`，含 Bearer/token= 等密钥模式）已对 summary/failure_class 生效，防止裁决文本携带的凭据外泄进下游 bundle。

## 禁 mock 边清单

本单改动涉及「跨模块数据传递」（ground-truth 产出的 `observed.judgeVerdict` → dispatcher `buildInputs` 组装 evaluator bundle inputs）：

- dispatcher `buildInputs`/`buildBundle` ↔ `observed.judgeVerdict`（本单改了这条数据接力：测试必须调用**真实** `__test__.buildInputs`/`__test__.buildBundle`，用真实 `observed` 输入驱动，断言真实产出的 `inputs.judge_feedback`；禁止 mock/stub `buildInputs` 本体或 `sanitizeDiagnostic`）。
- dispatcher `buildBundle` ↔ `enforceBundleSizeLimit`（256KB 闸真实执行：B-03 走真实 `buildBundle` + 真实 `enforceBundleSizeLimit`，断言真实 `Buffer.byteLength`，不 mock 体积计算）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——DoD/测试无 `force_*`/stub/假数据 顶替真实链路：全部 [BEHAVIOR] 直调真实 `__test__.buildInputs`/`buildBundle`/`enforceBundleSizeLimit`/真实 `sanitizeDiagnostic`，`observed` 字面对象是 ground-truth 的纯数据产物（合法输入，非被 mock 的邻居）。300000 字符的 judge feedback 是截断回归的大输入用例，非假数据。

说明：本单**无 DB 写路径、无状态机迁移、无生命周期钩子**（纯内存数据组装函数）。测试用 `observed` 字面对象作为**输入数据**（非被 mock 的邻居模块）——`observed` 本就是 ground-truth 的纯数据产物，构造字面 observed 等价于喂真实输入，符合「真相邻模块」要求：被测的那条边（buildInputs 读 judgeVerdict）是真实执行的。`attemptStore`/`launcher` 等仅在全链 `createDispatcher` 路径出现，属被改边之外的更外层无关依赖，本合同的 [BEHAVIOR] 直接打 `__test__.buildInputs` 纯函数，不触碰这些外层。

## Golden Path

[judge FAIL(evidence_insufficient) 已入库] → [fix loop/rerun 重派 evaluator] → [dispatcher 组装 evaluator bundle 读最近 judge FAIL] → [inputs.judge_feedback 注入点名证据清单] → [evaluator 打开 bundle 优先补齐点名证据]

### Step 1: 前置状态——同一 run 已存在 judge FAIL 裁决
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「背景」段（run 8783807c 实证）。

**可观测行为**: `observed.judgeVerdict.verdict === 'FAIL'` 且 `failure_class === 'evidence_insufficient'`，`feedback` 点名了缺失证据。ground-truth.js（`latestRow(decisionLog, action===verdict:judge)`）已负责取最近一次，本 sprint 不改此路径。

**验证命令**: 见 B-05（构造含 judge FAIL 的 observed，断言注入携带 failure_class）。

**硬阈值**: judgeVerdict 存在且 verdict=FAIL 时进入注入分支。

---

### Step 2: dispatcher 组装 evaluator bundle 时注入 judge_feedback
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 +「范围限定·在范围内」第 1 条。

**可观测行为**: `buildInputs('spawn:evaluator', ...)` 产出的 inputs 含 `judge_feedback = { verdict:'FAIL', summary:<脱敏截断的点名清单>, failure_class, round }`。注入点位于 dispatcher.js `if (spec.role === 'evaluator')` 分支（约 line 421），复用 `sanitizeDiagnostic`（与既有 `buildEvaluatorFeedback` 同款脱敏）。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "注入 judge_feedback 含 summary 与 failure_class"
# 期望：exit 0（该 it 绿）
```

**硬阈值**: `inputs.judge_feedback.summary` 含点名文本子串、`failure_class === 'evidence_insufficient'`、`round` 为正整数。

---

### Step 3: 首轮无 judge verdict 时行为不变；仅最近一次、仅 evaluator 角色
**来源**: `[FROM_PRD]` — PRD「边界情况」全部四条。
**来源**: `[AI_ADDED]` — 「多条 judge verdict 只取最近一次」的 round=2 断言，理由：防止 generator 用第一条/累加而非 latest，锚定「只注入最近一次」不变量可机检。

**可观测行为**:
- 无 judge verdict → inputs 不含 `judge_feedback`（行为逐字节回退现状）。
- judge PASS → 不注入。
- 非 evaluator 角色（judge）→ 不注入。
- 多条 judge verdict → 只注入最近一次，`round` = judge 行计数（=2）。

**验证命令**: 见 B-02（无 verdict）、B-04（非 evaluator）、以及 test 文件内 PASS/多条分支。

**硬阈值**: 上述四条边界断言全绿。

---

### Step 4: 256KB 传输闸回归——超长 summary 截断
**来源**: `[FROM_PRD]` — PRD「NFR 约束·传输闸」+「边界情况·judge summary 超长」+ 验收第 3 条。

**可观测行为**: 300KB 的 judge feedback 注入后，`inputs.judge_feedback.summary.length ≤ 2000`（`sanitizeDiagnostic` 截断），且经 `buildBundle` + `enforceBundleSizeLimit` 后 `Buffer.byteLength(JSON.stringify(bundle)) ≤ 256*1024`。

**验证命令**: 见 B-03。

**硬阈值**: `summary.length ≤ 2000` 且 `bundle 字节数 ≤ 262144`。

---

### Step 5: evaluator 消费侧——含 judge_feedback 时优先补齐点名证据
**来源**: `[FROM_PRD]` — PRD「范围限定·在范围内」第 2 条 + Golden Path 第 3 条 + 验收第 4 条。

**可观测行为**: `packages/workflows/skills/harness-evaluator/SKILL.md` 新增消费侧指引：TaskBundle 含 `judge_feedback` 时，本轮**优先补齐 judge 点名的缺失证据**，而非重复上轮同一套证据（snapshot 按流程 sync）。

**验证命令**: 见 A-02（SKILL.md 含 `judge_feedback` 与「优先补齐」指引字符串）。

**硬阈值**: SKILL.md 同时含 `judge_feedback` 与「优先补齐」「点名」关键指引。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api：vitest + node 断言）

> **本 sprint 无 HTTP 端点 / 无 DB / 无真机**：被改对象是 `orchestrator/dispatcher.js` 的纯内存 bundle 组装函数（`buildInputs`），验收 oracle 是 vitest 单测直调 `__test__.buildInputs`/`buildBundle`/`enforceBundleSizeLimit`。这是 PRD Invariant [命令实跑] 明确认可的 oracle 形态。
> **exit code 语义已实测**：新测试文件落 `packages/brain/src/orchestrator/__tests__/`，命中 brain vitest.config.js `include: src/**` 且不在 exclude 列表 → brain-unit CI 直跑，无需 Postgres；从 `packages/brain` cwd 运行时路径在 include 内，不触发「include 范围外绿态 exit 1」误判。

```bash
#!/bin/bash
set -euo pipefail

REPO_ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$REPO_ROOT/packages/brain"

TESTFILE="src/orchestrator/__tests__/dispatcher-judge-feedback.test.js"

# 1. 断言新测试文件存在（generator 必须保留 proposer 写的 TDD 测试进 CI）
test -f "$TESTFILE" || { echo "FAIL: 缺失回归测试文件 $TESTFILE"; exit 1; }

# 2. 主验收：judge_feedback 注入 + 边界 + 256KB 截断全部单测绿（真实调用 buildInputs/buildBundle）
NODE_OPTIONS="--max-old-space-size=3072" npx vitest run "$TESTFILE" --reporter=basic 2>&1 | tee /tmp/jf-e2e.log
grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/jf-e2e.log || { echo "FAIL: judge_feedback 测试未全绿"; exit 1; }
grep -qE "[0-9]+ failed" /tmp/jf-e2e.log && { echo "FAIL: 存在失败用例"; exit 1; }

# 3. evaluator skill 消费侧指引已落 SSOT
node -e "const c=require('fs').readFileSync('$REPO_ROOT/packages/workflows/skills/harness-evaluator/SKILL.md','utf8'); if(!c.includes('judge_feedback')) process.exit(1); if(!c.includes('优先补齐')) process.exit(1);" \
  || { echo "FAIL: evaluator SKILL.md 缺 judge_feedback 消费指引"; exit 1; }

# 4. 回归护栏：既有 dispatcher 单测不被本改动打破
NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=basic 2>&1 | tee /tmp/disp-e2e.log
grep -qE "[0-9]+ failed" /tmp/disp-e2e.log && { echo "FAIL: dispatcher 既有单测被打破"; exit 1; }
grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/disp-e2e.log || { echo "FAIL: dispatcher 既有单测未跑绿"; exit 1; }

echo "✅ judge_feedback 反馈闭环 E2E 验收通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `observed.judgeVerdict` 字段残缺（有 verdict='FAIL' 但 `feedback` 为空/非字符串、`failure_class` 缺失）→ 断言不因此抛错阻断派发（应 fail-safe 不注入或注入 failure_class=null），验证 `buildInputs` 不抛异常。
- 重复提交: 同 run 连续多轮 judge FAIL → 每轮 `round` 递增且始终只注入最近一次 summary，验证不累加、不串轮。
- 中途中断: `observed.judgeVerdict` 存在但 `observed.decisionLog` 为空数组（数据不一致）→ round 取值应有兜底（≥1），不 NaN/undefined。
- 边界值: judge summary 恰好 2000 / 2001 字符 → 截断边界正确，不 off-by-one 撑破 256KB。
发现分级: P0/P1（bundle 超 256KB 阻断派发 / 未脱敏凭据泄漏进 bundle / 首轮误注入改变现状行为）→ 阻塞 merge；P2/P3（round 轮次标注偏差、提示文案措辞）→ 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| judge_feedback 注入 + 边界 + 截断 | `packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js` | 注入 judge_feedback 含 summary 与 failure_class / 不含 judge_feedback / 只注入最近一次 / 注入后被截断 | 实现前 3 failed（positive）+ 3 passed（negative guard），exit 1 |
