# Sprint Contract Draft (Round 1) — validation clock 按 fix 轮有界顺延（长跑 run 不再被固定窗口误杀）[r57]

**journey_type**: autonomous
**target_environment**: local_api（纯 orchestrator 纯函数，无 HTTP / 无 DB；runtime postgres=false；本地 evaluator 跑 vitest 冻结守卫即可验）

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」步骤 3「造完真验」——边：orchestrator `decision_log` 时序 ↔ `resolveValidationClock` 有界顺延判死/续命。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

<!-- 当前仓库为 cecelia，根目录无 product-map/generated/product-map.json（仅 zenithjoy-workspace 有），按 skill Step 1.7 cross-repo file-existence gated 规则整体跳过，不阻塞。 -->

## Contract Gate 速查

contract-gate: skipped (file not found, third-party repo) —— 说明：本仓库 `packages/brain/src/lib/contract-gate.js` 不存在（本 sprint 改动落在 `packages/brain/src/orchestrator/`，非 lib 层 gate），按 skill 速查表跨 repo 跳过规则仅执行 skill 内置规则审查。（注：validation-clock 断言全为 `npx vitest` 真跑冻结守卫 + `node -e` 内容断言，无 curl/psql 弱 oracle 风险。）

## Response Schema（推导来源: PRD 字面 + Step 1.1 registry）

N/A — 任务无 HTTP 响应。本 sprint 改动落在 `packages/brain/src/orchestrator/validation-clock.js` 的
`resolveValidationClock`（纯函数：输入 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}`，
输出 `{pipeline_started_at, deadline_at}` 或 `null` 或抛 `validation_clock_required`/`validation_clock_invalid`），
不新增/修改任何 API 端点、不改 DB schema。Reviewer 第 6 维 verification_oracle_completeness 按「无 HTTP 响应」口径审 vitest oracle。

## 已知约束

**回归测试约束（来源: `packages/brain/src/orchestrator/__tests__/validation-clock.test.js`，11 条 it）**：
- `starts one shared window at the first Generator intent` — spawn:generator 空 log → 以 intentAt 起窗
- `reuses the persisted clock for %s`（generator-fix/evaluator/evidence-repair/judge）— 有 persisted 首原点时**复用**（本 sprint 顺延语义仅在 decisionLog 含 `spawn:generator-fix` 行时触发；这些既有用例 decisionLog **无 fix 行** → fixCount=0 → 语义必须不变）
- `recovers a pre-fix in-flight run from the first Generator intent created_at` — 首原点仅 created_at 时回退（fixCount=0，不变）
- `fails closed when a downstream role has no Generator clock` — fail-closed（不放宽）
- `starts one shared window at a verified existing-PR Evaluator intent` / `reuses the persisted verified existing-PR Evaluator clock for Judge` — verified_existing_pr 原点路径（无 generator 行时不变）
- `fails closed when the persisted clock is malformed` — 首原点（fixCount=0）persisted 校验失败仍抛 `validation_clock_invalid`
- `does not create a validation clock for authoring roles` — spawn:reviewer 返回 null

> **零回归硬约束**：上述 11 条既有 it 全部 decisionLog 无 `spawn:generator-fix` 行（或 action 不属 VALIDATION_ACTIONS），
> 落在 fixCount=0 分支，本 sprint 顺延逻辑**不得改变其任何结果**。E2E 段全跑这 11 条断言零回退。

**累积 FR（本 line）**：（本 line 暂无历史，PRD 已注明）

**context-manifest**：unavailable（journey_id=e6f803f2；runtime postgres=false，Brain API 不可达，按 skill 记一行不静默跳过）

## Golden Path

覆盖父路 F1 步骤 3：[首个 generator 起算共享窗口] → [每次 spawn:generator-fix 派发成功即以最新 generator 系 spawn 行 created_at 为新原点重算 timeout_seconds（有界 ≤6 次）] → [管线健康推进的长跑 run 不再被固定窗口误杀；顺延累计到第 7 次冻结在第 6 次原点、到期照常判死]

### Step 1: 一条 run 已跑过 2 轮 generator-fix、按首原点原窗口已耗尽但管线仍在推进
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 / 「背景」第 11-16 行（r50 场景：fix 轮多的 run 撞固定窗口被判死）。

**可观测行为**: `resolveValidationClock` 读 `decisionLog`，识别其中已有 2 行 `spawn:generator-fix`（fix2 的 created_at 已晚于「首原点 + timeout」）。

**验证命令**:
```bash
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "deadline 顺延到最新 fix 原点" 2>&1 | grep -qE "[1-9][0-9]* passed"
# 期望：2 轮 fix 后 deadline 顺延到「最新 fix 行 created_at + timeout」，不再锚死首原点
```

**硬阈值**: `pipeline_started_at == 最新(第2次)generator-fix 行的 created_at`，`deadline_at == 该 created_at + timeout_seconds`。
**验证命令**（硬阈值 codify）：见上；断言 `clock.deadline_at === iso(fix2.created_at + 5400s)` 且 `!== iso(首原点 + 5400s)`（RED 复现）。

---

### Step 2: 系统以最新 generator 系 spawn 行为新原点重算 deadline，顺延次数只数 generator-fix 行、上限 6
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「范围限定」第 46-48 行 + 「假设」第 54-56 行（顺延上限 6，与 fix 收敛探测器一致；新原点取 generator 系 spawn 行）。
**部分 `[AI_ADDED]`**（防造假理由）: 新原点取该行 **created_at 重新 `exactClock` re-derive**，**不复用** fix 行上「一次顺延之前」的 stale persisted detail —— 否则 generator 用 `persistedClock(fixRow)` 实现会让窗口落后一次顺延，长跑 run 仍被误杀（这正是纯函数可重放铁律要堵的口，B-01 用 stale detail 锁死此语义）。

**可观测行为**: `boundedExtensions = min(fix 行数, 6)`；`boundedExtensions === 0` → 走既有 `persistedClock(首原点)`（语义不变）；`>= 1` → 新原点 = 第 `boundedExtensions` 个 generator-fix 行，`exactClock(该行.created_at, timeout)`。

**验证命令**:
```bash
# 恰好 6 轮仍顺延到第 6 次原点（上限内不冻结）
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "恰好 6 轮 generator-fix 仍顺延到第 6 次原点" 2>&1 | grep -qE "[1-9][0-9]* passed"
```

**硬阈值**: 6 轮 fix → `pipeline_started_at == 第6次 fix.created_at`；顺延上限常量 `VALIDATION_CLOCK_EXTENSION_LIMIT == 6` 硬编码在 validation-clock.js。
**验证命令**（硬阈值 codify）：`node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!/VALIDATION_CLOCK_EXTENSION_LIMIT\s*=\s*6\b/.test(c))process.exit(1)"`

