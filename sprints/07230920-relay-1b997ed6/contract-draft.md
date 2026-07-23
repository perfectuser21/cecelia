# Contract Draft — Harness Kernel 有界运行与正确恢复

**Task ID**: 1b997ed6-d984-46d4-8336-12bff5a5ba3c  
**Sprint Dir**: sprints/07230920-relay-1b997ed6  
**合同版本**: v2（第二轮修订，基于 reviewer feedback R1）  
**生成日期**: 2026-07-23

---

## 背景

本合同描述 Harness Kernel 有界运行与正确恢复的可验证断言集。PRD 来源：`sprints/07230920-relay-1b997ed6/sprint-prd.md`。

核心问题：d707 生产事故中 Kernel 运行了 529.90 分钟（目标 ≤120 分钟），连续产生 10 次同 SHA generator-fix，judge evidence_invalid 错误地触发了 generator，持久化计数在进程重启后归零。本次 Sprint 修复这 6 类根因。

---

## 受影响文件（预期）

- `packages/brain/src/orchestrator/constants.js` — 收紧 MAX_FIX_ROUNDS、MAX_HOPS、worker budget 常量
- `packages/brain/src/orchestrator/gates.js` — 新增 deadline gate、no-progress gate、failure_class 路由
- `packages/brain/src/orchestrator/derive.js` — failure_class 路由矩阵、no-progress terminal 分支
- `packages/brain/src/orchestrator/counters.js` — 持久化计数推导（blockedStreak/pollCount 跨重启）
- `packages/brain/src/orchestrator/ground-truth.js` — deadline/progress token/attempt lease 真相采集
- `packages/brain/src/orchestrator/loop.js` — 三处 deadline fence（collect 前/derive 后/dispatch 前）
- `packages/brain/src/orchestrator/kernel-handlers.js` — Judge failure_class 解析、evidence digest 计算
- `packages/brain/src/harness-skill-relay.js` — run 120 分钟总 deadline 注入
- `scripts/codex-supervisor.mjs` — SUPERVISOR_DEADLINE_SECONDS 从 28800 降为 min(角色上限, 剩余预算)
- `scripts/grok-supervisor.mjs` — 同上
- `packages/brain/src/orchestrator/__tests__/` — 16 类永久回归测试

---

## 核心断言域一：120 分钟总预算

### 断言 A1：DB timestamp 推导 deadline（纯函数，clock 注入）

`isDeadlineExceeded(startedAt: Date, nowAt: Date, budgetMs: number): boolean`

- `nowAt - startedAt < 120 * 60 * 1000` → `false`（不超时）
- `nowAt - startedAt >= 120 * 60 * 1000` → `true`（超时）
- 函数必须接受注入的 `nowAt`，禁止内部调用 `Date.now()`

### 断言 A2：loop 三处 deadline fence

loop 每轮在以下三个点各做一次 DB 时间预算检查：
1. collect 前：超时则跳过本轮，写 terminal
2. derive 后：derive 返回 spawn action 但剩余预算不足 → 不执行 dispatch，改写 terminal
3. dispatch 前：attempt 创建前最后一道 fence

### 断言 A3：terminal reason 写入

deadline 到达时必须写 `terminal reason: automation_deadline_exceeded`，不得 requeue。

### 断言 A4：human-review 等待不计入预算

`effect:human_review_requested` 写入后，deadline 计时暂停；  
批准后恢复，但仅允许 15 分钟 merge/report 收尾，不得新开 120 分钟周期。

---

## 核心断言域二：failure_class 路由矩阵

### 断言 B1：五种 failure_class 路由

| failure_class | 期望 Kernel action | 允许 generator-fix |
|---|---|---|
| `product_failure` | `spawn:generator-fix` | 是 |
| `evidence_invalid` | `spawn:evaluator-evidence-repair` | 否 |
| `contract_invalid` | `mark_failed` + 创建独立后续任务 | 否 |
| `environment_failure` | 换账号/环境恢复一次；仍失败 → `mark_failed` | 否 |
| `unknown` | `needs_context` 一次；仍未知 → `mark_failed` | 否 |

### 断言 B2：缺 failure_class 视为 unknown

Judge 不返回 `failure_class` → 视为 `unknown`，走 needs_context 分支，不得 `spawn:generator-fix`。

