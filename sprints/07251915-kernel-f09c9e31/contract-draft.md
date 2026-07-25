# Sprint Contract Draft (Round 26)

## Notes

- contract-gate: present at `packages/brain/src/lib/contract-gate.js`.
- Registry scan: api/db/test registry reachable but stale by about 167h; contract uses PRD literal scope plus current source/tests as authority.
- context-manifest: unavailable (`GET /api/brain/line/741d4acc-9ca8-4545-a971-efa12fce8150/context-manifest` returned HTML 404), so no cumulative FR beyond PRD text.
- 本 sprint 是 Kernel Harness hotfix；不得创建第二账本，不得写生产数据库，不得自动 merge。
- Round 26 revision: 只修 reviewer r25 唯一阻塞；transaction probe 逐条记录 `pool` / `txClient` channel 与 client identity，强制 approved SELECT、task milestone UPDATE、initiative_run INSERT 全部通过同一个 `connect()` 返回 client 且位于其 BEGIN/COMMIT 或 BEGIN/ROLLBACK 内。错误的 `pool.query` 业务 SQL 立即令 Red 测试失败；其余合同范围与断言保持不变。

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
| **FR（做什么）** | 功能需求 | 同一 initiative/task（本任务中 `initiative_id=task.id`，`journey_id` 仅是独立归属字段）的后续 Kernel run 通过稳定导出 `recoverDurableRun` 从 DB/GitHub 结构化真相继承 approved contract、PRD/PR/合同里程碑、attempt 与失败签名，避免重复 Planner/Reviewer/Generator。 |
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
| approved contract 是否可继承 | A. 当前 `task.id` 对应 initiative 下最新 `initiative_contracts.status='approved'` + version 最大; B. 全局或 journey 下最新合同 | A 并在生产 bootstrap 自有事务内写回当前 run | 仓库 SSOT 定义 `initiative_id=task.id`，`journey_id` 不参与合同 scope | 跨任务误继承或重复 proposer/reviewer |
| PRD/PR/合同里程碑是否已确认 | A. 文件/PR 当前可见; B. `orchestrator_decision_log.observed` 与 GitHub 真相回放 | B + GitHub 真相 | Brain restart 可能看不到本地 worktree，但日志是 append-only | 已确认里程碑降级，重复派 planner/generator |
| expired lease 是否应 resume | A. provider session 存在即 resume 原 attempt; B. 直接开新 attempt | A | `harness_attempts.provider_session_id` 是 provider 续会话结构化真相 | 同一角色双 attempt、回调乱序 |
| ⚠️ 跨 run 同根因是否可再派 generator | A. 只看当前 run; B. 同 task/initiative 历史结构化 failure_signature 回放 | B | PRD 明确跨 run 去重 | Generator 反复重派、成本失控、隐藏真实阻塞 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 后续 run 找不到当前 task 的 approved contract | `contract_id` 保持 NULL，首轮继续既有 GAN 路径；其他 task/journey 的合同不得继承 | 是，按 `task.id` 重读 DB | 不猜成功、不跨 scope |
| run bootstrap 事务失败 | 生产函数自己 `ROLLBACK` approved 选择、task payload 更新与 run INSERT，不留下半截 run/半写 payload | 是，重试同 task 不增加重复角色派发 | 原错误向上抛出 |
| expired lease 有 provider session | reclaim 原 attempt 并 resume 原 provider session | 是，attempt_id/provider_session 唯一 | 不创建新 attempt |
| expired lease 无 provider session | 先结构化终结原 attempt，再从 DB/GitHub 真相推导下一状态 | 是，终态写入幂等 | 不能确认则 wait:human_review 或 FAILED |
| 跨 run 同结构化根因再现 | 不再派 generator | 是，failure_signature key 去重 | wait:human_review 或 FAILED |
| 跨 run 首次出现不同结构化根因 | 保留现有首次修复路径 | 是，新 signature 只允许一次 `spawn:generator-fix` | 不得被旧 signature 去重门误杀 |

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
- `initiativeId`: 字面等于当前 `tasks.id`（`f09c9e31-ed78-4af4-a1b6-88241bc486c5`），不得用 `journey_id` 或全局 latest contract 替代。
- `journeyId`: 来自 `tasks.payload.journey_id`（`741d4acc-9ca8-4545-a971-efa12fce8150`），只写入 `initiative_runs.journey_id`，不作为合同隔离键。
- DB 真相来源: `initiative_contracts`、`harness_attempts`、`orchestrator_decision_log`、`initiative_runs`、GitHub PR state/head_sha/statusCheckRollup。
- 禁止替代 shape: body 传 `tenant_id`、自然语言状态总结、或新增 `contract_branch` ledger。

