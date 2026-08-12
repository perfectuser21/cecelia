# Sprint Contract Draft (Round 1)

> 锚定父路声明：**独立小路（无父路）** — 本 sprint 是 `packages/brain/src/orchestrator/derive.js`
> 内部失败类路由/护栏的纯逻辑修复，无用户级父 Golden Path。

## 病名 / 目标

修复 Brain issue dbea513f（P0）derive「证据不足」取证死循环：run 06e4566c 每 ~10min 空转
一圈烧算力。两条同源缺陷同一 sprint 双修（只改 derive.js 及其单测）：

1. **护栏字段没落库**：`deriveFailureClassRoute` 的 evidence_insufficient 防死循环 guard 匹配
   `asStructuredJson(r.observed).trigger_sha === currentHeadSha`，但 spawn:evaluator 落库的
   observed 快照顶层从未含 `trigger_sha`（只有 `pr.head_sha`）→ guard 永不触发。
2. **陈旧 judge FAIL 遮蔽新 evaluate PASS**：recollect 后 evaluator 产出了比 judge FAIL 更晚的
   evaluate PASS，`deriveVerdictChain` 规则 4c 仍先命中陈旧 judge 的 failure_class 分支 →
   再次 spawn:evaluator，judge 永不被复派。

## Response Schema（推导来源: PRD字面）

**N/A — 任务无 HTTP 响应**。本 sprint 仅改 `derive(observed) → {phase, action, reason}` 纯函数
决策排序与护栏字段，不新增/修改任何 HTTP 端点。技术上下文 registry 拉取（Step 1.1）在
fleet-worker（postgres:false，Brain 未起）不可用，故按 PRD 字面 + 现有 derive.js 既有约定推导；
`action`/`reason` 字面值以 `packages/brain/src/orchestrator/constants.js` 的 `ACTION` 枚举为准
（`spawn:judge` / `spawn:evaluator` / `wait:human_review`）。

## 已知约束（来自回归测试 + 累积FR）

- [回归测试] `packages/brain/src/orchestrator/__tests__/derive.test.js`（现 95 用例全绿，本 sprint 基线）
  → `judge FAIL + evidence_insufficient → 重派 evaluator 取证，不派 generator-fix`
  → `judge FAIL + product_failure → 仍走 generator-fix（改代码）`
  → `同一 SHA 已重新取证过一次仍 evidence_insufficient → 不再重派，回落人工（防取证死循环）`
  → `evaluate PASS（本 sha）&& 无 judge 记录（本 sha）→ spawn:judge`
- [累积FR] 本 line 暂无历史（journey e6f803f2 现有 ability 均 planned；context-manifest 端点在
  postgres:false 下 unavailable，记一行 `context-manifest: unavailable`，非静默跳过）。

## 历史约束三源（铁律逐条映射）

- **INV [证据不足补证]** judge FAIL evidence_insufficient 优先走 evaluator 补证轮而非改代码
  → 本 sprint 正是加固此机制：B-03 断言「首次 evidence_insufficient 仍走首次 spawn:evaluator 补证」，
    未破坏该铁律；修复只在「补证成功后收敛」与「二次补证仍不足落人审」两处加护栏，不改首轮补证语义。
- **INV [验证时钟 fail-closed]** Kernel validation_clock_required 默认 fail-closed
  → **N/A**：本 sprint 不触及 validation_clock / gates.js。
- **INV [证据窗口 前8×600]** judge 证据消费窗口
  → **N/A**：本 sprint 不改证据消费窗口 / judge 侧逻辑。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | derive 在「judge FAIL evidence_insufficient → 重派 evaluator 补证 → 补证成功」后派 judge 复核；补证仍不足则落人审；不再无限重派 evaluator |