### 断言 B3：evidence_invalid 不得触发 generator

Judge 输出 `failure_class: evidence_invalid` → Kernel 必须派 `spawn:evaluator-evidence-repair`，不得派 `spawn:generator` 或 `spawn:generator-fix`。

### 断言 B4：decision log 写入失败分类元数据

失败分类、触发 SHA、责任角色、下一动作必须写入 decision log，可独立重放。

---

## 核心断言域三：no-progress 熔断

### 断言 C1：generator-fix SHA 未变 → 立即 terminal

generator-fix attempt callback 完成后，`pr_head_sha_new === pr_head_sha_trigger` → 立即写 `no_progress_same_sha`，run 终止，不允许任何重试。

### 断言 C2：同 (run_id, failure_class, trigger_sha, role) 只允许一次

相同四元组 `(run_id, failure_class, trigger_sha, role)` 下不得创建第二个 generator-fix attempt。

### 断言 C3：evidence repair digest 未变 → 立即 terminal

evaluator-evidence-repair callback 完成后，`evidence_digest_new === evidence_digest_trigger` → 立即写 `no_progress_same_evidence`，run 终止。

### 断言 C4：no-progress fence 不可绕过

不允许通过重启 Kernel、创建新 hop、更换 provider 绕过 no-progress fence。fence 必须从 decision log 持久化读取，不依赖进程内变量。

---

## 核心断言域四：持久化计数跨重启恢复

### 断言 D1：blockedStreak 跨重启恢复

Kernel 重启前 blockedStreak=2（由 decision log 记录），重启后重新 `deriveCounters()` 得到 blockedStreak=2，不归零。

### 断言 D2：pollCount 跨重启恢复

CI pending 的计数从 decision log 中 `COUNT(action='wait:poll_ci')` 推导，不依赖进程局部变量。

### 断言 D3：fixRound 跨重启恢复

`fixRound = COUNT(action='spawn:generator-fix' WHERE hop 已去重)`，进程重启前后值相同。

### 断言 D4：相同输入得到相同下一动作

Kernel 重启后，相同 decision log + 相同外部快照（PR SHA、contract.approved 等）→ `derive()` 输出相同 phase/action/reason。

---

## 核心断言域五：阶段预算

### 断言 E1：五阶段预算配置

| 阶段 | 最大时间 | terminal reason |
|---|---:|---|
| planning | 10 分钟 | `planning_deadline_exceeded` |
| contract GAN | 20 分钟 | `gan_deadline_exceeded` |
| generate + fix | 45 分钟 | `generation_deadline_exceeded` |
| evaluate + judge | 30 分钟 | `verification_deadline_exceeded` |
| merge + report | 15 分钟 | `delivery_deadline_exceeded` |

### 断言 E2：未使用阶段预算可转移

阶段 A 提前完成（实际用时 < 阶段预算）→ 剩余时间可被后续阶段使用，但总预算不超过 120 分钟。

### 断言 E3：阶段预算仍受总预算约束

即使某阶段剩余预算充足，若已超过 120 分钟总预算 → 必须 terminal。

---

## 核心断言域六：worker 预算

### 断言 F1：worker 超时取 min(角色上限, 剩余总预算)

- planner/proposer/reviewer/judge 角色上限 = 10 分钟（600 秒）
- generator/evaluator 角色上限 = 30 分钟（1800 秒）
- 实际超时 = `min(角色上限, run 剩余预算)`

### 断言 F2：SUPERVISOR_DEADLINE_SECONDS 不得为 28800

`scripts/codex-supervisor.mjs` 和 `scripts/grok-supervisor.mjs` 的默认 `SUPERVISOR_DEADLINE_SECONDS` 不得等于 28800（8 小时），必须从 run 剩余预算动态计算并注入。

### 断言 F3：worker 超时必须产生结构化 terminal callback

worker 超时后不能仅靠容器消失让 watchdog 猜，必须产生包含 `timed_out` 状态的结构化 callback，Kernel 据此走 timeout 分支。

---

## 收紧上限常量断言

### 断言 G1：MAX_FIX_ROUNDS 降为 3

`constants.js` 中 `MAX_FIX_ROUNDS = 3`（仅统计产生新 SHA 的有效 product fix）。

