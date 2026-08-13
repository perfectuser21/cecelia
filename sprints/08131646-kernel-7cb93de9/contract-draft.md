# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 编排层 — vitest 单测 + node 字节体检；本 sprint 无 DB / 无 localhost:5221 依赖，runtime_resources.postgres=false）

## 锚定父路声明

独立小路（无父路）。PrepPRD 未锚定 golden_path/step（`step_id: none`，`task.ability_id` 为空），本 sprint 是修 harness 编排层 fix-loop 反馈断链的独立改动。

## Response Schema（推导来源: PRD 字面 / N/A HTTP）

N/A — 任务无 HTTP 响应。本 sprint 改的是 Brain 编排层纯函数 `buildInputs` 的产物结构（TaskBundle.inputs 的一个新字段），不是 HTTP 端点。产物结构契约见下方「judge_feedback 结构契约」。

### judge_feedback 结构契约（TaskBundle.inputs.judge_feedback）

数据源（已就绪，本 sprint 不改）：`ground-truth.js` 已把本 run decisionLog 最近一条 `verdict:judge` 行以 `asJson(row.detail)` 暴露为 `observed.judgeVerdict`，shape：
```js
{ verdict: 'PASS'|'FAIL', pr_head_sha, feedback: <judge 摘要正文/点名缺失证据>, failure_class: <string|null>, ... }
```
（`feedback` 即 judge 裁决摘要，见 kernel-handlers.js `appendJudgeVerdict` 写入 + attempt.summary 同源 `result.feedback`。）

`buildInputs(role=evaluator)` 注入条件与产物：
- **注入条件**：`spec.role === 'evaluator'` 且 `observed.judgeVerdict?.verdict === 'FAIL'`。其余情况（无 judge verdict / 最近为 PASS / 非 evaluator 角色）**字段缺席**（不是空对象）。
- **产物**：
```js
inputs.judge_feedback = {
  summary: <string>,        // = sanitizeDiagnostic(observed.judgeVerdict.feedback)：脱敏(redactSecrets)+折行+截断到 MAX_DIAGNOSTIC_LENGTH(2000 字符)
  failure_class: <string|null>,  // = observed.judgeVerdict.failure_class ?? null
  round: <number>,          // = observed.decisionLog 中 action==='verdict:judge' 且 detail.verdict==='FAIL' 的行数（含本次），即本 run 第几轮 judge FAIL
}
```
- **截断上限锁定**：复用现有 `sanitizeDiagnostic`（`packages/brain/src/orchestrator/failure-persistence.js`，`MAX_DIAGNOSTIC_LENGTH = 2000` 字符），无需新增常量（PRD ASSUMPTION「截断上限由 proposer 锁定」→ 锁定为 2000 字符 / sanitizeDiagnostic）。2KB « 256KB，天然满足传输闸。
- **只注入最近一次**：不堆叠历轮，避免 bundle 膨胀（PRD 边界情况）。

**禁用字段名**：无（非 HTTP，无同义替换风险）。

---

## Golden Path

[同 run 已存在 judge FAIL 裁决] → [dispatcher buildInputs 组装下轮 evaluator bundle 注入 judge_feedback] → [evaluator skill 收到点名缺失证据并优先补齐]

### Step 1: 同 run 已产生 judge FAIL 裁决，fix loop 重新 spawn evaluator
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步 + 背景（issue 47c4434d / run 8783807c）

**可观测行为**: 本 harness run 的 decisionLog 最近一条 `verdict:judge` 的 detail `verdict==='FAIL'`（`failure_class='evidence_insufficient'`，`feedback` 点名缺失证据），ground-truth 将其暴露为 `observed.judgeVerdict`。

**验证命令**:
```bash
# 该步是既有数据前提（ground-truth 已暴露 observed.judgeVerdict），单测直接构造该 observed 断言下游消费
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js -t '同 run 存在 judge FAIL 时注入 judge_feedback 含 summary 与 failure_class'
```
**硬阈值**: 该单测退出码 0（下游确有消费 observed.judgeVerdict）。

---

