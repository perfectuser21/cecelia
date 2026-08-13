# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）— 本 sprint 是 harness fix loop 反馈回环的独立后端修复，不推进某条已命名 Golden Path 的用户步骤。

> **Contract Gate**: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在 → 走代码层 Contract Gate + 本 skill 内置规则。
> **map**: `[MAP_NOT_CONFIGURED]` — task.payload 缺 `map_scope`/`map_repo`（PRD 假设第 3 条），无 Unified Map radius / must_run_assertions，scope 仅依据 task 描述与 anchor，不做领域猜测。
> **gp-anchor**: skipped (product-map.json not found) — cecelia 仓无 `product-map/generated/product-map.json`。

---

## Response Schema（推导来源: PRD 字面 + api_registry N/A）

本 sprint **无 HTTP 响应**：改的是 `buildInputs()` 组装的**内部 TaskBundle.inputs** 字段。Reviewer 第 6 维按内部对象 schema 审查（下列每个约束在 DoD 有对应 node 断言）。

### 内部字段: `TaskBundle.inputs.judge_feedback`（仅 `role=evaluator`）

注入条件：`spec.role === 'evaluator'` **且** 本 run `observed.decisionLog` 中按 `hop` 倒序第一条 `action==='verdict:judge'` 的 `detail.verdict === 'FAIL'`。否则**该字段整体缺省**（不是 `null`，是 key 不存在）。

```json
{ "summary": "<string>", "failure_class": "<string|null>", "round": 5 }
```

- `summary` (string, 必填): 来源——judge verdict `detail.feedback`（judge 点名的缺失证据原文），**先脱敏再截断**至 ≤ 4000 字符。来源: 现有代码 `kernel-handlers.js appendJudgeVerdict` 写入 `detail.feedback = result.feedback`。
- `failure_class` (string|null, 必填): 来源——judge verdict `detail.failure_class`（如 `"evidence_insufficient"`）；非字符串时取 `null`。
- `round` (integer, 必填): 来源——judge verdict 记录的 `Number(row.hop)`（PRD 假设第 2 条：round 取自 hop 元数据）。

**禁用字段名**（不得作为对外/内部字段出现在 judge_feedback）: `feedback`（源字段名，输出必须叫 `summary`）、`verdict`、`detail`、`evaluator_failure_class`、`pr_head_sha`。

**Error / 缺省语义**: 无 judge verdict / 最近 judge 为 PASS / `spec.role !== 'evaluator'` → `inputs` 中**不存在** `judge_feedback` key（首轮 bundle 结构与现状逐字节一致）。

---

## Golden Path

[fix loop / rerun 触发] → [dispatcher.buildInputs 读本 run 最近 judge FAIL 裁决] → [注入脱敏+截断的 judge_feedback] → [evaluator 拿到点名证据清单本轮优先补齐]

### Step 1: fix loop / rerun 再次组装 role=evaluator 的 TaskBundle
**来源**: `[FROM_PRD]` — Golden Path 第 1 步（PRD「Golden Path」1）

**可观测行为**: 同一 run 已存在一条 `verdict:judge` 且裁决 FAIL（如 `evidence_insufficient`），`dispatch` 走 `buildBundle('spawn:evaluator', ...)` / `spawn:evaluator-evidence-repair`（role 均为 `evaluator`）。

**验证命令**:
```bash
node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b01
# 期望: exit 0, stdout 含 OK: judge_feedback injected with summary + failure_class + round
```
**硬阈值**: `inputs.judge_feedback.summary` 含 judge 点名证据 且 `.failure_class==='evidence_insufficient'` 且 `.round===5`。

---

### Step 2: buildInputs 从 decisionLog 取最近 judge FAIL 注入 judge_feedback
**来源**: `[FROM_PRD]` — Golden Path 第 2 步

