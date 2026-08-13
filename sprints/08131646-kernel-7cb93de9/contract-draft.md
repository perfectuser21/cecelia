# Sprint Contract Draft (Round 1)

**Sprint**: fix(harness): fix loop 反馈断链——judge FAIL 裁决注入下轮 evaluator TaskBundle
**journey_type**: autonomous
**target_environment**: local_api（Brain 内部纯装配逻辑单测；无 HTTP 端点、无 DB 写路径触点）
**contract-gate**: applies (cecelia 仓，`packages/brain/src/lib/contract-gate.js` 存在) — 代码层确定性 Contract Gate 生效，本合同断言按其惯用法写作（vitest 单测 oracle + 文件内容 grep，无弱 oracle/or-true/无时间窗 DB 探测）
**gp-anchor**: skipped (product-map.json not found) — cecelia 仓无 `product-map/generated/product-map.json`

## 锚定父路声明

独立小路（无父路）—— PrepPRD 未锚定 golden_path（`step_id: none`）。本 sprint 修复 fix loop 内部反馈装配，不覆盖某条已存在 Golden Path 的对外步骤。

---

## Response Schema（推导来源: PRD字面 + 现有 dispatcher.js 装配惯例）

本 sprint **无 HTTP 响应变更**。改动的对外契约是 evaluator `TaskBundle.inputs` 新增结构化字段 `judge_feedback`（内部装配对象，单测即为 oracle）。字段命名与形状对齐既有先例 `evaluator_feedback`（dispatcher.js:172-179，generator-fix 分支）与 `human_context`（dispatcher.js:303，有值才注入纪律）。

### 结构: `buildInputs(action, spec, ctx)` 当 `spec.role === 'evaluator'` 且本 run 存在 judge FAIL verdict 时，产出的 `inputs.judge_feedback`

```json
{
  "hop": 5,
  "verdict": "FAIL",
  "failure_class": "evidence_insufficient",
  "summary": "缺少失败路径直接执行的 stdout 与退出码"
}
```

- `hop` (number, 必填): 该 judge 裁决在 `orchestrator_decision_log` 的 hop（= PRD「轮次」）。来源——最近一次 `verdict:judge` FAIL 行的 `row.hop`。
- `verdict` (string, 必填): 字面量 `"FAIL"`（只在 judge FAIL 时注入，字面固定）。来源——PRD Golden Path 步骤 2。
- `failure_class` (string|null, 必填): judge 失败分类（如 `evidence_insufficient` / `product_failure`）。来源——judge 裁决 `detail.failure_class`（kernel-handlers.js:60 写入形状，可为 null）。
- `summary` (string|null, 必填): judge 点名的缺失证据清单/反馈正文，经 `sanitizeDiagnostic` 脱敏+截断（≤2000 字符）。来源——judge 裁决 `detail.feedback`（kernel-handlers.js:59 写入的字段名即 `feedback`；PRD 口径「judge summary」= 此 `feedback` 正文）。

**禁用字段名**（不得作为正向断言 key）: `evaluator_feedback`（那是 generator-fix 侧已存在的对称字段，不动）、`judge_verdict`、`review_feedback`。

**不注入条件**（对齐 `human_context`/`thin_prd` 有值才注入纪律）:
- 本 run 无任何 `verdict:judge` 行 → `inputs` 不含 `judge_feedback` key（首轮 evaluator）。
- 最近的 judge 行 `detail.verdict !== 'FAIL'`（如 PASS）→ 不注入。

**Ground-truth 字段核对（Step 1.1 已核）**:
- judge 裁决写入形状（`packages/brain/src/orchestrator/kernel-handlers.js:56-62`）:
  `{ verdict, pr_head_sha, feedback, failure_class, failure_signature?, evaluator_failure_class }`
- 从 `observed.decisionLog` 取最近一次的既有模式（`dispatcher.js:293-295` `latestContextAnswer`）:
  `[...(observed.decisionLog ?? [])].sort((a,b)=>Number(b.hop)-Number(a.hop)).find(row => row.action === '...')`