---

### Step 3: 顺延有界 —— 第 7 次不再顺延（防无限续命）；无 fix 轮 / fail-closed 语义守恒
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「边界情况」第 37-42 行（超上限冻结第 6 次原点到期判死；无 fix 轮窗口不变；fail-closed 不放宽）。

**可观测行为**:
- 7 轮 fix → deadline 冻结在第 6 次 fix 原点（第 7 次被上限截断，不作原点），到期照常判死；
- 无 generator-fix 行 → 窗口仍以首 generator 原点算（回归守恒）；
- 非 generator 系且无有效 origin → 仍抛 `validation_clock_required`（fail-closed 不被顺延逻辑绕过）。

**验证命令**:
```bash
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "deadline 冻结在第 6 次顺延原点" 2>&1 | grep -qE "[1-9][0-9]* passed"
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "窗口仍以首 generator 原点算" 2>&1 | grep -qE "[1-9][0-9]* passed"
npx vitest run sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js -t "仍抛 validation_clock_required" 2>&1 | grep -qE "[1-9][0-9]* passed"
```

**硬阈值**: 7 轮 fix → `deadline_at == iso(第6次 fix.created_at + timeout)` 且 `!= iso(第7次 fix.created_at + timeout)`；无 fix 轮 → `pipeline_started_at == 首 generator.created_at`；空 log + spawn:judge → throw `validation_clock_required`。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | validation clock 在每轮 spawn:generator-fix 后以最新 generator 系 spawn 行 created_at 为新原点重算 timeout_seconds（有界 ≤6 次） |
| **NFR（做得多好）** | | 纯函数、O(n) 遍历 decisionLog；`timeout_seconds` 默认 5400s 不改 |
| **Invariant（永不违反）** | | ①顺延每 run ≤6 次；②fail-closed 守恒（validation_clock_required 不被绕过）；③纯函数可重放（只依赖 decisionLog 行 hop 时序 + created_at，无 Date.now 之外墙钟）；④无 fix 轮窗口语义不变 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | N/A — 纯计算逻辑，无 token/凭据/数据保质期 |
| **死亡告警（停了谁知道）** | | N/A（合同层）— validation clock 本身即长跑 run 的判死机制；本 sprint 只改窗口原点起算，不改告警链路 |
| **失败语义（挂了怎么办）** | | fail-closed：非 generator 系且无有效 origin → 抛 `validation_clock_required`（拦截，不放行）；persisted 首原点畸形 → 抛 `validation_clock_invalid`（fixCount=0 分支守恒） |
| **效果确认（已发≠已生效）** | | 单元级：真 import real validation-clock.js 断言返回窗口；集成级（loop.js 真库判死接缝）登记 CANNOT_VERIFY（见未覆盖真实链路清单） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 「管线是否仍健康推进」 | A. 读最新 generator 系 spawn 行时序; B. 查 CI 实时状态 | A. 读 decisionLog 最新 generator-fix 行 created_at 顺延窗口 | 纯函数可重放铁律：只许依赖 decision_log 行，禁外部墙钟/查表 | 若误取 stale detail（落后一次顺延）→ 长跑 run 仍被误杀（本 sprint 修的正是此口） |

