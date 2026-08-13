# Sprint Contract Draft (Round 1)

> 锚定父路声明：**独立小路（无父路）** — PrepPRD `step_id=none`，`journey_id=e6f803f2`，本 sprint 是 `packages/brain/src/orchestrator/` 纯后端调度逻辑修复，无 Golden Path 父路步骤锚定。
> Unified Map：`[MAP_NOT_CONFIGURED]` — 本 task `payload.map_scope` / `map_repo` 均为 null，无 `must_run_assertions` / `affected_business_nodes` 可注入，禁止回退领域硬编码。
> gp-anchor: skipped (product-map.json not found) — cecelia 仓无 `product-map/generated/product-map.json`。
> contract-gate: skipped 判定 — 本仓为 cecelia，`packages/brain/src/lib/contract-gate.js` 存在则原逻辑生效（非第三方 repo，无需跳过声明）。

## Response Schema（推导来源: PRD 明确 — 无 HTTP 响应，内部数据结构）

**N/A — 任务无 HTTP 响应。** 本 sprint 改动是 `dispatcher.js` 内部 `buildInputs` 组装 TaskBundle 的纯函数逻辑，不新增/修改任何 HTTP endpoint。

为对下游明确注入对象契约，声明**注入数据结构 shape**（非 HTTP，属 TaskBundle `inputs` 子对象）：

### 注入对象: `inputs.judge_feedback`（evaluator TaskBundle 专属，条件注入）

仅当「本 run `observed.decisionLog` 最近一次 `verdict:judge` 行的 `detail.verdict === 'FAIL'` 且 `detail.feedback` 非空」时出现；否则该键**完全不出现**（不注入 null / 空对象）。

```json
{
  "summary": "<string，来源 detail.feedback，经 sanitizeDiagnostic 脱敏+截断（≤2000 字符）>",
  "failure_class": "<string|null，来源 detail.failure_class（如 evidence_insufficient），缺失为 null>",
  "round": "<integer|null，来源该 judge verdict 行的 decisionLog hop（最近一次的轮次锚点）>"
}
```

- `summary` (string, 必填): 来源——PRD「上轮 judge summary（含点名的缺失证据清单）」；实现从 `verdict:judge` 行 `detail.feedback` 取，经 `sanitizeDiagnostic`（脱敏 + 折叠换行 + 截断 2000 字符）。
- `failure_class` (string|null, 必填): 来源——PRD「+ failure_class」；从 `detail.failure_class` 取；缺失显式为 `null`。
- `round` (integer|null, 必填): 来源——PRD「+ 轮次」；取该 judge verdict 行的 `hop`（本 run 内单调递增，确定性可比，禁 Date/时间戳）。

**禁用字段名**（不得出现在 `judge_feedback` 对象里）: `feedback`（用 `summary`，与 `buildEvaluatorFeedback` 家族命名一致，避免与 evaluator_feedback.checks 语义混淆）、`verdict`（judge_feedback 恒为 FAIL 语境，不重复携带）、`evaluator_failure_class`（那是 judge 侧派生字段，不进反馈）。

**Error / 不注入语义**: 无 judge verdict、最近 judge verdict 为 PASS、或 `detail.feedback` 为空 → `inputs` 对象**不含** `judge_feedback` 键（`Object.prototype.hasOwnProperty` 为 false）。

---

## Golden Path

覆盖父路：独立小路（无父路）。

[judge 判 FAIL 并点名缺失证据] → [fix loop 重新组装 evaluator TaskBundle] → [dispatcher 读最近 judge FAIL verdict 注入 judge_feedback] → [evaluator 拿到 judge_feedback 优先补齐点名证据]

### Step 1: fix loop 已存在 judge FAIL verdict，再次 spawn evaluator（触发条件）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步 + 「背景」（issue 47c4434d / run 8783807c）。

**可观测行为**: 同一 run 的 `orchestrator_decision_log` 已有一条 `action='verdict:judge'` 且 `detail.verdict='FAIL'`（如 `failure_class='evidence_insufficient'`）的记录；Kernel 再次派发 `spawn:evaluator`。

**验证命令**:
```bash
# buildInputs 的输入前提：observed.decisionLog 含一条 verdict:judge FAIL 行（单测直接构造，无需真 DB）
cd "$(git rev-parse --show-toplevel)/packages/brain"
node --input-type=module -e "import('./src/orchestrator/dispatcher.js').then(m=>{const i=m.__test__.buildInputs('spawn:evaluator',{role:'evaluator'},{observed:{task:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'t',payload:{sprint_dir:'sprints/x'}},decisionLog:[{hop:7,action:'verdict:judge',detail:{verdict:'FAIL',feedback:'缺失: e2e 截图',failure_class:'evidence_insufficient'}}]},taskId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',runId:'11111111-1111-4111-8111-111111111111',hop:9},{logicalCycleId:'lc',attemptKind:'initial',workstreamKey:'ws1'});if(!i.judge_feedback)process.exit(1);console.log('OK',JSON.stringify(i.judge_feedback));})"
# 期望：exit 0，打印含 summary/failure_class/round 的 judge_feedback
```

