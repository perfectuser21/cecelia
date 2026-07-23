# Contract Draft — Harness Kernel 有界运行与正确恢复（Sprint 07231527）

**TASK_ID**: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
**Sprint**: 07231527-relay-50170af2
**Version**: 1.0
**Date**: 2026-07-23
**Status**: PROPOSED

---

## 背景与范围

上轮 PR #4220 已被 revert，Codex 独立复审发现 6 条 blocking 缺口：deadline 未接线、持久计数是伪接线、failure_class 路由链断裂、no-progress 熔断不可达、approval bridge 未完整实现、fixRound 计数错误。本合同逐条真实闭合上述缺口。

修改范围：
- `packages/brain/src/orchestrator/constants.js`（MAX_FIX_ROUNDS、MAX_HOPS）
- `packages/brain/src/orchestrator/loop.js`（三道 deadline fence、持久化计数、no-progress trigger_sha 写入）
- `packages/brain/src/orchestrator/derive.js`（5 类 failure_class 差异路由）
- `packages/brain/src/orchestrator/dispatcher.js`（evidence-repair 动作支持）
- `packages/brain/src/orchestrator/kernel-handlers.js`（failure_class 落库传递、approval bridge 完整校验）
- `packages/brain/src/orchestrator/ground-truth.js`（deriveNoProgress 接入、trigger_sha 推导）
- `packages/brain/src/orchestrator/counters.js`（fixRound 只计产生新 SHA 的有效 product fix）
- `packages/brain/src/routes/harness-callback.js`（generator callback 写 verdict:generator-fix-callback + pr_head_sha）
- `packages/brain/src/routes/harness-pending-reviews.js`（approval bridge 完整认证）
- `packages/brain/src/harness-skill-relay.js`（deadline_at 改为 NOW()+120min）
- `packages/brain/src/orchestrator/codex-supervisor.mjs` / `grok-supervisor.mjs`（SUPERVISOR_DEADLINE_SECONDS 不再默认 28800）

---

## Golden Path

### GP-1：evidence_invalid 不进 generator-fix

1. evaluator callback 写入 `failure_class: 'evidence_invalid'`
2. Judge 落库时传递并保留 `failure_class`
3. `derive.js` 识别 `failure_class === 'evidence_invalid'` → 路由 `spawn:evaluator-evidence-repair`
4. generator-fix 不被调用，fixRound 不递增

### GP-2：同 SHA no-progress terminal

1. generator-fix intent 写入 `trigger_sha`（当前 PR head_sha）
2. generator-fix callback 写入 `verdict:generator-fix-callback` + `pr_head_sha`
3. `ground-truth.js` 推导 `deriveNoProgress`：callback SHA === trigger SHA → `no_progress_same_sha`
4. loop 识别 terminal → run.phase = 'failed'，不再派新 fix intent

### GP-3：deadline 120min 全链接通

1. `harness-skill-relay.js` 建 run 时 `deadline_at = NOW() + INTERVAL '120 minutes'`
2. `loop.js` collect 前检查 `deadline fence 1`：`NOW() >= run.deadline_at` → terminal `automation_deadline_exceeded`
3. `loop.js` derive 后 dispatch 前检查 `deadline fence 2`：防止在 deadline 后创建新 attempt
4. `loop.js` 收到 DONE 心跳后检查 `deadline fence 3`：崩溃窗口补丁
5. deadline 触发后写 `automation_deadline_exceeded`，不 requeue

### GP-4：failure_class 路由矩阵全链

| failure_class | 路由动作 |
|--------------|---------|
| product_failure（或 null/缺失） | spawn:generator-fix |
| evidence_invalid | spawn:evaluator-evidence-repair |
| environment_recovery | terminal（second_environment_recovery）|
| needs_context | wait:human_review |
| contract_invalid | mark_failed（已有）|
| unknown | wait:human_review（保守路由）|

### GP-5：持久化计数重启不归零

1. `loop.js` 移除进程内 `pollCount` 作为唯一权威；改从决策日志行推导
2. `wait:poll_ci` 写 decision log（action='wait:poll_ci'），pollCount = COUNT 该 action 行
3. `blockedStreak` 从 DB 推导：统计尾部连续 NEEDS_CONTEXT/BLOCKED 状态行
4. 重启后 deriveCounters 从 DB decision log 恢复，无归零风险

### GP-6：approval bridge 完整认证写 verdict:human_review

1. POST `/api/brain/harness/pending-reviews/:taskId/approve` 须持 `HARNESS_REVIEW_APPROVER_TOKEN`
2. 校验 `taskId`、`reviewRequestHop`、操作者身份、当前 PR head_sha
3. 旧 SHA 批准（PR 已新 push）→ 拒绝（409）
4. 重复批准（已有 verdict:human_review）→ 拒绝（409）
5. 通过后写唯一 `verdict:human_review`，detail 含 `approved: true`、`pr_head_sha`、`approved_by`