- 脱敏+截断工具 `sanitizeDiagnostic`（`failure-persistence.js:37-40`）内置 `MAX_DIAGNOSTIC_LENGTH = 2000` 字符上限，与 `evaluator_feedback.summary` 复用同一收窄函数——是 256KB 闸的截断执行体。
- 传输闸常量 `HARNESS_BUNDLE_MAX_BYTES = 256 * 1024`（`orchestrator/constants.js:125`）。

---

## Golden Path

覆盖父路：独立小路（无父路）。

[judge 判 FAIL 点名缺失证据] → [fix loop 重派 evaluator，dispatcher `buildInputs` 读本 run 最近 judge FAIL 裁决并注入 `judge_feedback`] → [evaluator TaskBundle 携带点名缺失证据 + failure_class + 轮次] → [evaluator skill 消费侧优先补齐点名证据]

### Step 1: 同 run 已存在 judge FAIL verdict，fix loop 触发重派 evaluator
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1（第 20 行）

**可观测行为**: `observed.decisionLog` 含至少一条 `{action:'verdict:judge', detail:{verdict:'FAIL', failure_class, feedback}}`；dispatch `spawn:evaluator` 时进入 `buildInputs` role=evaluator 分支。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "run 存在 judge FAIL verdict 时注入"
# 期望：exit 0（该子测试 PASS）
```

**硬阈值**: 该子测试 PASS（exit 0）。

---

### Step 2: dispatcher 注入 `inputs.judge_feedback`（读最近 judge FAIL + 脱敏 + 截断）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 2（第 21 行）+ 边界情况「只注入最近一次」（第 29 行）

**可观测行为**: `bundle.inputs.judge_feedback` 精确等于 `{hop, verdict:'FAIL', failure_class, summary}`；同 run 多条 FAIL 时取 `hop` 最大的一条。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "只注入 hop 最大的最近一次"
# 期望：exit 0
```

**硬阈值**: `judge_feedback.hop` == 最大 hop 行；`summary`/`failure_class` 取自该行。

---

### Step 3: 首轮 evaluator（无 judge verdict）不注入 `judge_feedback`
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 4（第 23 行）+ 边界情况「PASS 或不存在 → 不注入」（第 31 行）

**可观测行为**: `observed.decisionLog` 无 `verdict:judge` FAIL 行时，`bundle.inputs` 不含 `judge_feedback` key（用 `not.toHaveProperty`，非空对象/非 null 判定）。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "不注入 judge_feedback 字段"
# 期望：exit 0
```

**硬阈值**: `inputs` 无 `judge_feedback` 属性。

---

### Step 4: 超长 judge summary 截断后 bundle 不越 256KB 传输闸
**来源**: `[FROM_PRD]` — PRD 边界情况「judge summary 超长 → 截断，保证不越 256KB」（第 30 行）+ NFR「TaskBundle ≤ 256KB」（第 60 行）

**可观测行为**: 构造 500,000 字符的 judge feedback，注入后 `judge_feedback.summary.length ≤ 2000`，且整条 `JSON.stringify(bundle)` 字节数 < 262144。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t "超长 judge summary 截断后 bundle 不越 256KB"
# 期望：exit 0
```

**硬阈值**: `summary.length ≤ 2000` 且 `Buffer.byteLength(JSON.stringify(bundle),'utf8') < 256*1024`。

---

### Step 5: evaluator skill 消费侧优先补齐点名证据
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 3（第 22 行）+ 范围内第 3 条（第 39 行）

**可观测行为**: evaluator skill 快照 `packages/workflows/skills/harness-evaluator/SKILL.md` 新增消费段，指导「TaskBundle 含 `inputs.judge_feedback` 时优先补齐 judge 点名的缺失证据，而非盲重跑同一套证据」。