### Step 2: dispatcher buildInputs(evaluator) 注入 judge_feedback（脱敏 + 截断）
**来源**: `[FROM_PRD]` — PRD 范围内第 1 条 + 预期受影响文件 `dispatcher.js buildInputs evaluator 分支`

**可观测行为**: `buildInputs('spawn:evaluator', ...)` 产出的 `inputs.judge_feedback` 含 `summary`（脱敏截断）、`failure_class`、`round`；无 judge verdict / PASS 时字段缺席；超长 summary 截断后整包 ≤256KB。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js
```
**硬阈值**: 4 条用例全 PASS（注入含字段 / 无 verdict 不注入 / PASS 不注入 / 超长截断 ≤256KB）。

---

### Step 3: evaluator skill 消费侧提示词优先补齐点名缺失证据
**来源**: `[FROM_PRD]` — PRD 范围内第 3 条 + 预期受影响文件 `packages/workflows/skills/harness-evaluator/SKILL.md`；`[AI_ADDED]` 细化：消费点定在 evaluator 取证前置步骤（理由：PRD ASSUMPTION 指 evaluator skill Step B-1 前置提示，snapshot 按 `scripts/sync-skills-snapshot.sh` 流程回补）

**可观测行为**: `SKILL.md` 含「TaskBundle 含 `judge_feedback` 时，优先补齐 judge 点名的缺失证据」的消费指令（含字段名 `judge_feedback` 与「优先补齐」语义）。

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('judge_feedback')||!(c.includes('优先补齐')||c.includes('优先补取')))process.exit(1);console.log('OK')"
```
**硬阈值**: 退出码 0（SKILL.md 含消费指令）。

---

## 已知约束

### 来自 Invariant 铁律（PRD）
- [证据分类] `[累积FR]`/`[铁律]` judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」；`evidence_insufficient` 优先走 evaluator 补取证 → 本 sprint 正是让 evaluator 拿到点名证据以补取证，`judge_feedback.failure_class` 必须原样带 `evidence_insufficient`（见 DoD INV-1）。
- [证据窗口] judge 证据消费窗口 前 8 条 × 600 字符；evaluator 产 `.brain-result.json` 带足一手证据 → 本 sprint 不改窗口口径（范围外明确排除），见 DoD INV-2（N/A）。
- [验证时钟] evaluator 复用既有 PR 验证时钟 → 本 sprint 不改 validation_clock 注入（`buildInputs` 既有 `pipeline_started_at/deadline_at` 逻辑不动），见 DoD INV-3（N/A）。

### 来自累积 FR（context-manifest）
- 本 line 暂无已验收历史 ability（PRD「累积 FR」段：均为 planned 态）。context-manifest 未在本地可达（无 localhost:5221，runtime_resources.postgres=false）→ 记一行 `context-manifest: unavailable`，以 PRD 正文为准。