**硬阈值**: `inputs.judge_feedback` 存在且含 `summary`、`failure_class`、`round` 三键；耗时 < 10s。
**验证命令（阈值→可执行）**: 上述 node 命令 `process.exit(1)` on 缺键，`exit 0` on 齐全。

---

### Step 2: dispatcher 读最近 judge FAIL verdict 并注入 judge_feedback（系统处理）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步 + 「根因」（`buildInputs` 中 `spec.role==='evaluator'` 分支缺对等 `judge_feedback`，对照 `buildEvaluatorFeedback`）。

**可观测行为**: evaluator 分支新增 `buildJudgeFeedback(observed)`：从 `observed.decisionLog` 取**最近一次**（最大 hop）`verdict:judge` 行；`detail.verdict==='FAIL'` 且 `detail.feedback` 非空才返回 `{summary,failure_class,round}`，`summary`/`failure_class` 经 `sanitizeDiagnostic` 脱敏截断；非 FAIL / 无 verdict / 空 feedback 返回 null（不注入）。

**验证命令**:
```bash
# 多条 verdict:judge 时只取最近一次（最大 hop）；PASS 不注入；脱敏
cd "$(git rev-parse --show-toplevel)/packages/brain"
NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t 'judge_feedback' --reporter=dot
# 期望：judge_feedback 全部回归用例通过（exit 0）
```

**硬阈值**: 最近 judge 行为 FAIL 才注入；多条只取 max(hop)；`summary` 脱敏后不含 `Bearer`/明文密钥；注入后整包 `Buffer.byteLength(JSON.stringify(bundle)) ≤ 256*1024`。
**验证命令（阈值→可执行）**: 见 contract-dod.md B-02/B-03/B-04/B-05/B-06 各条 `manual:bash` 断言。

---

### Step 3: evaluator 消费侧优先补齐点名证据（可观测结果）

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步 +「范围内」evaluator skill SSOT 消费侧提示词。

**可观测行为**: `packages/workflows/skills/harness-evaluator/SKILL.md` 新增一节，规定 TaskBundle `inputs.judge_feedback` 存在时，evaluator 必须**优先补齐 judge 点名的缺失证据**（读 `summary` 里的缺失清单），不再盲交同一套证据；无该字段时保持现状（首轮不受影响）。snapshot 镜像按 skills sync 流程同步。

**验证命令**:
```bash
# skill SSOT 消费侧提示词落地（文本产物核查，归 ARTIFACT）
cd "$(git rev-parse --show-toplevel)"
grep -q 'judge_feedback' packages/workflows/skills/harness-evaluator/SKILL.md && grep -Eq '优先补齐|点名' packages/workflows/skills/harness-evaluator/SKILL.md
# 期望：exit 0
```

**硬阈值**: SKILL.md 含 `judge_feedback` 消费段且含「优先补齐点名证据」语义。
**验证命令（阈值→可执行）**: 见 contract-dod.md `[ARTIFACT]` 条目。

---

## 已知约束（来自回归测试）

- [dispatcher.test.js] → `generator-fix 只接收与当前 PR SHA 和 Attempt 绑定的安全 Evaluator 反馈`（`evaluator_feedback` 注入的对照实现，本次 `judge_feedback` 与其并列，不得改动 evaluator_feedback 路径）
- [dispatcher.test.js] → `generator-fix 不接收 <stale PR SHA / non-FAIL verdict / mismatched Attempt> 的 Evaluator 反馈`（不注入语义参照）
- [dispatcher.test.js] → `批准合同后不重复装载入口 PRD，Evaluator 大合同仍可派发`（256KB 传输闸既有约束，`judge_feedback` 注入不得撑爆）
- [累积FR] （本 line 暂无历史 — PRD「累积 FR」段声明本 line 无已验收行为，无需防回退）
- context-manifest: unavailable（journey 累积 FR 端点未在本地校验，PRD 已声明本 line 无历史，不阻塞）

## Invariant 覆盖（PRD 铁律逐条映射，见 contract-dod.md INV 条目）

