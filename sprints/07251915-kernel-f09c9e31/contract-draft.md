# Sprint Contract Draft (Round 15)

## Notes

- contract-gate: present at `packages/brain/src/lib/contract-gate.js`.
- Registry scan: api/db/test registry reachable but stale by about 165h; contract uses PRD literal scope plus current source/tests as authority.
- context-manifest: unavailable (`GET /api/brain/line/741d4acc-9ca8-4545-a971-efa12fce8150/context-manifest` returned HTML 404), so no cumulative FR beyond PRD text.
- 本 sprint 是 Kernel Harness hotfix；不得创建第二账本，不得写生产数据库，不得自动 merge。
- Round 2 revision: 补齐 Brain restart 的 PRD/PR/合同三里程碑单调恢复红测、GitHub PR 真调用 E2E oracle、Test Contract 全行为映射与版本同步脚本断言。
- Round 3 refresh: 保持 Round 2 APPROVED 合同范围不扩张；重新跑确定性格式自查与 Contract Gate，确认可交付给 evaluator。
- Round 4 refresh: 本轮未收到新的 reviewer 反馈 artifact；继续保留 PRD 字面范围与现有 Red 测试池，不扩张 scope，仅刷新 proposer 分支与结果协议。
- Round 5 refresh: 本轮仍未收到新的 reviewer 反馈 artifact；继续复用 Round 4 合同范围，已重新跑确定性格式自查与 Contract Gate。Red 证据受本地 PostgreSQL 未启动影响为 `ECONNREFUSED 127.0.0.1:5432`，说明合同红测依赖真实 PG 边且未 mock。
- Round 6 refresh: 本轮 artifacts 仍为空；继续复用已批准合同的 PRD 字面范围与真实 PG/GitHub 接缝，不扩张 scope，仅刷新 proposer 分支与结果协议。确定性自查与 Contract Gate 均通过；Red 证据仍为本地 PostgreSQL 未启动导致的 `ECONNREFUSED 127.0.0.1:5432`，证明红测未 mock 被改 DB 边。
- Round 7 refresh: 本轮 task_bundle artifacts 为空且无新增 reviewer 反馈；继续复用 Round 6 的 PRD 字面覆盖、真实 PG 接缝、GitHub PR 真调用补位与单 workstream task-plan，不扩张 scope，仅刷新 proposer 分支与结果协议。registry/context-manifest 状态重新核对：registry 可达但 stale，context-manifest 仍为 404；DoD 中同步 vitest/gh/源码扫描断言的预期观察改为“命令退出时”，避免把非异步断言误写成 `within` 等待预算。确定性自查与 Contract Gate 均通过；Red 证据仍为本地 PostgreSQL 未启动导致的 `ECONNREFUSED 127.0.0.1:5432`，证明红测未 mock 被改 DB 边。
- Round 8 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 7 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位与单 workstream task-plan，不扩张 scope。重新核对 registry/context-manifest：registry 可达但 stale，context-manifest 仍为 404；确定性自查与 Contract Gate 均通过；Red 证据仍为本地 PostgreSQL 未启动导致的 `ECONNREFUSED 127.0.0.1:5432`，证明红测未 mock 被改 DB 边。本轮仅刷新 proposer 分支与结果协议。
- Round 9 refresh: 本轮 task_bundle artifacts 为空且未提供新的 reviewer 反馈；继续保持 Round 8 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不新增 PRD 外场景。重新核对 registry/context-manifest：registry 可达但 stale，context-manifest 仍为 404；确定性自查与 Contract Gate 均通过；Red 证据仍为本地 PostgreSQL 未启动导致 6 个测试 `ECONNREFUSED 127.0.0.1:5432`，证明红测未 mock 被改 DB 边。本轮仅刷新 proposer 分支与结果协议。
- Round 10 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 9 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不扩张 scope。registry/context-manifest 已重新核对：registry 可达但 stale，context-manifest 仍为 404；确定性自查与 Contract Gate 均通过；Red 证据仍为本地 PostgreSQL 未启动导致 6 个测试 `ECONNREFUSED 127.0.0.1:5432`，证明红测未 mock 被改 DB 边。本轮仅刷新 proposer 分支与结果协议。
- Round 11 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 10 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不扩张 scope。registry/context-manifest 已重新核对：registry 可达但 stale，context-manifest 仍为 404；确定性自查与 Contract Gate 均通过；Red 证据仍为本地 PostgreSQL 未启动导致 6 个测试 `ECONNREFUSED 127.0.0.1:5432`，证明红测未 mock 被改 DB 边。本轮仅刷新 proposer 分支与结果协议。
- Round 12 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 11 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不扩张 scope。registry 已重新核对：api/db/test registry 可达但 `scanned_at=2026-07-18T15:50Z` 仍 stale，context-manifest 仍为 HTML 404；本轮仅刷新 proposer 分支与结果协议。
- Round 13 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 12 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不扩张 scope。registry 已重新核对：api/db/test registry 可达但 `scanned_at=2026-07-18T15:50Z` 仍 stale，context-manifest 仍为 HTML 404；本轮仅刷新 proposer 分支与结果协议。
- Round 14 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 13 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不扩张 scope。本轮修正 Step 6 验证命令引用的本仓库真实 quickcheck 路径为 `scripts/quickcheck.sh`，避免旧 devgate quick-check 别名不存在造成假失败；结果协议刷新到 `cp-harness-propose-r14-f09c9e31-a43`。
- Round 15 refresh: 本轮 task_bundle artifacts 仍为空且未提供新的 reviewer 修订点；继续保持 Round 14 合同的 PRD 字面覆盖、真实 PostgreSQL 被改边、GitHub PR 真调用补位、单 workstream task-plan 与失败语义，不扩张 scope。registry/context-manifest 已重新核对：api/db/test registry 可达但 `scanned_at=2026-07-18T15:50Z` 仍 stale，context-manifest 仍为 HTML 404；本轮仅刷新 proposer 分支与结果协议到 `cp-harness-propose-r15-f09c9e31-a46`。