> 本任务无真机/RPA/外部状态推断接缝判定点（纯函数），上表唯一判定点为窗口原点选取，判定完全确定（读 log 行时序），无 ⚠️ 升拍板点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 非 generator 系 action 且无有效 origin | 抛 `validation_clock_required`（fail-closed，不返回窗口） | 是（纯函数，同输入同结果） | 无（拦截即正确，防无时钟角色裸奔） |
| 首原点（fixCount=0）persisted clock 畸形 | 抛 `validation_clock_invalid` | 是 | 无（既有守恒行为） |
| 顺延累计 > 6 | 不再顺延，冻结第 6 次原点，到期判死 | 是 | 有界即降级（防无限续命） |

### 输入对抗面

N/A — 纯内部 orchestrator 纯函数，`decisionLog` 来自 Brain 自身 append 的 `orchestrator_decision_log`（非对外暴露 agent 输入，无 prompt injection 面）。

## 禁 mock 边清单

本单改动涉及**状态机 / 调度判死决策**（`resolveValidationClock` 的 validation 窗口原点选取，直接决定长跑 run 判死/续命），按 v9.12 硬规则禁 mock 被改的边：

- `测试 ↔ resolveValidationClock`（本单改的就是该纯函数）：冻结守卫必须**真 import** `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`，构造真实 `decisionLog` 行调用；**禁** `vi.mock`/stub 该模块或其内部 `exactClock`/`persistedClock`。
- `resolveValidationClock ↔ decisionLog 行`（本单改的原点选取读的就是这些行）：测试用真实结构的 decision_log 行（`{hop, action, created_at, detail}`），禁用替身对象顶替。

> 无更外层依赖需要 mock（纯函数，无 DB/网络/第三方调用）。真库 loop.js 消费侧接缝见「未覆盖真实链路清单」。

## 未覆盖真实链路清单

