# Contract DoD — Harness Kernel 有界运行与正确恢复

**Task ID**: 1b997ed6-d984-46d4-8336-12bff5a5ba3c  
**Sprint Dir**: sprints/07230920-relay-1b997ed6  
**合同版本**: v1

---

## [BEHAVIOR] B-01：120 分钟总预算硬限（纯函数，clock 注入）

**描述**：Kernel 必须能从 DB 中 `run.started_at` 和注入的 `nowAt` 推导出是否超出 120 分钟预算，不依赖 `Date.now()`。

**实现要求**：
- `isDeadlineExceeded(startedAt, nowAt, budgetMs)` 纯函数存在于 `packages/brain/src/orchestrator/gates.js` 或 `ground-truth.js`
- 函数禁止内部调用 `Date.now()`、`new Date()`，必须接受注入参数
- loop 在 collect 前、derive 后、dispatch 前三处各调用一次 deadline check
- 超时写 `terminal_reason: 'automation_deadline_exceeded'`，禁止 requeue

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/deadline.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && node --input-type=module <<'EOF'
import { isDeadlineExceeded } from './packages/brain/src/orchestrator/gates.js';
const start = new Date('2026-01-01T00:00:00.000Z');
const at119m59s = new Date(start.getTime() + 119 * 60 * 1000 + 59 * 1000);
const at120m00s = new Date(start.getTime() + 120 * 60 * 1000);
console.assert(!isDeadlineExceeded(start, at119m59s, 120 * 60 * 1000), 'FAIL: 119:59 should NOT exceed deadline');
console.assert(isDeadlineExceeded(start, at120m00s, 120 * 60 * 1000), 'FAIL: 120:00 MUST exceed deadline');
console.log('B-01 deadline pure-function: OK');
EOF
```

---

## [BEHAVIOR] B-02：failure_class 路由矩阵（五种，全覆盖）

**描述**：derive() 或 kernel-handlers 必须根据 Judge 返回的 failure_class 正确路由到不同 action，且 evidence_invalid 绝不触发 generator。

**实现要求**：
- `derive()` 接受 `judgeVerdict.failure_class` 字段
- 路由矩阵完整实现：product_failure → generator-fix；evidence_invalid → evaluator-evidence-repair；contract_invalid/environment_failure/unknown → mark_failed（超限时）
- 缺 failure_class 时视为 unknown，走 needs_context 不走 generator-fix
- 失败分类、触发 SHA、责任角色、下一动作写入 decision log

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/failure-class-routing.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/failure-class-routing.test.js 2>&1 | tail -20
```

---

## [BEHAVIOR] B-03：no-progress 熔断（generator-fix SHA 未变立即 terminal）

**描述**：generator-fix attempt 完成后，若 `pr_head_sha` 未从触发 SHA 变化，Kernel 必须立即写 `no_progress_same_sha` 并终止 run，不允许任何重试路径。

**实现要求**：
- `checkProgressToken(triggerSha, newSha)` 纯函数（或等价逻辑）存在于 gates.js 或 ground-truth.js
- 同 `(run_id, failure_class, trigger_sha, role)` 四元组下不得创建第二个 generator-fix attempt
- evaluator-evidence-repair 的 evidence_digest 未变时同样写 `no_progress_same_evidence` terminal
- no-progress fence 从 decision log 持久化读取，不依赖进程内变量

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/no-progress-fence.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/no-progress-fence.test.js 2>&1 | tail -20
```

---

## [BEHAVIOR] B-04：持久化计数跨进程重启恢复（blockedStreak/pollCount/fixRound）

**描述**：Kernel 重启后，从 DB decision log 重新推导所有计数（blockedStreak、pollCount、fixRound），与重启前推导结果完全一致，进程局部变量不得作为权威。

**实现要求**：
- `deriveCounters(logRows, options)` 已存在于 `packages/brain/src/orchestrator/counters.js`，扩展支持 blockedStreak 和 pollCount 推导
- pollCount = `COUNT(action='wait:poll_ci')` from decision log（当前 counters.js 尚未实现此字段）
- blockedStreak = 尾部连续的 BLOCKED/NEEDS_CONTEXT 行数（类比 noPushStreak 的 tailStreak 逻辑）
- CI pending 30 分钟上限须从 decision log 推导首次 `wait:poll_ci` 的时间戳，不用进程启动时间

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/persistent-counters.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/persistent-counters.test.js 2>&1 | tail -20
```

---

## [BEHAVIOR] B-05：阶段预算独立超时（五个阶段各有 terminal reason）

**描述**：五个阶段各有独立预算，到期写对应 terminal reason；未使用预算可转移给后续阶段；任一阶段均不得突破 120 分钟总预算。