### 来自回归测试
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`（3634 行）→ evaluator TaskBundle 组装既有断言（GP contract 注入 / 批准后不重复装 PRD / required_command_evidence 只读复制）：本 sprint 新增字段不得破坏这些既有断言（新增分支为纯 additive）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 同 run 存在 judge FAIL 时，`buildInputs(evaluator)` 注入 `inputs.judge_feedback`（summary+failure_class+round，脱敏截断）；无/PASS 不注入 |
| **NFR（做得多好）** | | 注入后整包 TaskBundle ≤ `HARNESS_BUNDLE_MAX_BYTES`(256KB)；summary 截断到 2000 字符；纯同步函数，无额外 IO |
| **Invariant（永不违反）** | | 只注入最近一次 judge FAIL（不堆叠历轮）；不改 judge 侧逻辑 / generator-fix `evaluator_feedback` / validation clock / 证据窗口口径 |
| **判定点（怎么知道）** | | 见下方判定点登记表 |
| **保质期（何时过期）** | | judge_feedback 仅对「下一轮」evaluator 有效；每轮重算（读当轮最近 judgeVerdict），无持久化过期问题 |
| **死亡告警（停了谁知道）** | | 注入逻辑回归由 CI 单测守护（brain-ci 跑 `__tests__/dispatcher-judge-feedback.test.js`）；断链复发 = 单测红 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 效果 = evaluator 下一轮拿到点名证据；单测断言 `inputs.judge_feedback` 结构在，消费侧断言 SKILL.md 含指令；端到端「judge 不再原样 FAIL」属跨轮真实链路，见接缝清单 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| 「同 run 是否已有 judge FAIL」 | A. 读 observed.judgeVerdict.verdict==='FAIL'; B. 扫 decisionLog 全表 | A（判定注入与否）+ B（仅算 round 计数） | ground-truth 已现查现给最近一条 judgeVerdict；round 需计数则扫 decisionLog | 误判 → 首轮 evaluator 误注入 / 断链未修 |
| 「哪段文本是 judge 点名的缺失证据」 | A. judgeVerdict.feedback 全文; B. 另解析结构化字段 | A（feedback 全文脱敏截断） | feedback 即 judge 裁决摘要（kernel-handlers 同源 attempt.summary），无独立结构化缺失清单字段 | 截断过狠 → 点名证据被切掉，evaluator 补不全 |

（本任务判定点均为编排层数据读取，非真机/RPA 外部状态推断；无 ⚠️ 级不可逆判定点。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| observed.judgeVerdict 缺失/结构异常 | 不注入 judge_feedback（字段缺席） | 是（纯函数，同输入同输出） | 退化为现状（首轮 evaluator 行为），不阻断派发 |
| summary 超长 | sanitizeDiagnostic 截断到 2000 字符 | 是 | 截断后仍 > 256KB 由既有 `enforceBundleSizeLimit` 兜底（丢 case_file feedback_md） |
| failure_class 为 null（FAIL 但无分类） | judge_feedback.failure_class=null，仍注入 summary+round | 是 | 不阻断；evaluator 至少拿到点名证据文本 |

### 输入对抗面

N/A — 本 sprint 改的是 Brain 内部编排层函数，输入来自本 run 自己的 decisionLog（Brain 自产），非对外暴露 agent / 外部用户可写入接口。

---

## 禁 mock 边清单

本单涉及「跨模块数据传递」（ground-truth 产出 `observed.judgeVerdict`/`observed.decisionLog` → dispatcher `buildInputs` 消费 → 写入 evaluator TaskBundle.inputs）。禁 mock 边：

- **ground-truth `observed.judgeVerdict` 形状 ↔ dispatcher `buildInputs` 消费**（本单新增的消费边）：失败测试必须**直调真实 `buildInputs`/`buildBundle`**（不 stub 被测函数），`observed.judgeVerdict`/`observed.decisionLog` 按 ground-truth.js 真实 shape（`asJson(judgeRow.detail)`：`{verdict,feedback,failure_class,...}`）构造。
- **代码 ↔ 256KB 传输闸（`enforceBundleSizeLimit` / `HARNESS_BUNDLE_MAX_BYTES`）**：超长 summary 用例必须真跑 `buildBundle` + `enforceBundleSizeLimit` 对真实整包字节数断言，不许 mock 字节计算。

无 DB 写路径（`buildInputs` 为纯函数，不触库；runtime_resources.postgres=false）——不需要真 Postgres。无调度/状态机/生命周期钩子改动。

---

## 未覆盖真实链路清单

- **跨轮端到端「下一轮 judge 拿到新证据不再原样 FAIL」**｜为什么 mock：本 sprint 单测层只验证「evaluator bundle 确含点名证据」这一注入契约，真实「judge 复判转 PASS」依赖 evaluator 真去补证 + judge 真复判，跨多个 attempt/整条 harness run，属编排全链，非本单函数级可覆盖｜真验证补位计划：由 harness 自身 fix-loop 运行时观测（issue 47c4434d 的原始 run 复跑 / 后续同类 run 的 judge FAIL→PASS 收敛率下降），非本 sprint CI 内。此为 `logic-done-pending` 项，本 sprint 只交付注入契约的 logic-done。

（除上述跨轮端到端项外，本合同 DoD 无 force_*/stub/假数据。）

---

## 接缝清单（接缝 vs 逻辑）

- **逻辑断言（环境无关，CI 绿=done）**：`buildInputs` 注入 judge_feedback 的结构 / 缺席条件 / 截断 / 256KB 体检 → 全部 vitest 单测覆盖，CI 绿即 done。
- **接缝断言（跨轮真实世界，logic-done-pending）**：evaluator 真消费 judge_feedback 后 judge 复判转 PASS → 属跨轮 harness run 真实链路，本 sprint 标 `logic-done-pending`（见「未覆盖真实链路清单」），不在本单 CI 内真验。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## contract-gate

contract-gate: applies (packages/brain/src/lib/contract-gate.js 存在，cecelia 仓)——本合同 BEHAVIOR/E2E 断言均为 vitest/node 退出码驱动（无 curl 弱 oracle、无 psql 计数、无 || true 吞错、无 MOCK_*），已本地跑 evaluateContractText 无阻塞命中。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `observed.judgeVerdict` 为字符串 JSON（非对象）/ `feedback` 非字符串（number/null）/ `decisionLog` 缺失 → buildInputs 不得抛异常，退化为不注入或 summary='unknown'
- 重复提交: 连续两轮 evaluator 派发（同一 judgeVerdict）→ judge_feedback 幂等，round 计数不重复膨胀
- 中途中断: judgeVerdict.verdict 存在但 feedback 缺失 → summary 应为 sanitizeDiagnostic 兜底值，不得 crash
- 边界值: feedback 恰为 2000 / 2001 字符边界；decisionLog 含多条 verdict:judge（PASS 夹 FAIL）时 round 计数正确
发现分级: P0/P1（buildInputs 抛异常致整条派发链挂 / 误注入破坏既有 evaluator 断言）→ 阻塞 merge；P2/P3（round 计数偏差等）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 Brain 编排层 vitest + node 体检）

> 本 sprint 无 DB / 无 localhost:5221 依赖（runtime_resources.postgres=false，改动为纯函数 buildInputs），故 local_api 脚本用 vitest 单测 + node 字节体检替代 DB 自举模板。evaluator 按 target_environment=local_api 本地执行。

```bash
#!/bin/bash
set -euo pipefail