**可观测行为**: 与现有 `human_context`（读最近 `verdict:context_answer`）同构——`[...(observed.decisionLog ?? [])].sort((a,b)=>Number(b.hop)-Number(a.hop)).find(r=>r.action==='verdict:judge')`，仅当其 `detail.verdict==='FAIL'` 时注入。多条 FAIL 只取最近一次（按 hop 倒序）。

**验证命令**:
```bash
node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b06
# 期望: exit 0 — 三条 FAIL(hop 3/5/7) 只注入 hop=7 的最新裁决, round===7
```
**硬阈值**: `round===7` 且 `failure_class==='evidence_insufficient'` 且 summary 来自最新裁决（含 "newest"）。

---

### Step 3: 无 judge verdict / PASS 裁决 → 不注入（边界）
**来源**: `[FROM_PRD]` — PRD「边界情况」第 3-4 条

**可观测行为**: 本 run 无任何 judge verdict，或最近 judge 裁决为 PASS → `inputs` 不含 `judge_feedback` key，bundle 结构与现状一致。

**验证命令**:
```bash
node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b02
node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b03
# 期望: 两条均 exit 0 — 'judge_feedback' in inputs === false
```
**硬阈值**: `('judge_feedback' in inputs) === false` 两场景各一。

---

### Step 4: 超长 summary 截断 + 脱敏，整条 bundle ≤ 256KB（可观测出口）
**来源**: `[AI_ADDED]` — 理由：PRD NFR「传输闸 ≤ 256KB」「脱敏」codify 成可执行断言，防止一手证据回环反而撑破 `HARNESS_BUNDLE_MAX_BYTES` 或把凭据带进 bundle。

**可观测行为**: judge summary 达 600KB 时，注入后 `Buffer.byteLength(JSON.stringify(bundle)) ≤ 256*1024` 且 `enforceBundleSizeLimit` 不抛 `task_bundle_size_limit_exceeded`；summary 内的凭据（`ghp_...` 等）落 bundle 前替换为 `[REDACTED]`。

**验证命令**:
```bash
node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b04
node sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs b05
# 期望: b04 exit 0 (bytes<=262144, summary<=4096 chars); b05 exit 0 (ghp_ 被 [REDACTED] 替换)
```
**硬阈值**: bundle 字节数 ≤ 262144 且 `summary.length ≤ 4096`；`summary` 不含原始凭据、含 `[REDACTED]`。

---

## 已知约束（来自回归测试 + 累积FR + Invariant）