**验证命令**:
```bash
grep -q 'judge_feedback' packages/workflows/skills/harness-evaluator/SKILL.md \
  && grep -qE '优先补齐|点名.*证据' packages/workflows/skills/harness-evaluator/SKILL.md \
  || { echo "FAIL: evaluator SKILL 快照缺 judge_feedback 消费段"; exit 1; }
# 期望：exit 0
```

**硬阈值**: SKILL.md 含 `judge_feedback` 且含「优先补齐点名证据」语义指令。

---

## 已知约束

### 来自回归测试（Step 1.2）
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → `generator-fix 只接收与当前 PR SHA 和 Attempt 绑定的安全 Evaluator 反馈`（`evaluator_feedback` 注入的对称先例，本 sprint 的 `judge_feedback` 与之并列、不替换）
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → `human_context`/`context_answer` 注入用例（`latestContextAnswer` 取最近一条的取数模式，本 sprint 复用同款排序取数）
- `packages/brain/src/orchestrator/__tests__/derive.test.js` → `verdict:judge` decisionLog 行形状用例（`detail:{verdict, pr_head_sha, failure_class, feedback}`，确认 ground-truth 字段名）
- `packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js` → judge 裁决写 `orchestrator_decision_log` 用例（确认 `feedback`/`failure_class` 落库路径）

### 累积 FR（Step 1.3，来源 `[累积FR]`）
- context-manifest: unavailable（本 run 无 running Brain，`GET /line/<journey_id>/context-manifest` 不可达；PRD 第 76 行明示「本 line 暂无历史」，无累积 FR 约束）

### Unified Map（Step 1.0）
- `[MAP_NOT_CONFIGURED]` — 本 task payload 无 `map_scope`/`map_repo`，无 `must_run_assertions`/`fact_revisions`；不回退领域硬编码。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `buildInputs` role=evaluator 分支：本 run 存在 judge FAIL verdict 时，从 `observed.decisionLog` 取最近一次，脱敏截断后注入 `inputs.judge_feedback`（含 summary/failure_class/hop）；无则不注入 |
| **NFR（做得多好）** | 非功能 | 注入后整条 TaskBundle ≤ 256KB（`HARNESS_BUNDLE_MAX_BYTES`）；summary 经 `sanitizeDiagnostic` 截断至 ≤2000 字符 |
| **Invariant（永不违反）** | 不变量 | (1) judge PASS/无 judge → 绝不注入 `judge_feedback`（有值才注入）；(2) 只注入最近一次（hop 最大）；(3) 不改动 generator-fix 侧 `evaluator_feedback`；(4) summary 必经脱敏（不泄露 Bearer/密钥） |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | `judge_feedback` 仅在单次 dispatch 组装时快照，随 TaskBundle 生命周期，无独立 TTL |
| **死亡告警（停了谁知道）** | 告警 | 注入逻辑回归即 CI 红（`dispatcher-judge-feedback.test.js` 常驻 brain-ci.yml）；无运行时告警需求（纯装配路径） |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明表 |
| **效果确认（已发≠已生效）** | 回执 | 单测即 oracle：`bundle.inputs.judge_feedback` 直接可观察（PRD NFR 第 63 行） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 哪条 decisionLog 行是「本 run 最近一次 judge FAIL」 | A. 按 `hop` 降序 find 首个 `verdict:judge` 且 `detail.verdict==='FAIL'`；B. 按数组末位 | A（`hop` 降序 find） | 与既有 `latestContextAnswer`（dispatcher.js:293）同款语义，数组顺序不保证 | 取错轮次 → 注入过时反馈，evaluator 补错证据 |
| judge summary 正文字段名是 `feedback` 还是 `summary` | A. `detail.feedback`；B. `detail.summary` | A（`detail.feedback`） | kernel-handlers.js:59 写入的字段名即 `feedback`；`derive.test.js:319` 佐证 | 取错字段 → summary 恒为 undefined，注入空反馈 |