| **NFR（做得多好）** | 性能/可靠性阈值 | 纯函数确定性（禁 Date.now/Math.random）；不引入任何轮数上限常量（GAN 无上限刻意设计）；每次决策仍写 decision_log |
| **Invariant（永不违反）** | 不变量 | 首次 evidence_insufficient 仍走 evaluator 补证（不改错人派 generator）；同一 SHA 至多补证一次仍不足即人审收敛，不第三次 recollect |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 长期有效；随 orchestrator 状态机语义演进而演进，无 token/时限过期 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | 回归测试入 CI（brain-ci.yml）；若护栏再破，derive.test.js 双序列断言变红即拦 |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | 单测断言 `derive(observed).action/reason` 为期望值，vitest exit code 为回执；收敛/落人审动作可在 decision_log 复查 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳 | 静默丢消息 |
| ⚠️ evaluate verdict 是否「晚于」最新 judge verdict（判定补证是否产出更新证据） | A. decision_log 行时序（verdict:evaluate hop vs verdict:judge hop，按 currentHeadSha 过滤）; B. verdict 落库时间戳 | A. decision_log 行时序（hop 排序） | derive 是纯函数刻意禁 Date/时间戳，唯一确定性可比信号是 decision_log hop 序；A 与既有 SHA 锚定/decisionLog 消费风格一致 | 误判「有更新证据」→ 该收敛却重派 judge（可控，judge 会再判）；漏判 → 退回死循环（严重，故 B-01 断言把守） |
| ⚠️ recollect 后仍不足时 guard 是否命中（同一 SHA 已补证一次） | A. 仅 observed.trigger_sha === headSha; B. observed.trigger_sha \|\| observed.pr.head_sha 兜底匹配 | B. trigger_sha 优先、pr.head_sha 兜底 | 生产实证 spawn 快照顶层缺 trigger_sha，仅 A 会漏判致死循环（本 issue 根因） | 漏判 → 第三次 recollect 无限循环烧钱（P0）；故 B-02 断言把守兜底路径 |

> ⚠️ 两条判定点误判后果严重（漏判即 P0 死循环复发）。二者均已由 PrepPRD Golden Path
> 第 2/3 步显式拍定（decision_log 时序判新旧 + pr.head_sha 兜底），无需再升拍板点；notes 无
> `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| observed 缺 evaluate/judge verdict 行（无从比较新旧） | 按既有 4a/4b 路由（无 evalRow→spawn:evaluator；有 evalRow PASS 无 judgeRow→spawn:judge），不误判 awaiting_judge | 是（纯函数，同输入同输出） | 回退现有失败类路由 |
| observed 快照缺顶层 trigger_sha（历史/旧调用路径） | guard 兜底用 `observed.pr.head_sha` 匹配 currentHeadSha 仍触发 | 是 | 兜底匹配，仍收敛落人审 |
| 补证 evaluate 早于/等于最新 judge（无更新证据） | 不误判 awaiting_judge，仍按既有失败类路由（首次→recollect） | 是 | 保持既有语义 |

### 输入对抗面（对外暴露 agent 必填）

**N/A** — derive 是 Brain 内部纯函数状态机，输入 `observed` 由 orchestrator 内部构造，不接受外部
用户/agent 直接写入，无 prompt injection / 越权指令面。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

[judge 判 evidence_insufficient] → [重派 evaluator 补证一次] → [补证成功则派 judge 复核收敛 / 补证仍不足则落人审]，不再无限重派 evaluator。

---

### Step 1: judge 判 FAIL(failure_class=evidence_insufficient) → 首次重派 evaluator 补证
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1（sprint-prd.md「## Golden Path」第 1 条）

**可观测行为**: 尚未补证过的 evidence_insufficient（最新 verdict 是 judge，无更晚 evaluate）→ derive
下一动作为 `spawn:evaluator`，reason=`judge_evidence_insufficient_recollect`（既有行为不回归）。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
npx vitest run --root "${WORKSPACE_PATH:-/workspace}/sprints/08111523-kernel-c9043059" \
  tests/derive-recollect-loop.test.ts -t "不误判 awaiting_judge" 2>&1 | grep -qE "Tests +1 passed"
# 期望：exit 0（首次仍走补证）
```

**硬阈值**: action=spawn:evaluator 且 reason=judge_evidence_insufficient_recollect

---