## Response Schema（推导来源: N/A）

N/A - 任务无新增 HTTP 响应。验收对象是 Kernel run bootstrap、DB 真相恢复、orchestrator derive 决策与真实回归测试。

**禁用字段名**: `contract_branch`（migration 312 明确不加，branch 只存在于 `initiative_contracts.branch`）

## 已知约束（来自回归测试）

- [packages/brain/src/orchestrator/__tests__/contract-store.test.js] -> `upserts the approved version, supersedes older versions, and attaches the run atomically`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] -> `watchdog 只能 reclaim 已过期的同一个非终态 attempt`
- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js] -> `resume 只允许同一个 attempt；同角色的新 attempt 也不能偷用旧 session`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] -> `contract status=draft -> approved:false；contract_id 为空且无同 initiative/task approved contract 时 approved:false`；本 sprint 新增跨 run approved contract 继承后不得回退旧语义。
- [packages/brain/src/orchestrator/__tests__/derive.test.js] -> `双 PASS && review_required && 未批准 -> wait:human_review`
- [packages/brain/src/orchestrator/__tests__/counters.test.js] -> counters 从 append-only decision log 推导，不使用进程内计数作为恢复真相
- [packages/brain/src/orchestrator/__tests__/loop.test.js] -> `persist_contract_approval 落库 initiative_contracts`
- [packages/brain/src/__tests__/harness-kernel-resume-secret.test.js] -> `轮换 hash 后只把新明文交给恢复容器`
- [累积FR] context-manifest: unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 同一 initiative/task 的后续 Kernel run 从 DB/GitHub 结构化真相继承 approved contract、PRD/PR/合同里程碑、attempt 与失败签名，避免重复 Planner/Reviewer/Generator。 |
| **NFR（做得多好）** | 非功能需求 | approved contract 继承与 run bootstrap 在一个事务内完成；恢复必须幂等；两 run、Brain restart、orphan running、跨 run 同签名回归均可复跑。 |
| **Invariant（永不违反）** | 不变量 | 不新增第二账本；只复用 `initiative_contracts`、`harness_attempts`、`orchestrator_decision_log`；不从 Agent 自然语言猜状态；不削弱既有合同测试。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 生命周期 | 该 hotfix 随 Kernel v2 durable resume 机制生效；若未来替换 orchestrator ledger，需新 decision 明确迁移并保留回放兼容。 |
| **死亡告警（停了谁知道）** | 停止工作后的发现方式 | 回归池红、decision log 出现重复 proposer/reviewer/generator intent、harness_attempts 同 provider_session 被复用、或 run failure_reason 结构化写入时由现有 harness watch/CI 暴露。 |
| **失败语义（挂了怎么办）** | 故障策略 | 不能恢复结构化真相时进入等待人工或 FAILED；不能创建第二 attempt 悄悄续跑；同签名跨 run 重现不得再派 generator。 |
| **效果确认（已发不等于已生效）** | 回执方式 | 以 DB 行、GitHub PR state/head_sha/statusCheckRollup、provider_session_id、decision log action/detail 为回执；不采信自然语言总结。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| approved contract 是否可继承 | A. 最新 `initiative_contracts.status='approved'` + version 最大; B. 当前 run 自带 contract_id | A 优先并在事务内写回当前 run | PRD 要求后续 run 继承最新 approved contract | 重复 proposer/reviewer，GAN 烧轮次 |
| PRD/PR/合同里程碑是否已确认 | A. 文件/PR 当前可见; B. `orchestrator_decision_log.observed` 与 GitHub 真相回放 | B + GitHub 真相 | Brain restart 可能看不到本地 worktree，但日志是 append-only | 已确认里程碑降级，重复派 planner/generator |
| expired lease 是否应 resume | A. provider session 存在即 resume 原 attempt; B. 直接开新 attempt | A | `harness_attempts.provider_session_id` 是 provider 续会话结构化真相 | 同一角色双 attempt、回调乱序 |
| ⚠️ 跨 run 同根因是否可再派 generator | A. 只看当前 run; B. 同 task/initiative 历史结构化 failure_signature 回放 | B | PRD 明确跨 run 去重 | Generator 反复重派、成本失控、隐藏真实阻塞 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 后续 run 找不到 approved contract | 不标 approved，不派 generator；保持 GAN 正常路径或等待人工核查 | 是，按 run/task 重读 DB | 不猜成功 |
| run bootstrap 事务失败 | 不创建半截 run；回滚 task claim 或结构化失败 | 是，重试同 task 不增加重复角色派发 | 写 failure_reason |
| expired lease 有 provider session | reclaim 原 attempt 并 resume 原 provider session | 是，attempt_id/provider_session 唯一 | 不创建新 attempt |
| expired lease 无 provider session | 先结构化终结原 attempt，再从 DB/GitHub 真相推导下一状态 | 是，终态写入幂等 | 不能确认则 wait:human_review 或 FAILED |
| 跨 run 同结构化根因再现 | 不再派 generator | 是，failure_signature key 去重 | wait:human_review 或 FAILED |