## 稳定恢复原语

- **模块/导出**: `packages/brain/src/orchestrator/durable-resume.js` 的命名导出 `recoverDurableRun(input)`；Commander Phase 1/2 只能复用该入口，不复制恢复状态机。
- **结构化输入**: `{ pool, taskId, runId, leaseOwner, leaseSeconds, providerRegistry, launchResume, execCmd, fileExists, readFile, readAuthCircuit }`。`pool` 是既有 PostgreSQL 连接；`providerRegistry` 必须解析既有 adapter；`launchResume({ attempt, spec })` 只负责执行 adapter 生成的 resume spec。
- **结构化输出**:
  - 有 session: `{ outcome: "resumed", attempt_id, provider_session_id, launch_result }`，其中 `attempt_id/provider_session_id` 与原行一致；
  - 无 session 或无 orphan: `{ outcome: "reconciled", terminated_attempt_id, error_code, decision: { phase, action, reason } }`，`terminated_attempt_id/error_code` 无需终结时可为 `null`。
- **失败语义**: DB 事务、provider 解析、adapter resume 或 launcher 失败必须 reject 并保留结构化错误；不得吞错、不得插入替代 attempt、不得新增账本。无 session 时必须先幂等写 `failed + orphan_without_provider_session`，再调用既有 `collectGroundTruth + derive`。

## 未覆盖真实链路清单

| 链路点 | 当前合同处理 | 真验证补位计划 |
|--------|--------------|----------------|
| GitHub PR state/head_sha/statusCheckRollup | Sprint 红测用注入的 `execCmd` 返回隔离 PR JSON，避免 Red 阶段依赖真实 PR；该 mock 只覆盖更外层 GitHub CLI，不覆盖被改 DB/Kernel 边。 | DoD 与 final E2E 必须在实现 PR 分支执行真实 `gh pr view "$CURRENT_BRANCH" --json url,state,headRefOid,statusCheckRollup`，断言 PR 为 OPEN、head SHA 与 CI rollup 可解析。 |

## 禁 mock 边清单

- `harness-skill-relay` run bootstrap ↔ `initiative_runs` / `initiative_contracts`（本单改 run 创建时的合同继承，测试必须真 Postgres 事务验证）。
- `ground-truth` ↔ `initiative_contracts` / `harness_attempts` / `orchestrator_decision_log`（本单改跨 run 恢复真相，测试必须真表读取，不 mock 被改 DB 边）。
- `derive` / `counters` ↔ append-only `orchestrator_decision_log` 回放（本单改跨 run 去重，测试必须用结构化 decision log 行，不用自然语言）。
- `durable-resume` ↔ `attempt-store` / provider adapter / launcher / `harness_attempts.provider_session_id`（本单改 expired lease/orphan running 恢复，测试必须从公开入口真调 store 与真实 adapter；只允许用捕获型 launcher 避免测试启动真实容器）。

## 接缝清单

- DB 事务接缝: 后续 run 创建与 approved contract 继承必须由生产 bootstrap 自己 acquire client；查询事件探针逐条区分 `pool` / `txClient` channel，并断言 approved SELECT、task milestone UPDATE、initiative_run INSERT 全部由同一个 txClient 在 BEGIN/COMMIT 内执行。注入该 txClient 的 run INSERT 失败时，生产路径必须在同一 client 上 ROLLBACK 且无半写；任一业务 SQL 走 `pool.query` 都立即失败。
- Worktree 重启接缝: Brain restart 用例显式 `fileExists=false`，只能从 `initiative_contracts`、append-only decision log 与 GitHub 结构化响应恢复 PRD/PR/合同里程碑。
- Provider session 接缝: expired lease 有 session 时必须 CAS reclaim 原 attempt；用真实 `harness_attempts` 断言 `status=starting`、`lease_owner=watchdog:test`、expiry 未来化及原 attempt/session 不变，未过期 running 行不得被本 worker resume。
- GitHub/PR 真相接缝: PR head_sha、CI rollup 与 decision log 必须逐字段对齐；Sprint 红测可注入隔离 `execCmd`，最终 E2E 必须真跑 `gh pr view`，不从 callback 文本猜。