- **真库 loop.js 消费 `resolveValidationClock` 结果做判死/续命的集成接缝**（CANNOT_VERIFY，合同登记）：
  `packages/brain/src/orchestrator/loop.js:1534` 在真实 orchestrator tick 中以 `observed.decisionLog`（真库 `orchestrator_decision_log` 行）调用本函数，并把返回窗口 append 进 decision detail、供 watchdog 判死。
  为什么 mock 顶替：runtime postgres=false（本 attempt 无真库），纯函数单测不拉起真实 tick loop 与真 Postgres。
  真验证补位计划：该集成边由 Brain 常规 brain-ci integration job（真 Postgres）与生产 tick loop 覆盖；本 sprint 纯函数变更不改 loop.js 调用点签名（仍传 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}`），签名回归由既有 `validation-clock.test.js` 11 条 + 本冻结守卫 5 条守住，1.273.128 起裁判承认合同登记的 CANNOT_VERIFY 项。

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数 vitest 冻结守卫）

> 纯 orchestrator 纯函数变更，无 DB、无 API server：evaluator 从仓库根跑本 sprint 冻结守卫（在根 vitest.config.js include：`sprints/**`、`tests/**`）；既有回归 `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` **不在根 include**，按 skill 9.25 死规则用子 shell 切进包根跑（该包自己的 vitest 配置）。
> RED 证据（修前）：本冻结守卫「deadline 顺延到最新 fix 原点」「deadline 冻结在第 6 次顺延原点」「恰好 6 轮…仍顺延到第 6 次原点」3 条 it 因现行为永远锚死首原点而 FAIL（`Tests 3 failed | 2 passed (5)`，已本地实证）。
> GREEN（修后）：本冻结守卫 5 条全绿 + 既有 11 条零回退（已用参考实现本地实证 5 passed / 11 passed）。

```bash
#!/bin/bash
set -euo pipefail

FROZEN="sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js"

# 1. 本 sprint 冻结守卫（从仓库根跑，sprints/** 在根 vitest include）—— 5 条全绿
npx vitest run "$FROZEN" --reporter=verbose 2>&1 | tee /tmp/e2e-vclock-frozen.log
grep -qE "Tests +5 passed \(5\)" /tmp/e2e-vclock-frozen.log || { echo "FAIL: 冻结守卫非 5/5 全绿"; exit 1; }

# 2. 既有回归守恒（子 shell 切进 packages/brain 用该包 vitest 配置；从根跑会 No test files found）—— 11 条零回退
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js 2>&1 ) | tee /tmp/e2e-vclock-regression.log
grep -qE "Tests +11 passed \(11\)" /tmp/e2e-vclock-regression.log || { echo "FAIL: 既有 validation-clock 回归非 11/11"; exit 1; }

# 3. 顺延上限常量硬编码校验（有界续命铁律）
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!/VALIDATION_CLOCK_EXTENSION_LIMIT\s*=\s*6\b/.test(c))process.exit(1)" \
  || { echo "FAIL: 未硬编码 VALIDATION_CLOCK_EXTENSION_LIMIT=6"; exit 1; }

echo "✅ validation clock 有界顺延 E2E 验证通过（冻结 5/5 + 回归 11/11 + 上限常量=6）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数低风险，不上调）
高风险面:
- 错输入: `decisionLog` 含 `hop` 为字符串 / 缺 `created_at` 的 generator-fix 行（`Number(hop)` NaN 排序、`exactClock` 对 undefined created_at 抛错语义是否 fail-closed）
- 重复提交: 同一 `decisionLog` 多次调用结果是否恒等（纯函数可重放铁律，禁 Date.now 之外墙钟）
- 中途中断: fix 行乱序（hop 非单调递增）时排序后原点选取是否仍取「最新 generator-fix」
- 边界值: fix 行数 = 0 / 1 / 5 / 6 / 7 / 100 的原点选取；`timeout_seconds` 边界（0 / 负 / 非整数 → `validation_clock_timeout_invalid`）
发现分级: P0/P1（误判死/无限续命/纯函数不可重放）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| validation clock 按 fix 轮有界顺延（本 sprint 冻结） | `sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js` | deadline 顺延到最新 fix 原点 / deadline 冻结在第 6 次顺延原点 / 恰好 6 轮 generator-fix 仍顺延到第 6 次原点 / 窗口仍以首 generator 原点算 / 仍抛 validation_clock_required | RED: 3 failed \| 2 passed (5)（`deadline 顺延到最新 fix 原点` + `deadline 冻结在第 6 次顺延原点` + `恰好 6 轮…仍顺延到第 6 次原点` 复现现行为永远锚死首原点；本地实证 `Tests 3 failed \| 2 passed (5)`） |

> **本表只登记本 sprint 冻结产物**（唯一行，已落盘并进 commit）：`sprints/08231856-kernel-r57-validation-clock/tests/step3-validation-clock-fix-extension.test.js`，5 条 it() 真 import real validation-clock.js。「BEHAVIOR 覆盖」列每项均为对应 it() 名的字面子串（`deadline 顺延到最新 fix 原点`⊂it#1 / `deadline 冻结在第 6 次顺延原点`⊂it#2 / `恰好 6 轮 generator-fix 仍顺延到第 6 次原点`⊂it#3 / `窗口仍以首 generator 原点算`⊂it#4 / `仍抛 validation_clock_required`⊂it#5）。
> **不把 repo 既有守卫（`packages/brain/src/orchestrator/__tests__/validation-clock.test.js`）登记进本表**：该路径非 `sprints/` 前缀，封印时 `assertTestContractResolvable` 会对其走 `readRepoFile(approvedSha, path)`（封印环境易抛错 → `FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE` 拒封印，r50/08230711 R1 实证）。该 11 条回归改为在 `## E2E 验收` 段子 shell 全跑（`Tests 11 passed (11)`）与常规 brain-ci 中执行，零回归覆盖不削减。
> **测试放置说明**：PRD 第 62 行建议放 `tests/gp/f1/`；但 skill 9.27 死规则 + runner finalizer 要求冻结测试必须在 `sprints/<本sprint目录>/tests/` 落盘并进 commit（否则 attempt 被拒），封印闸也只对 `sprints/` 前缀行走安全解析链。故本冻结守卫落 `sprints/.../tests/`（经根 vitest `sprints/**` include 常驻 CI，红先行永久回归守卫语义完全满足，08230711/r52 同源先例已实证此放置合规且合并成功）。