### 输入对抗面（对外暴露 agent 必填）

N/A - 本 sprint 不新增对外用户输入 agent。风险输入是已有 provider/agent 的结构化 callback 与 GitHub/DB 真相；合同要求只读结构化字段，不从自然语言推断状态。

## 真实调用方请求 shape

本 sprint 无新增第三方 webhook。真实调用方 shape 是 Kernel run 启动与恢复的既有本地调用：

```bash
node packages/brain/src/orchestrator/run.js --task-id <uuid> --run-id <uuid>
```

关键字段与认证：

- `taskId`: CLI 参数 `--task-id`，来自 `tasks.id`。
- `runId`: CLI 参数 `--run-id`，来自 `initiative_runs.id`。
- DB 真相来源: `initiative_contracts`、`harness_attempts`、`orchestrator_decision_log`、`initiative_runs`、GitHub PR state/head_sha/statusCheckRollup。
- 禁止替代 shape: body 传 `tenant_id`、自然语言状态总结、或新增 `contract_branch` ledger。

## 未覆盖真实链路清单

| 链路点 | 当前合同处理 | 真验证补位计划 |
|--------|--------------|----------------|
| GitHub PR state/head_sha/statusCheckRollup | Sprint 红测用注入的 `execCmd` 返回隔离 PR JSON，避免 Red 阶段依赖真实 PR；该 mock 只覆盖更外层 GitHub CLI，不覆盖被改 DB/Kernel 边。 | DoD 与 final E2E 必须在实现 PR 分支执行真实 `gh pr view "$CURRENT_BRANCH" --json url,state,headRefOid,statusCheckRollup`，断言 PR 为 OPEN、head SHA 与 CI rollup 可解析。 |

## 禁 mock 边清单

- `harness-skill-relay` run bootstrap ↔ `initiative_runs` / `initiative_contracts`（本单改 run 创建时的合同继承，测试必须真 Postgres 事务验证）。
- `ground-truth` ↔ `initiative_contracts` / `harness_attempts` / `orchestrator_decision_log`（本单改跨 run 恢复真相，测试必须真表读取，不 mock 被改 DB 边）。
- `derive` / `counters` ↔ append-only `orchestrator_decision_log` 回放（本单改跨 run 去重，测试必须用结构化 decision log 行，不用自然语言）。
- `attempt-store` / watchdog resume ↔ `harness_attempts.provider_session_id`（本单改 expired lease/orphan running 恢复，测试必须真唯一约束与 lease 字段）。

## 接缝清单