**实现要求**：
- 阶段预算常量存在于 constants.js：planning=10min, gan=20min, generate+fix=45min, evaluate+judge=30min, merge+report=15min
- 各阶段超时 terminal reason：`planning_deadline_exceeded` / `gan_deadline_exceeded` / `generation_deadline_exceeded` / `verification_deadline_exceeded` / `delivery_deadline_exceeded`
- 阶段预算纯函数：`getPhaseDeadline(phase, startedAt, usedBudgetMs)` 返回 `Date`，clock 注入

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/phase-budgets.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/phase-budgets.test.js 2>&1 | tail -20
```

---

## [BEHAVIOR] B-06：worker 预算 min(角色上限, 剩余总预算)

**描述**：每个 worker spawn 前，supervisor deadline 取 `min(角色上限秒数, run 剩余预算秒数)`，禁止固定使用 28800 秒（8 小时）。

**实现要求**：
- `computeWorkerDeadline(role, runStartedAt, nowAt, totalBudgetMs)` 纯函数存在（constants.js 或 gates.js）
- planner/proposer/reviewer/judge 角色上限 = 600 秒；generator/evaluator 角色上限 = 1800 秒
- `codex-supervisor.mjs` 和 `grok-supervisor.mjs` 的 `SUPERVISOR_DEADLINE_SECONDS` 默认值不得为 28800
- worker 超时产生结构化 terminal callback（包含 `timed_out` 状态）

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/worker-budget.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && node --input-type=module <<'EOF'
import { readFileSync } from 'fs';
const src = readFileSync('./scripts/codex-supervisor.mjs', 'utf8');
if (src.includes("'28800'") || src.includes('"28800"')) {
  console.error('FAIL: codex-supervisor still has hardcoded 28800 default');
  process.exit(1);
}
const src2 = readFileSync('./scripts/grok-supervisor.mjs', 'utf8');
if (src2.includes("'28800'") || src2.includes('"28800"')) {
  console.error('FAIL: grok-supervisor still has hardcoded 28800 default');
  process.exit(1);
}
console.log('B-06 supervisor deadline not hardcoded 28800: OK');
EOF
```

---

## [BEHAVIOR] B-07：MAX_FIX_ROUNDS=3 且 MAX_HOPS=60

**描述**：常量文件中 `MAX_FIX_ROUNDS` 必须等于 3，`MAX_HOPS` 必须等于 60。

**实现要求**：
- `packages/brain/src/orchestrator/constants.js` 中 `MAX_FIX_ROUNDS = 3`
- `packages/brain/src/orchestrator/constants.js` 中 `MAX_HOPS = 60`

**验收命令（manual:bash）**：
```bash
cd /workspace && node --input-type=module <<'EOF'
import { MAX_FIX_ROUNDS, MAX_HOPS } from './packages/brain/src/orchestrator/constants.js';
console.assert(MAX_FIX_ROUNDS === 3, `FAIL: MAX_FIX_ROUNDS=${MAX_FIX_ROUNDS}, expected 3`);
console.assert(MAX_HOPS === 60, `FAIL: MAX_HOPS=${MAX_HOPS}, expected 60`);
console.log(`B-07 constants: MAX_FIX_ROUNDS=${MAX_FIX_ROUNDS} MAX_HOPS=${MAX_HOPS} OK`);
EOF
```

---

## [BEHAVIOR] B-08：human-review approval bridge 认证拒绝非法批准

**描述**：approval bridge 必须拒绝旧 SHA、错误 run、重复批准、无 request effect 的批准，不推进 merge。

**实现要求**：
- approval route 校验 `pr_head_sha` 与当前 PR head SHA 一致
- 重复批准（verdict:human_review 已存在）返回 409
- 无 `effect:human_review_requested` 的 run 批准返回 400
- approval bridge 不直接 UPDATE run phase，Kernel 下一轮从 decision log derive

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/approval-bridge.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/approval-bridge.test.js 2>&1 | tail -20
```

---

## [BEHAVIOR] B-09：d707 hop 55-66 不再产生（历史事故回归）

**描述**：使用 d707 hop 55-66 的真实 decision log fixture 回放，新实现不得产生 hop 58-66 的九次重复 generator-fix。

**实现要求**：
- fixture 文件：`sprints/07230920-relay-1b997ed6/tests/fixtures/d707-hops-55-66.json`
- 用 fixture 驱动 derive()，断言在 hop 58 时输出应为 `no_progress_same_sha terminal` 或 `evidence_repair`，不得为 `spawn:generator-fix`

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/d707-replay.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/d707-replay.test.js 2>&1 | tail -20
```

---

## 完整测试套件运行

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/ 2>&1 | tail -40
```

---

## DoD 总结（Definition of Done）

所有 [BEHAVIOR] 条目的测试从红变绿后，才允许 Ready/merge：

| 条目 | 测试文件 | 状态 |
|---|---|---|
| B-01 总预算 120 分钟硬限 | deadline.test.js | 待实现（全红） |
| B-02 failure_class 路由矩阵 | failure-class-routing.test.js | 待实现（全红） |
| B-03 no-progress 熔断 | no-progress-fence.test.js | 待实现（全红） |
| B-04 持久化计数跨重启 | persistent-counters.test.js | 待实现（全红） |
| B-05 阶段预算独立超时 | phase-budgets.test.js | 待实现（全红） |
| B-06 worker 预算 min(角色上限,剩余) | worker-budget.test.js | 待实现（全红） |
| B-07 常量收紧 | manual:bash | 待实现 |
| B-08 approval bridge 认证 | approval-bridge.test.js | 待实现（全红） |
| B-09 d707 历史回归 | d707-replay.test.js | 待实现（全红） |