### GP-7：fixRound 只计有效 product fix

1. `counters.js` 中 fixRound 计数：只统计 `spawn:generator-fix` 且 callback 中 `pr_head_sha !== trigger_sha`（即产生新 SHA 的 fix）
2. 同 SHA no-progress 不递增 fixRound
3. `MAX_FIX_ROUNDS = 3`（不再是 20）

---

## E2E 验收

### E2E-1：evidence_invalid 路由（集成）

运行 Kernel 编排，注入 evaluator callback 含 `failure_class: 'evidence_invalid'`。

**验收断言**：
- 决策日志中存在 `spawn:evaluator-evidence-repair` 行
- 决策日志中不存在 `spawn:generator-fix` 行
- `fixRound === 0`

**验收命令**：
```bash
cd packages/brain && npx --no-install vitest run \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  -t "failure classification" --reporter=verbose
```

### E2E-2：same SHA no-progress terminal（集成）

运行 Kernel 编排，注入 generator-fix callback，`pr_head_sha` 与 `trigger_sha` 相同。

**验收断言**：
- run.phase = 'failed'
- failure_reason = 'no_progress_same_sha'
- 无新 `spawn:generator-fix` 行

**验收命令**：
```bash
cd packages/brain && npx --no-install vitest run \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  -t "no-progress" --reporter=verbose
```

### E2E-3：120min deadline terminal（集成）

建 run，设 `deadline_at = NOW() - INTERVAL '1 second'`（模拟过期），触发 runLoop。

**验收断言**：
- 返回 `{exitReason: 'automation_deadline_exceeded'}`
- run.phase = 'failed'，failure_reason = 'automation_deadline_exceeded'
- 决策日志无新 spawn intent 行

**验收命令**：
```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js \
  --reporter=verbose
```

### E2E-4：重启持久化计数（集成）

1. 运行 runLoop 跑 3 个 wait:poll_ci 跳后人为退出
2. 重新启动 runLoop（相同 runId）
3. 验证 pollCount 从 DB 恢复，不归零

**验收断言**：
- 第二次启动后 pollCount ≥ 3
- 决策日志中 `wait:poll_ci` 行 ≥ 3

**验收命令**：
```bash
cd packages/brain && npx --no-install vitest run \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  -t "restart recovery" --reporter=verbose
```

### E2E-5：approval bridge fail-closed（manual:bash）

```bash
# 主验收：真实 Express mount + 正式 migrations PostgreSQL + 并发重复批准 + 429
(cd packages/brain && npx --no-install vitest run \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  -t "approval HTTP route" --reporter=verbose)

# 启动生产 router 的一次性本地 Express mount，再用 curl 补验。
port_file="$(mktemp)"
NODE_ENV="test" DB_NAME="cecelia_test" \
  HARNESS_REVIEW_APPROVER_TOKEN="contract-token" PORT_FILE="$port_file" \
  node --input-type=module <<'NODE' &
import express from 'express';
import { writeFileSync } from 'node:fs';
import router from './packages/brain/src/routes/harness-kernel-approvals.js';
const app = express();
app.use(express.json());
app.use('/api/brain/harness/kernel-reviews', router);
const server = app.listen(0, '127.0.0.1', () => {
  writeFileSync(process.env.PORT_FILE, String(server.address().port));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
NODE
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; rm -f "$port_file" "$body_file"' EXIT
for _ in $(seq 1 50); do
  test -s "$port_file" && break
  sleep 0.1
done
test -s "$port_file"
port="$(cat "$port_file")"
body_file="$(mktemp)"
http_code="$(curl -sS -o "$body_file" -w '%{http_code}' -X POST \
  "http://127.0.0.1:${port}/api/brain/harness/kernel-reviews/00000000-0000-4000-8000-000000000000/approve" \
  -H 'x-approver-token: wrong-token' \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"00000000-0000-4000-8000-000000000001","pr_head_sha":"stale","review_request_hop":1,"approved_by":"contract-test"}')"
test "$http_code" = "401"
jq -e '.error == "invalid approver token"' "$body_file" >/dev/null
kill "$server_pid"
wait "$server_pid"
rm -f "$port_file" "$body_file"
trap - EXIT
```

### E2E-6：d707 hop 55-66 replay 不产生重复 fix

使用真实 d707 decision log fixture 重放 hop 55-66。

**验收断言**：
- hop 58-66 不产生 9 次 `spawn:generator-fix` 行
- 在 hop 56（evidence_invalid）时路由到 `spawn:evaluator-evidence-repair`
- 在 hop 57（same SHA no-progress）时 terminal

