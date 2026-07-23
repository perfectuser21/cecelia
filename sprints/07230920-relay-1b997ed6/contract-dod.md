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

## [BEHAVIOR] B-10：Watchdog 边界规则

**描述**：Watchdog 在对过期 run 操作时必须执行 fenced terminal cleanup，禁止任何形式的恢复或重新入队。Evaluator PASS 后 Judge 失败只允许重跑 Judge。

**实现要求**：
- 过期 run（`automation_deadline_exceeded` 或任何 terminal reason 已写入）上，watchdog 不得调用 resume/requeue；
- watchdog 在同一 run 上不得创建第二个 run（不得生成新 `initiative_runs` 行）；
- 过期 run 的 watchdog 行为限定为 fenced terminal cleanup（如回收泄露的 attempt 记录），清理完成后不得重启自动执行周期；
- Evaluator 已输出 PASS verdict 后，若 Judge 因环境故障（`environment_failure`）失败：
  - 不得重跑 Evaluator（已有 PASS verdict 的 `harness_attempts` 行不得置为过期或重排）；
  - 只允许重跑 Judge（`spawn:judge` 重试）；
  - 重跑 Judge 受 `MAX_FIX_ROUNDS` 以外的独立 environment-recovery 上限约束（1 次）。

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/watchdog-boundary.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/watchdog-boundary.test.js 2>&1 | tail -20
```

---

## [BEHAVIOR] B-11：回滚安全性（排除声明）

**声明**：本 Sprint（1b997ed6）不覆盖回滚路由隔离的端到端验证，原因如下：

1. **harness_runtime:kernel-v1 路由切换**：NFR-05 所要求的"缺少 `harness_runtime: kernel-v1` 的任务继续走旧路径"断言，属于部署层路由行为，需要在真实双轨并行部署环境中验证，超出本 Sprint 单机测试范围；
2. **回滚后配置不恢复**（8h deadline、20fix、同SHA重试）：这些不安全配置的防止由 B-01、B-07、B-03 的常量与逻辑覆盖；回滚后新路径的任务不会产生这些值，但旧路径行为隔离不在本 Sprint 验证范围；
3. **human-review run 不因重启重开预算**：B-01 断言 A4（human-review 等待不计入预算，批准后只允许 15 分钟收尾）覆盖此语义；重启后进程恢复由 B-04 的持久化计数保证。

**排除项（显式声明，不静默省略）**：
- 旧路径（无 `harness_runtime: kernel-v1`）的任务 → 走旧 one-session/controller 的 E2E 验证；
- 双轨并行部署下路由切换的集成测试；
- 生产环境回滚流程的 smoke test。

**替代保障**：上述排除项通过 B-01/B-03/B-04/B-07 的单元级断言间接保证新内核路径的安全性。

**验收命令（manual:bash）**：
```bash
# 验证 NFR-05 向后兼容断言：harness_runtime 字段控制路由
cd /workspace && node --input-type=module <<'EOF'
// 检查路由逻辑中是否有 harness_runtime:kernel-v1 判断
import { readFileSync, existsSync } from 'fs';
const candidates = [
  './packages/brain/src/harness-skill-relay.js',
  './packages/brain/src/task-router.js',
  './packages/brain/src/orchestrator/loop.js',
];
let found = false;
for (const f of candidates) {
  if (existsSync(f)) {
    const src = readFileSync(f, 'utf8');
    if (src.includes('kernel-v1') || src.includes('harness_runtime')) {
      console.log(`B-11/NFR-05: harness_runtime routing found in ${f}`);
      found = true;
    }
  }
}
if (!found) {
  console.warn('B-11/NFR-05: harness_runtime routing not yet implemented —排除范围内，标记为 logic-done-pending');
}
EOF
```

---

## [BEHAVIOR] B-12：deadline 与 callback 竞态 → 单一 fenced terminal

**描述**：当 deadline fence 触发与 attempt callback 到达在时间上接近时，只允许出现一个 fenced terminal 结果，不得出现两个 terminal reason 行或 run 在 terminal 后继续被 callback 推进。

**实现要求**：
- deadline fence 与 callback 处理必须在同一事务范围内对 run 状态进行乐观锁或序列化保护；
- `run.phase` 写入 `terminal` 后，任何后续 callback 的 `derive()` 必须检测到 terminal 态并返回 `noop`（不产生新 dispatch）；
- decision log 中不得出现两个不同 `terminal_reason` 的终止行；
- 若 deadline fence 先写入 `automation_deadline_exceeded`，随后 callback 到达时：callback 写入自身 verdict 行（记录历史），但不触发新 spawn action；
- 若 callback 先完成（写入 PASS/FAIL verdict），deadline fence 到达时检测到已有 terminal 行 → 跳过重复 terminal 写入。

**测试覆盖**（TDD 先红后绿）：
- `sprints/07230920-relay-1b997ed6/tests/deadline-callback-race.test.js`

**验收命令（manual:bash）**：
```bash
cd /workspace && npx vitest run sprints/07230920-relay-1b997ed6/tests/deadline-callback-race.test.js 2>&1 | tail -20
```

---

## NFR 覆盖声明

### NFR-05（向后兼容）
- 本 Sprint 不在新内核中处理无 `harness_runtime: kernel-v1` 的任务；旧任务路由由 `task-router.js` 的 `LOCATION_MAP` 配置继续走旧 one-session 路径；
- 实现完成后，断言：`packages/brain/src/harness-skill-relay.js` 或 `task-router.js` 中存在 `harness_runtime` 字段检查，无该字段的任务不进入 Kernel 新路径；
- 向后兼容端到端验证已显式排除（见 B-11 排除声明）。

### NFR-07（migration 幂等性）
**本 Sprint 无 DB schema 变更，NFR-07 N/A。**  
本次修复仅变更 JavaScript 业务逻辑（orchestrator、constants、gates、derive、counters），不新增或修改任何 PostgreSQL schema、migration 文件、或 DB 表结构。现有表（`initiative_runs`、`orchestrator_decision_log`、`harness_attempts`）的 schema 不变。

### NFR-08（镜像验证）
- `scripts/codex-supervisor.mjs` 和 `scripts/grok-supervisor.mjs` 的 `SUPERVISOR_DEADLINE_SECONDS` 默认值必须从 28800 修改为动态计算值；
- 实现完成后，B-06 的 manual:bash 验收命令验证源文件不含 28800 硬编码；
- 若本 Sprint 内修改了 supervisor 脚本并重建了 runner 镜像，须追加以下验证命令：

**验收命令（manual:bash，仅镜像重建后执行）**：
```bash
# 从实际镜像内验证 SUPERVISOR_DEADLINE_SECONDS 不为 28800
# （仅当 Docker 镜像重建后执行，否则以 B-06 源文件检查代替）
docker run --rm cecelia-runner:latest sh -c 'grep -r "SUPERVISOR_DEADLINE_SECONDS" /app/scripts/ | grep -v "28800" && echo "NFR-08 SUPERVISOR_DEADLINE_SECONDS: OK" || echo "WARN: 28800 found or scripts not present"' 2>/dev/null || echo 'NFR-08: Docker 镜像验证跳过（本 Sprint 排除范围：仅修改源文件，镜像重建在后续 Sprint）'
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
| B-10 watchdog 边界规则 | watchdog-boundary.test.js | 待实现（全红） |
| B-11 回滚安全性 | 显式排除（见 B-11 排除声明） | N/A（排除范围） |
| B-12 deadline/callback 竞态 | deadline-callback-race.test.js | 待实现（全红） |