## Golden Path

独立小路（无父路）

[后续 run/Brain restart] -> [recoverDurableRun 读取既有账本] -> [事务继承 approved contract] -> [单调恢复 PRD/PR/合同里程碑] -> [真实 adapter resume 原 attempt 或结构化终结] -> [按失败签名去重] -> [唯一出口：继续执行 / wait:human_review / FAILED]

### Step 1: 后续 run 事务继承最新 approved contract

**来源**: `[FROM_PRD]` - PRD Golden Path 第 1 步。

**可观测行为**: 新 run 的 `initiative_id` 字面等于 `task.id`，`journey_id` 独立保留；生产 bootstrap 自己 acquire PostgreSQL client，并用该同一 txClient 在 `BEGIN/COMMIT` 内按该 `initiative_id` 选择 latest approved contract、更新 task milestone payload、INSERT run；`pool.query` 仅允许 connect 前的 active-run 查询。其他 task 的更高版本 approved contract 是 decoy、不得继承；当前 task 无 approved contract 时 `contract_id=NULL` 并进入首轮 GAN。注入 txClient 的 run INSERT 失败时必须由同一 client `ROLLBACK`，不得留下 run 或 task payload 半写。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "后续 run 继承 latest approved contract" --reporter=verbose
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "首个 run 无 approved contract" --reporter=verbose
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "run bootstrap 中途失败" --reporter=verbose
```

**硬阈值**: 三条测试均 exit 0；approved 场景事件顺序为 CONNECT -> BEGIN -> scoped approved SELECT -> task milestone UPDATE -> initiative_run INSERT -> COMMIT，五条事务事件的 `channel=txClient` 且 `clientId` 全等，三条业务 SQL 的 `inTransaction=true`，不存在 `channel=pool` 的 SELECT_APPROVED/UPDATE_TASK/INSERT_RUN；`initiative_id=TASK_ID`、`journey_id=JOURNEY_ID`、contract_id 等于当前 task 的 v2 而非 decoy v99。首轮场景 `contract_id=NULL` 且 action=`spawn:proposer`；失败注入只发生在同一 txClient 的 INSERT 上，事件终点为同一 client 的 ROLLBACK 且 run 数为 0、task payload 未变化。

### Step 2: 已确认 PRD/PR/合同里程碑单调恢复

**来源**: `[FROM_PRD]` - PRD Golden Path 第 2 步与 Brain restart 边界情况。

**可观测行为**: Brain restart 用例强制 `fileExists=false`，worktree 中 PRD 文件不可见；系统只能从同 task 的 approved contract、append-only decision log 与 GitHub 结构化响应恢复 `prdExists/contract/pr`，不得把已确认里程碑降级；恢复结果与 `fileExists=true` 的不中断基线一致。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "Brain restart 后 PRD/PR/合同里程碑单调恢复" --reporter=verbose
```

**硬阈值**: 测试 exit 0；重启路径明确收到 `fileExists=false` 仍有 `prdExists=true`、`observed.contract.approved=true`；`observed.pr.url/head_sha/ci` 来自 DB decision log + GitHub 真相；恢复后的 decision.action 与不中断基线一致且不为 `spawn:planner/proposer/reviewer`。

### Step 3: expired lease/orphan running 优先 reclaim+resume 原 attempt

**来源**: `[FROM_PRD]` - PRD Golden Path 第 3 步。