**验收命令**：
```bash
cd packages/brain && npx --no-install vitest run \
  ../../tests/regression/relay-50170af2/d707-replay.test.js \
  --reporter=verbose
```

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| B-01 failure_class 路由 | `../../tests/regression/relay-50170af2/kernel-failure-class-routing.test.js` | T-01-a/T-01-b/T-10-a/T-10-b/T-11-a/T-13-a/T-13-b | 先红：derive 无 evidence_invalid 分支 |
| B-02 no-progress terminal | `../../tests/regression/relay-50170af2/kernel-no-progress.test.js` | T-02-a/T-02-b/T-03-a/T-03-b | 先红：derive 未识别 noProgress=true |
| B-02 no-progress 集成 | `../../tests/regression/relay-50170af2/kernel-no-progress-integration.test.js` | T-NP-INT-01/T-NP-INT-02/T-NP-INT-03/T-NP-INT-04 | 先红：ground-truth 不推导 noProgress |
| B-03 deadline fence | `../../tests/regression/relay-50170af2/kernel-deadline.test.js` | T-05/T-06/T-07 | 先红：loop 无三道 deadline fence |
| B-05 持久化计数 | `../../tests/regression/relay-50170af2/kernel-persistent-counters.test.js` | T-08-a/T-08-b/T-08-c/T-08-d/T-09 | 先红：wait:poll_ci 不写 decision log |
| B-06 approval bridge | `../../tests/regression/relay-50170af2/kernel-approval-bridge.test.js` | T-17-a/T-17-b/T-17-c/T-17-d/T-17-e/T-17-f | 先红：bridge 无 SHA 锚定校验 |
| B-08 d707 replay | `../../tests/regression/relay-50170af2/d707-replay.test.js` | T-04-a/T-04-b/T-04-c/T-04-d/T-04-e | 先红：d707 10次 fix 无熔断 |
| 真 PostgreSQL 接缝 | `../../packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js` | blocked/needs-context/poll 重启、failure_class、callback no-progress、approval 并发与 429 | 先红：callback 404、并发 loser 500、突发请求无 429 |

## 禁 mock 边清单

以下边界属于本合同的正确性核心，在
`packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js`
中禁止 mock，并由一次性数据库跑正式 000~357 migrations 后验证：

- **DB decision log**：`orchestrator_decision_log` 的真实 PostgreSQL INSERT、JSONB、UNIQUE、advisory lock、回读与 append-only 约束。
- **loop ↔ derive ↔ dispatch ↔ callback**：使用真实 `runLoop`、`collectGroundTruth`、`deriveCounters`、`derive`、真实 HTTP callback handler 与真实 `createAttemptStore`；禁止直接注入 `noProgressSameSha`。
- **approval auth/mount/DB**：使用真实 Express router mount、`authenticateApprover`、PostgreSQL transaction/lock/decision-log；并发两个合法批准必须只有一个 202 和一行 verdict。
- **重启恢复**：实例 A/B 使用同 `run_id` 和同一 PostgreSQL 数据库重新构造；禁止用进程内数组伪造 blockedStreak/pollCount。

仅以下最外层、CI 不可用的外部副作用允许替身：

- GitHub `gh pr view` / CI rollup 观测；
- Docker 容器/PID 列举；
- generator provider 的实际进程启动。

## 不变量约束（全量引用）

继承 PRD 中 Brain DB 17 条 + 现有 sprint 7 条（INV-K1 ~ INV-K7）共 24 条，全部适用。

关键铁律：
- **INV-K1**：collect 前、derive 后、dispatch 前三道 deadline fence，缺一不可
- **INV-K2**：deadline 到达后写 `automation_deadline_exceeded`，不得 requeue
- **INV-K3**：Judge 缺 failure_class → unknown，禁止默认归为产品代码失败
- **INV-K4**：no-progress 后禁止对相同 (run_id, failure_class, trigger_sha, role) 再派 generator-fix
- **INV-K5**：cap / streak / progress token 从 DB/decision log 推导，不用进程内变量作为权威
- **INV-K6**：evidence_invalid 修 attempt evidence；新 evidence digest 必须变化
- **INV-K7**：approval bridge 必须校验 task/run、PR SHA、review_request_hop 和操作者；旧 SHA/重复批准必须拒绝

---

## 回滚策略

- `harness_runtime !== 'kernel-v1'` 的任务走旧 one-session/controller 路径，零影响
- 本合同变更全在 orchestrator/ 模块内，不触及 LangGraph 图

---

## 依赖

- DB migration（如需）：无新表，decision log 写入新 action 类型 `spawn:evaluator-evidence-repair`、`wait:poll_ci`（持久化）、`verdict:generator-fix-callback`
- 环境变量：`HARNESS_REVIEW_APPROVER_TOKEN`（已在部署环境配置）