- DB 事务接缝: 后续 run 创建与 approved contract 继承必须同事务完成；用真实 Postgres temp schema 断言 `initiative_runs.contract_id` 指向最新 approved row。
- Provider session 接缝: expired lease 有 session 时必须 resume 原 attempt；用真实 `harness_attempts` lease/session 行和 launcher 结果断言无新 attempt。
- GitHub/PR 真相接缝: PR head_sha、CI rollup 与 decision log 必须逐字段对齐；Sprint 红测可注入隔离 `execCmd`，最终 E2E 必须真跑 `gh pr view`，不从 callback 文本猜。

## Golden Path

独立小路（无父路）

[后续 run/Brain restart] -> [事务继承 approved contract] -> [单调恢复 PRD/PR/合同里程碑] -> [reclaim/resume 原 attempt 或结构化终结] -> [跨 run 同签名去重] -> [唯一出口：继续执行 / wait:human_review / FAILED]

### Step 1: 后续 run 事务继承最新 approved contract

**来源**: `[FROM_PRD]` - PRD Golden Path 第 1 步。

**可观测行为**: 同一 initiative/task 的新 run 创建后，`initiative_runs.contract_id` 指向 version 最大的 approved `initiative_contracts.id`，`initiative_contracts.branch` 保留 approved propose branch；derive 看到 `contract.approved=true`，不再派 proposer/reviewer。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "后续 run 继承 latest approved contract" --reporter=verbose
```

**硬阈值**: 测试 exit 0；新 run contract_id 等于最新 approved contract id；derive action 不属于 `spawn:proposer` 或 `spawn:reviewer`。

### Step 2: 已确认 PRD/PR/合同里程碑单调恢复

**来源**: `[FROM_PRD]` - PRD Golden Path 第 2 步与 Brain restart 边界情况。

**可观测行为**: Brain restart 或 worktree 暂不可见时，不把已确认 PRD/PR/contract 降级；恢复结果与不中断基线一致。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "Brain restart 后 PRD/PR/合同里程碑单调恢复" --reporter=verbose
```

**硬阈值**: 测试 exit 0；`observed.contract.approved=true`；`observed.pr.url/head_sha/ci` 来自结构化 PR URL + GitHub 真相；恢复后的 decision.action 与不中断基线一致且不为 `spawn:planner/proposer/reviewer`。

### Step 3: expired lease/orphan running 优先 reclaim+resume 原 attempt

**来源**: `[FROM_PRD]` - PRD Golden Path 第 3 步。

**可观测行为**: `harness_attempts.status in ('starting','running')` 且 lease 过期、有 `provider_session_id` 时，watchdog 只 reclaim 原 attempt 并 resume 同 provider session；不得插入新 attempt。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "expired lease 有 provider session 时恢复原 attempt" --reporter=verbose
```

**硬阈值**: 测试 exit 0；同一 run 的 `harness_attempts` 行数不增加；原 attempt lease_owner 更新且 provider_session_id 不变。

### Step 4: 无 provider session 时先结构化终结再推导

**来源**: `[FROM_PRD]` - PRD Golden Path 第 4 步。

**可观测行为**: 原 attempt 没有 provider session 时，系统先写结构化终态 `failed/cancelled` 与 error_code，再从 DB/GitHub 真相推导下一状态；不得直接开新 attempt 掩盖 orphan。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "无 provider session 时先结构化终结 orphan attempt" --reporter=verbose
```

**硬阈值**: 测试 exit 0；orphan attempt 有终态和 error_code；后续 decision 来自 DB/GitHub 结构化字段。

### Step 5: 跨 run 同结构化根因去重

**来源**: `[FROM_PRD]` - PRD Golden Path 第 5 步。