- [回归测试] `packages/brain/src/__tests__/dispatcher.test.js` 等既有 dispatcher 单测——本单只在 evaluator 分支**新增** `judge_feedback`，不得改动 `human_context`/`evaluator_feedback`/`pull_request` 现有注入行为（这些既有断言必须继续绿）。
- [累积FR] `context-manifest`: unavailable（postgres=false，无法拉 line context；本 line PRD 标「暂无 done/working 历史 ability，无累积 FR」）。
- [Invariant 证据分类] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」，`evidence_insufficient` 优先走 evaluator 补证 → 本单正是为 `evidence_insufficient` 提供补证输入（`judge_feedback`）。→ 由 B-01/B-06 覆盖。
- [Invariant 证据前置] judge 证据消费窗口=前 8 条 × 600 字符；evaluator 产 `.brain-result.json` 一手证据须靠前——**本单不改窗口本身**（PRD 不在范围内），只提供 `judge_feedback` 输入。→ N/A（消费侧提示词在 SKILL.md，不改窗口）。
- [Invariant 验证命令实跑] 合同验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态退 0 → **本合同 BEHAVIOR 全部用 `node <oracle>.mjs` 直跑真实 buildInputs（确定性 exit code），不依赖 vitest include 范围**；permanent 回归测试落 `packages/brain/src/orchestrator/*.test.js`（在 brain-unit include glob 内，无 DB）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | `buildInputs(role=evaluator)` 在本 run 存在 judge FAIL 时注入 `inputs.judge_feedback`（summary+failure_class+round），仅最近一次 |
| **NFR（做得多好）** | | 注入后整条 bundle ≤ 256KB；summary ≤ 4000 字符；仅 O(decisionLog) 一次遍历，无新增 IO |
| **Invariant（永不违反）** | | ①无 judge/PASS 裁决时 bundle 结构与现状逐字节一致（不回退）；②judge_feedback.summary 落 bundle 前脱敏，不带凭据；③只注入最近一次，不累积历史裁决 |
| **判定点（怎么知道）** | | 见下方登记表（"哪条 judge 记录算最近一次 FAIL"） |
| **保质期（何时过期）** | | judge_feedback 是**每轮即时**从 decisionLog 重算，不缓存、不落库，随 run 生命周期；无独立退役 |
| **死亡告警（停了谁知道）** | | 注入失效 → fix loop 重新盲重跑、judge 原样 FAIL → 现有升级人审阈值兜底（本单不改阈值）；permanent CI 回归红即知回归 |
| **失败语义（挂了怎么办）** | | decisionLog 缺失/detail 非对象/feedback 非字符串 → 安全降级为**不注入**（fail-open 到现状），绝不抛错阻断派发 |
| **效果确认（已发≠已生效）** | | node oracle b01/b06 断言注入内容真实进入 `inputs`；b04 断言整条 bundle 过 256KB 闸；permanent vitest 进 CI |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| 哪条 judge 记录算"最近一次 FAIL" | A. `decisionLog` 按 hop 倒序首条 verdict:judge 且 detail.verdict==='FAIL'; B. 遍历取 max(hop) 的 FAIL; C. 取时间戳最新 | A（按 hop 倒序 .find，与现有 `human_context` 读 context_answer 同构） | 复用现有已验证读取模式，hop 单调递增即时序，无需时间戳 | 取错轮次 → 注入过期证据清单，evaluator 补错证据（非静默丢数据，judge 会再 FAIL 可自愈） |
| judge 裁决是否为 FAIL | A. `detail.verdict==='FAIL'`; B. `gate_verdict` 前缀 `deny:` | A（detail.verdict 是合同字段，appendJudgeVerdict 直写） | detail.verdict 是权威裁决字段 | 误判 PASS 为 FAIL → 给 PASS 轮注入无谓证据（bundle 略增，无面客后果） |

> 本任务判定点误判后果均**非**静默丢数据/直接面客/不可逆，无 ⚠️ 级判定点，无需升拍板点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是 | 客户端重试 |
| `observed.decisionLog` 为 undefined/null | 视为空数组，不注入 judge_feedback | 是（纯函数，同输入同输出） | fail-open 到现状 bundle |
| judge `detail` 非对象 / `feedback` 非字符串 | 跳过注入（不抛错） | 是 | fail-open 到现状 |
| summary 超长 | 脱敏后截断至 4000 字符 | 是 | 截断标记，enforceBundleSizeLimit 再兜底 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 本单不新增对外暴露 agent 输入面；judge summary 是内部 judge 角色产出，非外部用户可写。脱敏（凭据 [REDACTED]）已覆盖唯一敏感面。 | 内部 | N/A | N/A |

---

## 真实调用方请求 shape

N/A — 本单无「设备/agent 调服务端」链路。`buildInputs` 是 Brain 进程内纯函数，输入是 `ground-truth.js` 从 `orchestrator_decision_log` 物化的 `observed.decisionLog`（已在上游落库，不在本单范围）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 所有 BEHAVIOR 直跑真实 `buildInputs`/`buildBundle`/`enforceBundleSizeLimit`，无 `force_*`/stub/假数据；被改的边不 mock（见下）。

## 禁 mock 边清单

本单涉及**跨模块数据传递**（decisionLog → buildInputs → TaskBundle.inputs → 下游 evaluator 消费）：

- `observed.decisionLog`（judge verdict 记录）↔ `buildInputs`：本单新增此读取路径，测试必须真调 `buildInputs`，**禁 mock/stub buildInputs 或伪造其返回**；decisionLog 用真实字段 shape 的测试数据（非 mock 对象）。
- `buildInputs` 产出的 `judge_feedback` ↔ `buildBundle` + `enforceBundleSizeLimit`（256KB 传输闸）：256KB 回归必须真跑 `buildBundle(...deferWorkspaceValidation:true)` + `enforceBundleSizeLimit`，**禁 mock size 闸或 byteLength**。