- INV-1 [证据补齐优先]：judge FAIL `evidence_insufficient` 优先走 evaluator 补证据 —— 本改动正是把 `failure_class` 随 `judge_feedback` 注入，使 evaluator 能识别「补证据」而非重跑；DoD 有对应 [BEHAVIOR]。
- INV-2 [证据消费窗口]：judge 消费窗口 前 8 条 × 600 字符 —— **N/A**：本 sprint 不改 evaluator 产 `.brain-result.json` 的证据排布，也不改 judge 消费窗口；`judge_feedback` 是**注入给 evaluator 的输入**，与 judge 读证据窗口无耦合。DoD 记 N/A 行。
- INV-3 [local_api 免死锁]：judge 机械闸⑤（meta_verification_gap）对 local_api / 无 UI smoke 死锁 —— 合同层规避：本 sprint 验收全部走 vitest 逻辑单测（`buildInputs` 纯函数），**不要求任何 UI smoke / meta_verification 产物**，target_environment=local_api 但无死锁面。DoD 记 INV-3 合同层规避说明。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | fix loop / rerun 场景下，`dispatcher.buildInputs(role=evaluator)` 从本 run 最近一次 `verdict:judge` FAIL 裁决注入 `inputs.judge_feedback = {summary, failure_class, round}`；无 judge FAIL verdict 时不注入。 |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | 注入后 TaskBundle 整包 ≤ 256KB（`HARNESS_BUNDLE_MAX_BYTES`）；`summary`/`failure_class` 经 `sanitizeDiagnostic` 脱敏 + 截断 2000 字符；纯同步逻辑，无额外 I/O。 |
| **Invariant（永不违反）** | 不变量 | ①无 judge verdict / PASS / 空 feedback 时绝不出现 `judge_feedback` 键；②只注入最近一次（不做历史累积/合并）；③不改动既有 `evaluator_feedback` 路径与 judge 判决逻辑。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表（「哪条 judge verdict 算最近一次」「什么算 FAIL」）。 |
| **保质期（何时过期）** | 何时失效 | `judge_feedback` 仅在单次 evaluator attempt 生命周期内有效，随 TaskBundle 传递，不落库、不跨 run。 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | 若注入逻辑回归失效，`dispatcher.test.js` 的 `judge_feedback` 回归用例在 brain-unit CI 变红即告警（PR 阻塞）。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截 | 见下方失败语义表：`detail` 解析异常/字段缺失时**降级为不注入**（保持现状，绝不抛错阻断派发）。 |
| **效果确认（已发≠已生效）** | 回执确认 | 单测断言 `inputs.judge_feedback` 键存在/不存在 + 字段值 + 整包字节数；evaluator 消费侧由 SKILL.md 提示词 + 后续真实 fix loop run 验证（本 sprint 只交付注入侧与提示词）。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 哪条 judge verdict 算「最近一次」 | A. decisionLog 最大 hop; B. 数组末元素; C. created_at 时间戳 | A. 最大 hop | hop 本 run 内单调递增、确定性可比，禁 Date/时间戳（对齐 derive.js latestVerdictHop 约定） | 取错轮次 → 注入过期反馈，误导 evaluator 补错证据 |
| 什么算 judge「FAIL 裁决」 | A. detail.verdict==='FAIL'; B. gate_verdict 前缀 deny | A. detail.verdict==='FAIL' | kernel-handlers.appendJudgeVerdict 写入 detail.verdict∈{PASS,FAIL}，是权威字段 | 把 PASS 当 FAIL 注入 → 首轮/已通过场景多塞无意义反馈 |

> 本任务判定点均为**内部确定性数据判断**（读 decisionLog 结构化字段），非真机/真实世界接缝，无 ⚠️ 升级项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| `observed.decisionLog` 缺失/非数组 | 视为无 judge verdict | 是（纯函数，同输入同输出） | 不注入 `judge_feedback`，保持现状派发 |
| judge 行 `detail` 为字符串/解析失败 | `asObject` 兜底为 `{}` → verdict≠FAIL | 是 | 不注入 |
| `detail.feedback` 为空/非字符串 | 无可注入 summary | 是 | 不注入（不塞空 summary） |
| `summary` 超长 | `sanitizeDiagnostic` 截断至 2000 字符 | 是 | 截断后注入，整包 ≤ 256KB |

### 输入对抗面（对外暴露 agent 必填）

**N/A** — 本改动是 Brain 内部调度逻辑（`buildInputs` 纯函数），输入来自本 run 自己写入的 `decisionLog`（Kernel 可信写入路径），无对外暴露 agent 输入面，无 prompt injection / 越权指令面。

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（judge verdict → evaluator TaskBundle.inputs），故必须列禁 mock 边：