> 本任务无真机/RPA/外部状态推断接缝判定点（纯内存装配），上表两条均为「装配取数」判定，无 ⚠️ 级面客风险。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `observed.decisionLog` 缺失/非数组 | `?? []` 兜底为空数组，视作无 judge verdict，不注入 | 是（纯读，无副作用） | 不注入 = 退回现状（首轮语义），不阻断 dispatch |
| judge FAIL 但 `detail.feedback` 为 null | summary 置 null，仍注入（failure_class+hop 有值即有意义） | 是 | 消费侧按 failure_class 区分 |
| 注入后仍越 256KB（理论极端） | 交由既有 `enforceBundleSizeLimit`（dispatcher.js:528）按 round 丢 case_file feedback_md 兜底 | 是 | 复用既有膨胀闸，本 sprint 不新增 |

### 输入对抗面

N/A —— 本改动不引入对外暴露 agent 输入面；`judge_feedback` 数据源是本 run 自己的 decisionLog（Brain 内部可信数据），非外部用户可写入。summary 仍经 `sanitizeDiagnostic` 脱敏（Bearer/密钥赋值 → [REDACTED]），防上游 judge 反馈误带凭据泄露给下游 evaluator。

---

## Invariant 覆盖（历史铁律 → DoD 映射）

- `[judge-fail-triage]` → **覆盖**：`judge_feedback.failure_class` 原样携带（含 `evidence_insufficient` vs `product_failure`），使 evaluator 消费侧能区分「证据压缩窗口截断」与「实现缺陷」。见 B-05。
- `[judge-evidence-window]`（前 8 条 × 600 字符）→ **N/A**：本 sprint 不触及 judge/evaluator 证据消费窗口（PRD 范围外，第 43 行明示不改）。
- `[evaluator-tmp-isolation]` → **N/A**：本 sprint 不写临时脚本、不改 evaluator 运行时路径，仅改 dispatcher 装配。
- `[validation-clock]` → **N/A**：本 sprint 不触及 validation clock（PRD 范围外，第 44 行）。

---

## 真实调用方请求 shape

N/A —— 本改动无「设备/agent 调服务端」真实调用方；`buildInputs` 是 Brain 进程内纯函数，输入来自本 run 已落库的 `observed.decisionLog`。

## 第三方真调

N/A —— 本改动不依赖任何第三方 API（LLM/支付/短信/平台）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— failing test 用真实构造的 `decisionLog` 数组喂真实 `createDispatcher`/`buildInputs`（被改的边真跑）；仅 mock `attemptStore`/`launcher`/`registry` 等**更外层无关 IO 依赖**（与既有 dispatcher.test.js 同款 `makeDeps`），这些不是本单改动触碰的边。

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（`observed.decisionLog` 数据 → `buildInputs` 装配 → `TaskBundle.inputs.judge_feedback`），故：

- `observed.decisionLog`（数据）↔ `buildInputs`（装配逻辑）：测试必须用真实构造的 decisionLog 数组喂真实 `buildInputs`（经 `createDispatcher('spawn:evaluator')` 真实进入该分支），**禁止 mock/stub `buildInputs` 或 dispatcher 内部装配**。
- `buildInputs` ↔ `sanitizeDiagnostic`（截断执行体）：测试必须让真实 `sanitizeDiagnostic` 参与截断（断言 summary ≤2000），**禁止 mock 掉截断函数**。

允许 mock 的更外层无关依赖：`attemptStore`（attempt 持久化）、`launcher`（容器启动）、`registry`（adapter 解析）——这些是 dispatch IO 边界，非本单改动的边。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> **说明**：本 sprint 改动落在 `packages/brain/src/orchestrator/dispatcher.js` 的纯装配函数 `buildInputs`，**无 HTTP 端点新增、无 DB 写路径**（`buildInputs` 只读内存 `observed.decisionLog`）。故 local_api 标准模板的「migration + signup/login + curl 触发 + psql 时间窗」不适用——本改动的 Golden Path oracle 是 dispatcher 装配单测（PRD E2E 段第 83 行明示「vitest 单测 + 必要时 psql」，本单无 DB 触点故不需 psql）。runtime_resources.postgres=false 与此一致。E2E 脚本 = 对 PR 分支跑常驻回归测试文件，断言全 6 条子测试 PASS。