（不涉及 DB 写路径——`buildInputs` 只读内存中的 `observed`，不触库；故无「代码↔DB表」禁 mock 边。）

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `decisionLog` 含 `detail=null` 或 `detail.feedback=12345`(非字符串) 或 `hop` 为字符串 `"5"` → 应安全不注入或正确 Number 化，不抛错
- 重复提交: 同 run 连续两次 `buildInputs(role=evaluator)` → 两次结果一致（纯函数幂等），不累积
- 中途中断: `decisionLog` 同时含 judge FAIL 与更晚的 `verdict:context_answer` → `human_context` 与 `judge_feedback` 互不干扰、都注入
- 边界值: summary 恰好 4000 / 4001 字符 → 截断边界正确；summary 为空字符串 → 注入 `summary:""`（仍是 FAIL 裁决）不崩
发现分级: P0/P1（bundle 撑破 256KB 派发失败 / 凭据泄漏进 bundle / 非 evaluator 角色被误注入）→ 阻塞 merge；P2/P3（截断边界差 1 字符 / 空 summary 语义）→ 记 findings 不阻塞

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> 本 sprint 的被测体是 `dispatcher.js` 的**纯内存函数** `buildInputs`（不依赖 Postgres/Brain server，`runtime_resources.postgres=false` 与之相容）。故 local_api 的 DB bootstrap 模板不适用——oracle 是对真实导出函数的 node 直跑断言 + brain-unit vitest 回归。全部 bash 块按序拼接执行。

```bash
#!/bin/bash
set -euo pipefail
ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$ROOT"
ORACLE="sprints/08131646-kernel-7cb93de9/tests/verify-judge-feedback.mjs"

# 1. 六个机器 oracle 断言（真跑 buildInputs/buildBundle/enforceBundleSizeLimit，确定性 exit code）
for CHK in b01 b02 b03 b04 b05 b06; do
  node "$ORACLE" "$CHK" || { echo "FAIL: oracle $CHK"; exit 1; }
done

# 2. permanent 回归测试进 brain-unit CI（generator 落 packages/brain/src/orchestrator/dispatcher-judge-feedback.test.js）
#    显式指向该文件路径：文件不存在 -> vitest 'No test files found' 退非 0 -> RED（不吃 include-glob 绿态兜底）
cd "$ROOT/packages/brain"
npx vitest run src/orchestrator/dispatcher-judge-feedback.test.js --reporter=basic 2>&1 | tee /tmp/jf-vitest.log
grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/jf-vitest.log || { echo "FAIL: permanent 回归测试未通过或未找到"; exit 1; }

# 3. evaluator SKILL.md 消费侧提示词已同步（SSOT）
cd "$ROOT"
grep -q "judge_feedback" packages/workflows/skills/harness-evaluator/SKILL.md || { echo "FAIL: SKILL.md 缺 judge_feedback 消费提示词"; exit 1; }

echo "OK: judge_feedback 注入 Golden Path 全程验证通过"
```

**通过标准**: 脚本 exit 0（6 oracle + permanent vitest 绿 + SKILL.md 已同步）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| judge FAIL 注入 evaluator bundle | `sprints/08131646-kernel-7cb93de9/tests/dispatcher-judge-feedback.test.ts`（蓝本）+ `packages/brain/src/orchestrator/dispatcher-judge-feedback.test.js`（permanent CI） | injects judge_feedback with summary + failure_class + round on judge FAIL / does not inject judge_feedback when run has no judge verdict / truncates an over-long summary / redacts credential patterns from the summary / injects only the latest judge FAIL by hop | 未实现时 node oracle b01/b04/b05/b06 exit 1（已实测），vitest 5 项断言红 |