### Step 2: evaluator 带新证据返回 evaluate PASS（晚于最新 judge）→ 派 judge 复核
**来源**: `[FROM_PRD]` — Golden Path 步骤 2（sprint-prd.md「## Golden Path」第 2 条 evaluate_passed_awaiting_judge）

**可观测行为**: decision_log 中最新 `verdict:evaluate`(PASS) 的 hop 晚于最新 `verdict:judge`(FAIL)
且均锚定 currentHeadSha → derive 走 `evaluate_passed_awaiting_judge` 派 `spawn:judge`，
**而非**再进 evidence_insufficient/其他 failure_class 分支重派 evaluator。这是 run 06e4566c 死循环点。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
npx vitest run --root "${WORKSPACE_PATH:-/workspace}/sprints/08111523-kernel-c9043059" \
  tests/derive-recollect-loop.test.ts -t "派 judge 复核" 2>&1 | grep -qE "Tests +1 passed"
# 期望：exit 0（action=spawn:judge, reason=evaluate_passed_awaiting_judge）
```

**硬阈值**: action=spawn:judge 且 reason=evaluate_passed_awaiting_judge

---

### Step 3: recollect 后 judge 重审仍 evidence_insufficient（同 SHA 已补证一次）→ 落人审
**来源**: `[FROM_PRD]` — Golden Path 步骤 3 + 边界情况（sprint-prd.md「## 边界情况」guard 兜底 pr.head_sha）

**可观测行为**: 二次补证后 judge 仍判 evidence_insufficient（最新 verdict 是 judge），即便
spawn:evaluator 落库快照顶层缺 `trigger_sha`，guard 也以 `observed.pr.head_sha` 兜底匹配
currentHeadSha 而命中 → derive 落 `wait:human_review`，reason=`evidence_insufficient_after_recollect`，
**不再第三次** spawn:evaluator。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
npx vitest run --root "${WORKSPACE_PATH:-/workspace}/sprints/08111523-kernel-c9043059" \
  tests/derive-recollect-loop.test.ts -t "落人审 非第三次 recollect" 2>&1 | grep -qE "Tests +1 passed"
# 期望：exit 0（action=wait:human_review, reason=evidence_insufficient_after_recollect）
```

**硬阈值**: action=wait:human_review 且 reason=evidence_insufficient_after_recollect

---

## 禁 mock 边清单

本单改动涉及**状态机（failure_class 路由 / verdict 新旧时序判定 / 终态落人审）**，故：

- **derive(observed) 决策边（纯函数状态机排序）↔ 测试**：测试必须直接 `import { derive } from
  '.../derive.js'` 真调，**禁** `vi.mock('../derive.js')` / stub `deriveVerdictChain` /
  `deriveFailureClassRoute`。被改的那条决策边就是 derive 自身，mock 它 = 结构性抓不到回归。
- **derive ↔ decisionLog verdict 时序边**：judge/evaluate 新旧比较必须喂**真实 decisionLog 行**
  （真 `verdict:evaluate` / `verdict:judge` / `spawn:evaluator` 记录构成的 observed 输入），
  禁造替身排序器或直接注入「已判新旧」的布尔标志绕过真实时序推导。
- **无代码 ↔ DB 边**：postgres:false；本 sprint 不写 DB，decision_log append-only 触发器不在范围
  （出范围），故无需真 Postgres 集成测试——derive 纯函数测试即完整覆盖被改的边。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 为 Brain 内部纯函数逻辑修复（postgres:false，无需真派单/真 DB/真 API server）。
> local_api E2E = 本地 node/vitest 真跑 derive 单测，真调 `derive(observed)` 纯函数，喂 run 06e4566c
> 复现序列断言收敛动作 + 现有 derive 全量单测不回归。无 mock，确定性可复跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}/packages/brain"
SPRINT_ROOT="${WORKSPACE_PATH:-/workspace}/sprints/08111523-kernel-c9043059"