- `dispatcher.buildInputs` ↔ `observed.decisionLog`（本单新增从 decisionLog 读 `verdict:judge` FAIL 行注入 judge_feedback 的数据接力）：测试必须调用**真实** `buildInputs`（经 `__test__.buildInputs` 或真实 `createDispatcher`），并以**真实 decisionLog 行结构**作输入，**禁止** `vi.mock`/stub 掉 `buildInputs`、`buildJudgeFeedback` 或 `sanitizeDiagnostic`。
- 说明：`buildInputs` 是纯函数，`observed` 是其合法入参（与既有 `evaluator_feedback` 测试同一构造方式——直接传 `evaluateVerdict`/`decisionLog` 数据，非 mock 模块），故本单**无需真 Postgres**（`runtime_resources.postgres=false` 一致），也不触及 DB 写路径。

## 未覆盖真实链路清单

**（本合同无 mock 豁免，N/A）** — DoD 无 `force_*`/stub/假数据；无第三方 API 调用；无真实调用方 shape 依赖（改动不涉及设备/agent 调服务端）。

## 真实调用方请求 shape

**N/A** — 本改动不涉及「设备/agent 调服务端」，`judge_feedback` 的数据源是本 run 内部 `decisionLog`（Kernel 自身写入），非外部调用方请求。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint **无 DB 依赖**（`runtime_resources.postgres=false`）：验证对象是 `dispatcher.buildInputs` 纯函数逻辑，单测直接构造 `observed.decisionLog`，不连真 Postgres、不启 Brain HTTP、无 signup/login 自举需求。故不声明 `DB_URL`。final-e2e 即运行 brain-unit 中 `judge_feedback` 回归单测（真实执行 `buildInputs`）。

```bash
#!/bin/bash
set -euo pipefail
# final-e2e: judge_feedback 注入回归单测（本地执行，无 DB/无浏览器）
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/packages/brain"
export NODE_OPTIONS="--max-old-space-size=3072"

# 跑 dispatcher 回归单测中全部 judge_feedback 用例（generator 实现后应全绿；实现前红）
npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t 'judge_feedback' --reporter=verbose

echo "OK: judge_feedback 注入回归单测全绿（buildInputs 真实执行，无 mock 被改的边）"
```

**通过标准**: 脚本 exit 0（vitest 全部 `judge_feedback` 匹配用例通过；无匹配用例时 vitest 默认 `passWithNoTests=false` 报错，防假绿）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯逻辑改动，风险面小）
高风险面:
- 错输入: `observed.decisionLog` 传 `null` / 非数组 / 行 `detail` 为字符串 `"{...}"` → 断言不抛错且不注入 `judge_feedback`。
- 重复提交: 同 run 多条 `verdict:judge`（含 FAIL 后又 PASS，或 PASS 后又 FAIL）→ 断言只取最大 hop 那条，且 PASS 时不注入。
- 中途中断: `detail.failure_class` 缺失但 `detail.verdict='FAIL'` + 有 feedback → 断言注入且 `failure_class:null`（不因缺 failure_class 而整体不注入）。
- 边界值: `summary` 恰好 2000 字符 / 超长 200KB → 断言截断至 ≤2000 且整包 `Buffer.byteLength(JSON.stringify(bundle)) ≤ 256*1024`；空字符串 feedback → 不注入。
发现分级: P0/P1（注入错轮次反馈 / 撑爆 256KB 传输闸 / 误改 evaluator_feedback 路径）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| judge_feedback 注入（正） | `src/orchestrator/__tests__/dispatcher.test.js` | `存在 judge FAIL verdict 时注入` | → FAIL（判 `inputs.judge_feedback` undefined） |
| 无 judge verdict 不注入 | 同上 | `无 judge verdict 时不注入该字段` | → 现状已过（防回归） |
| PASS 不注入 | 同上 | `最近 judge verdict 为 PASS 时不注入` | → FAIL 前需实现 gate |
| 只取最近一次 | 同上 | `多条 judge verdict 只取最近一次` | → FAIL |
| 256KB 截断 | 同上 | `超长 summary 截断后整包不超 256KB` | → FAIL |
| 脱敏 | 同上 | `summary 注入前脱敏` | → FAIL |

> 「BEHAVIOR 覆盖」列每个名均为 `dispatcher.test.js` 对应 `it()` 名的字面子串（generator 建同名 it）；本 sprint 同名规格已写入 `${SPRINT_DIR}/tests/dispatcher-judge-feedback.test.mjs`（TDD 红证据 + generator 倒入 __tests__ 的样板）。