### 断言 G2：MAX_HOPS 降为 60

`constants.js` 中 `MAX_HOPS = 60`。

### 断言 G3：同错误签名 environment_failure 恢复上限为 1

相同环境错误签名 `environment_failure` 最多恢复 1 次，第二次出现同签名 → `mark_failed`。

### 断言 G4：BLOCKED_SAME_STATE_CAP 降为 2（维持现值）

相同 BLOCKED/NEEDS_CONTEXT 状态连续上限 2 次（现有值维持），不得上调。

---

## E2E 验收

### E2E-1：正常流程 Fire Drill（混合 provider）

**参与角色**：planner=claude/account1, proposer=claude/account1, reviewer=grok/grok, generator=codex/team3, evaluator=claude/account2

**验收标准**（机器可检查）：
1. 从 `initiative_runs.created_at` 到首次写入 `effect:human_review_requested` ≤ 120 分钟（DB timestamp 差值）
2. decision log 中 `COUNT(DISTINCT role)` 覆盖全部 5 种角色
3. `SELECT COUNT(*) FROM orchestrator_decision_log WHERE action='spawn:generator-fix' AND detail->>'trigger_sha' = (SELECT detail->>'trigger_sha' FROM orchestrator_decision_log WHERE action='spawn:generator-fix' ORDER BY hop LIMIT 1)` ≤ 1（同 SHA generator-fix 不超过 1 次）
4. `COUNT(action='spawn:generator-fix')` ≤ 3（product fix 轮数）
5. deadline 写入后 `COUNT(*)` 新 attempt 为 0（deadline 后零新 attempt）
6. Evaluator/Judge verdict 行的 `pr_head_sha` 均与 merge 时的 PR head SHA 一致
7. `verdict:human_review` 行存在，且 `approved_by` 非空

### E2E-2：故障 Fire Drill（no-progress 熔断）

**场景**：Generator 返回 DONE 但 `git log` 无新 commit（PR SHA 不变）

**验收标准**（机器可检查）：
1. decision log 中 `action='spawn:generator-fix'` 行数 = 1
2. 该 attempt callback 完成后 5 分钟内出现 `terminal_reason='no_progress_same_sha'` 行
3. 5 分钟内无新的 `spawn:generator-fix` 行
4. run.phase 终态为 `failed`，`result.reason = 'no_progress_same_sha'`

### E2E-3：Kernel 重启持久化验证

**场景**：在 derive 返回 spawn 后、dispatch 创建 attempt 前，强制重启 Kernel 进程

**验收标准**（机器可检查）：
1. 重启后 `deriveCounters()` 从 DB decision log 读取的 fixRound/blockedStreak 与重启前相同
2. 重启后 `isDeadlineExceeded()` 推导的 deadline 与重启前 DB 记录的 `started_at` 一致，剩余预算不延长
3. 重启后下一个 dispatch 动作与重启前 derive 的动作相同（幂等推导）

---

## 回归对照报告（PR 合并后机器生成）

| 指标 | d707 基线 | 新 fire drill 目标 |
|---|---:|---:|
| 自动执行时间 | 529.90 分钟 | ≤120 分钟 |
| decision-log hops | 66 | ≤60 |
| generator-fix intents | 20 | ≤3 |
| 同 SHA judge-fail fix | 10 连续 | ≤1 |
| deadline 超时后继续运行 | ~50 分钟 | 0 |
| 手工恢复/改 DB | 有 | 0 |

---

## NFR 断言

### NFR-05：向后兼容（harness_runtime:kernel-v1 路由切换）

缺少 `harness_runtime: "kernel-v1"` 的任务不进入 Kernel 新路径，继续走旧 one-session/controller。

**断言**：`packages/brain/src/harness-skill-relay.js` 或 `packages/brain/src/task-router.js` 中存在对 `harness_runtime` 字段的检查：只有 `harness_runtime === "kernel-v1"` 的任务才进入新 Kernel 流程；其他任务由现有路由处理，不受本次修改影响。

双轨并行 E2E 验证（旧路径任务走旧路径）已显式排除于排除范围（见下方）。

### NFR-07：migration 幂等性

**本 Sprint 无 DB schema 变更，NFR-07 N/A。**