# 1. 取证死循环双修复现回归：B-01/B-02 修复目标 + B-03/B-04 护栏，必须 4/4 全绿
npx vitest run --root "$SPRINT_ROOT" tests/derive-recollect-loop.test.ts --reporter=dot 2>&1 | tee /tmp/derive-loop-e2e.log
grep -qE "Tests +4 passed" /tmp/derive-loop-e2e.log || { echo "FAIL: 双序列回归未 4/4 通过"; exit 1; }
if grep -qE "[1-9][0-9]* failed" /tmp/derive-loop-e2e.log; then echo "FAIL: 存在失败用例"; exit 1; fi

# 2. 现有 derive 全量单测不回归（基线 95 用例，含 evidence_insufficient/product_failure 分支）
npx vitest run src/orchestrator/__tests__/derive.test.js --reporter=dot 2>&1 | tee /tmp/derive-full-e2e.log
grep -qE "Test Files +1 passed" /tmp/derive-full-e2e.log || { echo "FAIL: derive.test.js 全量回归失败"; exit 1; }
if grep -qE "[1-9][0-9]* failed" /tmp/derive-full-e2e.log; then echo "FAIL: derive.test.js 有失败用例"; exit 1; fi

# 3. 永久回归入 CI 核实：generator 须把两条复现断言 port 进 derive.test.js（bug-fix 死规矩）
grep -qE "evaluate_passed_awaiting_judge" src/orchestrator/__tests__/derive.test.js || { echo "FAIL: derive.test.js 缺 awaiting_judge 永久回归断言"; exit 1; }
grep -qE "evidence_insufficient_after_recollect" src/orchestrator/__tests__/derive.test.js || { echo "FAIL: derive.test.js 缺 after_recollect 永久回归断言"; exit 1; }

echo "✅ Golden Path 验证通过：取证死循环双修已收敛，derive 全量不回归，永久回归已入 CI"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: observed 缺 `decisionLog` 字段 / decisionLog 为空数组 / verdict 行缺 pr_head_sha → derive 不得抛未捕获异常，应按既有 4a/4b 兜底路由（无更晚 evaluate 即不误判 awaiting_judge）。
- 重复提交: 同一 currentHeadSha 下 judge/evaluate 多轮交替（judge FAIL → evaluate PASS → judge FAIL → evaluate PASS）→ 以最新一对时序为准，验不会因中间历史行误判。
- 中途中断: spawn:evaluator 行缺 `detail.reason`（非 recollect 派发）→ 不得被 guard 误计为「已补证一次」。
- 边界值: evaluate 与 judge hop 相等（同 hop 落库）→ 按「不晚于」处理，不误判 awaiting_judge（PRD 边界：早于/等于均不算更新证据）。
发现分级: P0/P1（死循环复发/收敛错派）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| recollect 成功派 judge 复核 | `tests/derive-recollect-loop.test.ts` | `派 judge 复核 而非再次 spawn:evaluator` | 现状 action=spawn:evaluator（应为 spawn:judge）→ FAIL |
| recollect 仍不足落人审(兜底) | `tests/derive-recollect-loop.test.ts` | `落人审 非第三次 recollect` | 现状 action=spawn:evaluator（应为 wait:human_review）→ FAIL |
| 首次补证不误判 awaiting_judge | `tests/derive-recollect-loop.test.ts` | `不误判 awaiting_judge` | 现状已绿（护栏，不回归）|
| 显式 trigger_sha 护栏不回归 | `tests/derive-recollect-loop.test.ts` | `显式路径不回归` | 现状已绿（护栏，不回归）|
| 现有 derive 全量不回归 + 双序列永久回归入册 | `packages/brain/src/orchestrator/__tests__/derive.test.js` | `evaluate_passed_awaiting_judge` / `evidence_insufficient_after_recollect` | 现状已绿（基线 95 用例 keep-green + 2 永久回归）|

> 红证据实测（round 1，未改 derive.js）：`Tests 2 failed | 2 passed (4)` —— B-01/B-02 红（修复目标），
> B-03/B-04 绿（护栏）。

## Contract Gate

contract-gate: cecelia 仓，`packages/brain/src/lib/contract-gate.js` 存在，本合同 [BEHAVIOR]/E2E
断言均为真执行（vitest 真跑 + grep 断言 exit code），无裸 curl/无 `|| true` 吞错，符合速查表。