```bash
#!/bin/bash
set -euo pipefail

# Golden Path 端到端：judge FAIL 裁决注入下轮 evaluator TaskBundle 的完整装配验证。
# 前置：PR 分支已含实现（dispatcher.js buildJudgeFeedback + 注入）与常驻回归测试。
cd "$(git rev-parse --show-toplevel)/packages/brain"

# 依赖就绪（node_deps 由 Fleet 注入 npm ci；缺失则显式装，不吞错）
[ -x node_modules/.bin/vitest ] || npm ci >/tmp/e2e-npmci.log 2>&1

TEST_FILE="src/orchestrator/__tests__/dispatcher-judge-feedback.test.js"
[ -f "$TEST_FILE" ] || { echo "FAIL: 常驻回归测试缺失 $TEST_FILE（generator 必须入库到 brain-ci 路径）"; exit 1; }

# 跑全部 6 条子测试，落文件后断言 6 passed 0 failed（grep 对被测系统真实输出文件，非自 echo）
npx vitest run "$TEST_FILE" 2>&1 | tee /tmp/e2e-vitest.log | tail -20
grep -qE 'Tests[[:space:]]+6 passed \(6\)' /tmp/e2e-vitest.log || { echo "FAIL: 期望 6 passed (6)"; exit 1; }
if grep -qE '[0-9]+ failed' /tmp/e2e-vitest.log; then echo "FAIL: 存在失败子测试"; exit 1; fi

# 消费侧 SKILL 快照同步验证
cd "$(git rev-parse --show-toplevel)"
grep -q 'judge_feedback' packages/workflows/skills/harness-evaluator/SKILL.md \
  || { echo "FAIL: evaluator SKILL 快照缺 judge_feedback 消费段"; exit 1; }

echo "✅ Golden Path 验证通过：judge FAIL 裁决注入 evaluator TaskBundle + 消费侧同步"
```

**通过标准**: 脚本 exit 0（6 条子测试全 PASS + SKILL 快照含消费段）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯装配逻辑，风险面窄）
高风险面:
- 错输入: `observed.decisionLog` 传入含非法 hop（字符串 `"abc"` / null / 缺 `detail`）的 judge 行 → `Number(hop)` NaN 排序是否崩溃 / 是否误注入
- 重复提交: 同 run 存在两条 hop 相同的 judge FAIL 行 → find 取首个是否稳定，不抛异常
- 中途中断: judge 行 `detail` 为 JSON 字符串而非对象（`asObject` 兜底）→ 是否仍正确取 feedback/failure_class
- 边界值: `detail.feedback` 为空字符串 `""` / 恰好 2000 字符 / 2001 字符 → 截断边界；`failure_class` 缺失键 → 注入 null 不抛
发现分级: P0/P1（注入错轮次/泄露密钥/dispatch 崩溃）→ 阻塞 merge；P2/P3（边界值文案）→ 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| judge_feedback 注入两态 + 截断 | `packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js`（常驻 CI；GAN 冻结原文见 `${SPRINT_DIR}/tests/dispatcher-judge-feedback.test.js`） | `run 存在 judge FAIL verdict 时注入`；`只注入 hop 最大的最近一次`；`failure_class 非 evidence 类仍注入`；`不注入 judge_feedback 字段`；`judge 判 PASS 时不注入`；`超长 judge summary 截断后 bundle 不越 256KB` | 当前代码 4 failed \| 2 passed（注入相关 4 条 `judge_feedback undefined` 红；无 judge/PASS 两条守卫绿）|

> 「BEHAVIOR 覆盖」列每个名均为对应 `it()` 名的字面子串（可 `grep -F` 命中）。红证据实测：`cd packages/brain && npx vitest run <file>` → `Tests 4 failed | 2 passed (6)`。