本次修复仅变更 JavaScript 业务逻辑文件，不新增或修改任何 PostgreSQL schema、migration 文件或 DB 表结构。现有表（`initiative_runs`、`orchestrator_decision_log`、`harness_attempts`）schema 不变。

### NFR-08：镜像验证（SUPERVISOR_DEADLINE_SECONDS）

`scripts/codex-supervisor.mjs` 和 `scripts/grok-supervisor.mjs` 的 `SUPERVISOR_DEADLINE_SECONDS` 默认值必须从 28800 修改为动态计算值。

**断言**：B-06 的 manual:bash 验收命令检查源文件不含 28800 硬编码。若 Docker 镜像在本 Sprint 内重建，须从镜像内验证实际值（命令见 contract-dod.md NFR-08 节）。若本 Sprint 内不重建镜像，镜像内验证推迟到重建时，源文件断言作为替代保障。

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| B-01 | `../../packages/brain/src/orchestrator/__tests__/deadline.test.js` | 未超时 / 恰好超时 / 函数不依赖 Date.now() | Red commit `__tests__/` 导入不存在的实现 → 全红；Green commit 实现补齐后通过 |
| B-04 | `../../packages/brain/src/orchestrator/__tests__/persistent-counters.test.js` | 空日志 → pollCount=0 / 空日志 → blockedStreak=0 / pollCount 跨进程重启 | 同上 |
| B-05 | `../../packages/brain/src/orchestrator/__tests__/phase-budgets.test.js` | planning 预算 = 10 分钟 / generate_fix 预算 = 45 分钟 | 同上 |
| B-06 | `../../packages/brain/src/orchestrator/__tests__/worker-budget.test.js` | planner 角色上限 = 600 秒 / generator 角色上限 = 1800 秒 | 同上 |
| B-03 | `../../packages/brain/src/orchestrator/__tests__/no-progress-fence.test.js` | 触发熔断 / mark_failed reason=no_progress_same_sha | 同上 |
| B-07 | `../../packages/brain/src/orchestrator/__tests__/failure-class-routing.test.js` | product_failure + fixRound=0 → generator-fix / evidence_invalid 不得产生 spawn:generator / contract_invalid → mark_failed | 同上 |
| B-09 | `../../packages/brain/src/orchestrator/__tests__/d707-replay.test.js` | fixture 文件存在 / hop 58 callback（SHA 未变）后，derive() 输出 mark_failed reason=no_progress_same_sha | 同上 |
| B-10 | `../../packages/brain/src/orchestrator/__tests__/watchdog-boundary.test.js` | watchdogShouldResume / 过期 run watchdog 动作应为 fenced_terminal_cleanup | 同上 |
| B-12 | `../../packages/brain/src/orchestrator/__tests__/deadline-callback-race.test.js` | run 已有 terminal_reason=automation_deadline_exceeded → callback 到达时 derive 输出 noop / deadline 先写入 terminal 后，decision log 中只有一个 terminal 行 | 同上 |
| B-08 | `../../packages/brain/src/orchestrator/__tests__/approval-bridge.test.js` | 所有条件满足 → valid=true / request.prHeadSha 与 context.currentPrHeadSha 不一致 → invalid（stale_sha） | 同上 |

## 边界与排除范围

- **FR-11 回滚路由隔离**：缺少 `harness_runtime: kernel-v1` 的旧路径任务的 E2E 验证不在本 Sprint 自动化范围内（须双轨并行部署环境）。旧路径行为保持不变由 NFR-05 承诺；新路径安全性由 B-01/B-03/B-04/B-07 保证。（此处为显式排除，非静默省略）
- **FR-12 条目 15（deadline 与 callback 竞态）**：已在 B-12 中添加对应 [BEHAVIOR] 断言和测试骨架（deadline-callback-race.test.js）。
- Human Validation / RPA 类验收不在本 Sprint 自动化范围内，需人工确认
- Fire Drill 在 CI-free 环境执行，不依赖 GitHub CI 绿色
- 真实 docker spawn 的行为测试（FR-12 条目 13-14）需要 Docker 环境，CI 中以 stub 代替
- NFR-08 镜像内验证（从实际镜像读取 SUPERVISOR_DEADLINE_SECONDS）：仅当 runner 镜像重建后执行；未重建时以源文件断言（B-06）代替