# 1. 跑本 sprint 永久回归单测（judge_feedback 注入契约 4 条用例）
cd packages/brain
npx vitest run src/orchestrator/__tests__/dispatcher-judge-feedback.test.js --reporter=basic 2>&1 | tee /tmp/jf-red.log
grep -qE "Tests[^0-9]*4 passed" /tmp/jf-red.log || { echo "FAIL: judge_feedback 单测未全过"; exit 1; }

# 2. 回归护栏：既有 dispatcher 单测不得被新增字段打破
npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=basic 2>&1 | tee /tmp/disp.log
grep -qE "failed" /tmp/disp.log && { echo "FAIL: 既有 dispatcher 回归被破坏"; exit 1; } || true

# 3. evaluator skill 消费侧提示词体检（SKILL.md 含 judge_feedback 消费指令）
cd ../..
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.includes('judge_feedback')||!(c.includes('优先补齐')||c.includes('优先补取')))process.exit(1);console.log('OK: SKILL.md 消费指令在位')"

echo "✅ Golden Path 验证通过（judge_feedback 注入契约 + 回归护栏 + 消费侧提示词）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| judge_feedback 注入 | `packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js`（永久回归）；proposer 红副本 `sprints/08131646-kernel-7cb93de9/tests/dispatcher-judge-feedback.test.js`（root Sprint Tests 亦跑） | 同 run 存在 judge FAIL 时注入 judge_feedback 含 summary 与 failure_class / 本 run 无任何 judge verdict 时不注入 judge_feedback 字段 / 最近 judge verdict 为 PASS 时不注入 judge_feedback 字段 / 超长 judge summary 截断后整包 bundle 不越过 256KB 传输闸 | 当前 4 用例中 2 红（注入含字段 + 超长截断）2 绿（缺席用例），修后 4 绿 |