**可观测行为**: 同一 task/initiative 的相同 `failure_signature` 或 failure_set 跨 run 再现时，derive 不再派 generator/generator-fix；出口为 `wait:human_review` 或 `mark_failed`。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "跨 run 同结构化 failure signature" --reporter=verbose
```

**硬阈值**: 测试 exit 0；重复签名场景 dispatch 计数中 generator 不增加；decision action 为 `wait:human_review` 或 `mark_failed`。

### Step 6: 只复用既有账本并保持版本账本同步

**来源**: `[FROM_PRD]` - PRD Golden Path 第 6 步、范围限定与 NFR。

**可观测行为**: 实现只触达既有表；Brain 源码变化同步 `DEFINITION.md` 与四处版本账本；既有合同测试未削弱。

**验证命令**:

```bash
bash scripts/quickcheck.sh || exit 1
bash scripts/check-version-sync.sh || exit 1
node -e "const fs=require('fs');const pkg=require('./packages/brain/package.json').version;const v=fs.readFileSync('packages/brain/VERSION','utf8').trim();if(v!==pkg){console.error('FAIL: packages/brain/VERSION mismatch');process.exit(1)}"
BAD_DIFF="$(git diff --name-only origin/main...HEAD | awk '!/^(packages\/brain\/src\/|packages\/brain\/VERSION$|packages\/brain\/package\.json$|packages\/brain\/package-lock\.json$|DEFINITION.md$|\\.brain-versions$|sprints\/07251915-kernel-f09c9e31\/|packages\/brain\/src\/orchestrator\/__tests__\/|packages\/brain\/src\/__tests__\/)/ { print }')"
[ -z "$BAD_DIFF" ] || { echo "FAIL: scope drift"; echo "$BAD_DIFF"; exit 1; }
```

**硬阈值**: quick-check exit 0；`scripts/check-version-sync.sh` exit 0；`packages/brain/VERSION` 等于 `packages/brain/package.json`；diff 不出现第二账本/metrics UI/provider capability 相关文件。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/07251915-kernel-f09c9e31}"
export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_test}"

START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "kernel durable resume E2E start ${START_TS}"

npx vitest run "${SPRINT_DIR}/tests/kernel-durable-resume.test.ts" --reporter=verbose

CURRENT_BRANCH="$(git branch --show-current)"
PR_JSON="$(gh pr view "${CURRENT_BRANCH}" --json url,state,headRefOid,statusCheckRollup)"
echo "${PR_JSON}" | jq -e '.state == "OPEN" and (.url | type == "string" and startswith("https://github.com/")) and (.headRefOid | type == "string" and length >= 7) and (.statusCheckRollup | type == "array")'

(
  cd packages/brain
  npx vitest run \
    src/orchestrator/__tests__/contract-store.test.js \
    src/orchestrator/__tests__/attempt-store.test.js \
    src/orchestrator/__tests__/ground-truth.test.js \
    src/orchestrator/__tests__/derive.test.js \
    src/orchestrator/__tests__/counters.test.js \
    src/orchestrator/__tests__/loop.test.js \
    src/__tests__/harness-kernel-resume-secret.test.js \
    --reporter=verbose
)

node - <<'NODE'
const fs = require('fs');
const paths = [
  'packages/brain/src/orchestrator/contract-store.js',
  'packages/brain/src/orchestrator/ground-truth.js',
  'packages/brain/src/orchestrator/counters.js',
  'packages/brain/src/orchestrator/derive.js',
  'packages/brain/src/orchestrator/attempt-store.js',
  'packages/brain/src/harness-skill-relay.js',
];
for (const path of paths) {
  if (!fs.existsSync(path)) {
    console.error(`FAIL: missing ${path}`);
    process.exit(1);
  }
}
const forbidden = ['contract_branch', 'natural language status'];
const source = paths.map((path) => fs.readFileSync(path, 'utf8')).join('\n');
for (const token of forbidden) {
  if (source.includes(token)) {
    console.error(`FAIL: forbidden token ${token}`);
    process.exit(1);
  }
}
console.log('OK: existing Kernel modules present and no forbidden ledger token');
NODE

bash scripts/check-version-sync.sh
node -e "const fs=require('fs');const pkg=require('./packages/brain/package.json').version;const v=fs.readFileSync('packages/brain/VERSION','utf8').trim();if(v!==pkg)process.exit(1);console.log('OK: Brain VERSION sync')"

echo "OK kernel durable resume E2E"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Kernel durable resume | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 后续 run 继承 latest approved contract | 当前实现新 run `contract_id` 为空，测试失败 |
| Kernel durable resume | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | ground truth 从历史 approved contract 恢复当前 run | 当前 `collectGroundTruth` 在 run.contract_id 为空时返回 approved:false，测试失败 |
| Kernel durable resume | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | Brain restart 后 PRD/PR/合同里程碑单调恢复 | 当前 `collectGroundTruth` 不从结构化 decision log 恢复 PR URL 与 approved contract，决策会降级 |
| Kernel durable resume | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 跨 run 同结构化 failure signature | 当前 derive 只看当前 run，仍会派 generator-fix，测试失败 |
| Kernel durable resume | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | expired lease 有 provider session 时恢复原 attempt | 当前合同锁定不得插入新 attempt，防止未来恢复逻辑回归 |
| Kernel durable resume | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 无 provider session 时先结构化终结 orphan attempt | 当前合同锁定无 session 失败语义，防止直接新建 attempt |