**可观测行为**: `harness_attempts.status in ('starting','running')` 且 lease 过期、有 `provider_session_id` 时，`recoverDurableRun` 先通过 `attempt-store.reclaim` 的 CAS 将原行变成 `status='starting'`、`lease_owner='watchdog:test'`、`lease_expires_at > NOW()`，再把 reclaim 返回的同一行交给既有 provider registry、真实 adapter `resume` 与 launcher；attempt id/provider session 不变且不得插入新 attempt。未过期 running attempt 必须保持原 owner/status/expiry，不得被本 worker resume。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "稳定恢复原语：expired lease 有 provider session" --reporter=verbose
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "稳定恢复原语：未过期 running attempt" --reporter=verbose
```

**硬阈值**: 两条测试均 exit 0；expired 场景真实 import/use 命中 `recoverDurableRun`，同一 run 的行数不增加，DB 与 launcher 都看到同一 attempt/session 及 reclaim 后 `starting/watchdog:test/future expiry`，Codex adapter 生成含 `exec resume provider-session-1` 的 spec；未过期场景 launcher 调用数为 0，原 `running/active-worker/provider-session-live/future expiry` 全部不变。

### Step 4: 无 provider session 时先结构化终结再推导

**来源**: `[FROM_PRD]` - PRD Golden Path 第 4 步。

**可观测行为**: 原 attempt 没有 provider session 时，`recoverDurableRun` 自动写结构化终态 `failed` 与 `orphan_without_provider_session`，再从 DB/GitHub 真相调用既有 ground truth + derive；不得由调用方手工 fail，也不得直接开新 attempt掩盖 orphan。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "稳定恢复原语：无 provider session" --reporter=verbose
```

**硬阈值**: 测试 exit 0；真实 import/use 命中 `recoverDurableRun`；orphan attempt 有终态和 error_code；attempt 行数仍为 1；输出 `outcome=reconciled` 且后续 decision 为结构化 `spawn:generator-fix`。

### Step 5: 跨 run 同结构化根因去重

**来源**: `[FROM_PRD]` - PRD Golden Path 第 5 步。

**可观测行为**: 同一 task/initiative 的相同 `failure_signature` 或 failure_set 跨 run 再现时，derive 不再派 generator/generator-fix；出口为 `wait:human_review` 或 `mark_failed`。旧 run 为签名 A、当前 run 首次出现不同签名 B 时，`recoverDurableRun` 必须保留一次 `spawn:generator-fix`。

**验证命令**:

```bash
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "跨 run 同结构化 failure signature" --reporter=verbose
DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "跨 run 不同 failure signature 首次出现" --reporter=verbose
```

**硬阈值**: 两条测试均 exit 0；重复签名场景 dispatch 计数中 generator 不增加且 action 为 `wait:human_review` 或 `mark_failed`；不同签名场景 action 字面等于 `spawn:generator-fix`。

### Step 6: 只复用既有账本并保持版本账本同步

**来源**: `[FROM_PRD]` - PRD Golden Path 第 6 步、范围限定与 NFR。

**可观测行为**: 稳定恢复原语由 `durable-resume.js` 命名导出且被 Sprint Red 测试真实 import/use；实现只触达既有表；Brain 源码变化同步 `DEFINITION.md` 与四处版本账本；既有合同测试未削弱。

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
  'packages/brain/src/orchestrator/durable-resume.js',
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

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| Kernel durable resume | 后续 run 继承 latest approved contract | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 当前实现新 run `contract_id` 为空，测试失败 |
| Kernel durable resume | 首个 run 无 approved contract 时维持首次 GAN 路径 | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 错误的全局 latest 查询会继承其他 task 的 v99 decoy，测试失败 |
| Kernel durable resume | run bootstrap 中途失败时生产事务回滚 | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 当前 bootstrap 不自建事务且会留下 task payload 半写，事务事件/回滚断言失败 |
| Kernel durable resume | ground truth 从历史 approved contract 恢复当前 run | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 当前 `collectGroundTruth` 在 run.contract_id 为空时返回 approved:false，测试失败 |
| Kernel durable resume | Brain restart 后 PRD/PR/合同里程碑单调恢复 | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | `fileExists=false` 时当前 `collectGroundTruth` 不从结构化 decision log 恢复 PRD/PR 与 approved contract，决策会降级 |
| Kernel durable resume | 跨 run 同结构化 failure signature | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 当前 derive 只看当前 run，仍会派 generator-fix，测试失败 |
| Kernel durable resume | 跨 run 不同 failure signature 首次出现 | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 当前缺稳定恢复入口，无法从跨 run 真相返回 `spawn:generator-fix`，import 即 Red |
| Kernel durable resume | 稳定恢复原语：expired lease 有 provider session | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | `durable-resume.js` 与 `recoverDurableRun` 尚不存在，真实 import/use Red |
| Kernel durable resume | 稳定恢复原语：未过期 running attempt | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | 缺稳定恢复入口与 lease CAS 保护，真实 import/use Red |
| Kernel durable resume | 稳定恢复原语：无 provider session | `sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts` | `durable-resume.js` 与自动终结后 derive 编排尚不存在，真实 import/use Red |
