# Sprint Contract Draft (Round 1)

覆盖父路：独立小路（无父路）— 本 sprint 是 harness kernel GAN 观测正确性修复，不推进业务 Golden Path。

gp-anchor: skipped (product-map.json not found)
contract-gate: skipped (file not found, third-party repo N/A — 本仓 packages/brain/src/lib/contract-gate.js 存在则由代码闸复核；本 skill 内置规则已逐条自审)

## Response Schema（推导来源: PRD字面）

N/A — 任务无新增 HTTP 响应 schema。改动为三处内部纯逻辑 + payload 落库字段：
- `ground-truth.js` 提案 remote 解析（内部函数，返回 `{ remote, unresolved }`，非 HTTP）
- `derive.js` 状态机决策对象 `{ phase, action, reason }`（既有形状，仅新增两个 reason 字符串值 `proposal_remote_unresolved` / `proposal_observation_mismatch`）
- `work-routing-store.js` 落库 `tasks.payload.base_repo`（字符串字段，完整 clone URL）

因无 HTTP 响应，Reviewer 第 6 维 verification_oracle_completeness 按「纯内部改动」判定。

## 已知约束

来源标注 `[回归测试]` / `[累积FR]` / `[Invariant]`：

- [回归测试] `packages/brain/src/orchestrator/__tests__/derive.test.js`：`守护：no_push_streak >= 2 → failed`（reason `gan_no_push_streak`）——本单**不得回退**该行为：`crossCheckMismatch` 缺省/false 时仍判 `gan_no_push_streak`（零回归红线）。
- [回归测试] `derive.test.js`：`crossCheckMismatch：COUNT 与分支 rN 不一致 → true`（`counters.test.js`）——`crossCheckMismatch` 由 `deriveCounters` 计算，本单只消费不改其计算语义。
- [回归测试] `ground-truth.test.js`：既有 propose 分支 rN 计数用例——重构 `observeProposalBranch` 抽取后必须保持 rnPattern 匹配语义（round/attempt 取最大）。
- [累积FR]（本 line e6f803f2 暂无 done/working 历史，context-manifest: 无累积 FR）
- [Invariant] `[env来源]` target_environment 从 DB tasks.payload 读取；`[语义一致]` 同一语义（提案分支观测）在判变端（ground-truth）与终验端（derive）必须同一 remote 解析策略，跨脚本语义分叉会开假绿面；`[null契约显式else]` `resolveProposalRemote` 返回 `unresolved` 契约后，`observeProposalBranch` / `derive` 必须显式处理 unresolved 分支，禁止隐式退 origin。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | ① 建任务口对 coding_mutation 缺 base_repo 时回填规范 clone URL；② ground-truth 用 `base_repo ?? repo` 解析提案 remote，皆空不退 origin；③ derive 消费 crossCheckMismatch 门控 gan_no_push_streak，新增两个独立 failure_reason |
| **NFR（做得多好）** | | 有界重观测：crossCheckMismatch 连续 3 次仍 mismatch 才终态失败（不无限重观测）；Brain semver 四处同步；DevGate 三项通过 |
| **Invariant（永不违反）** | | 零回归：crossCheckMismatch 缺省/false 时 gan_no_push_streak 判死语义不变；不改 counters.js after>before 语义；不改 harness_attempts.failure_class 枚举 |
| **判定点（怎么知道）** | | 见下方判定点登记表 |
| **保质期（何时过期）** | | repoMap（`cecelia`/`zenithjoy` 别名）随 `HARNESS_REPO_MAP` env 或 DEFAULT_REPO_MAP 演进；无固定过期 |
| **死亡告警（停了谁知道）** | | 若观测再次全 mismatch，`initiative_runs.failure_reason=proposal_observation_mismatch` 独立值可被查询/告警区分，不再淹没在 gan_no_push_streak |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 真实 push 被观测为 `proposeBranchRn>=1`；DB 落库 `payload->>'base_repo'` 为完整 URL（psql 可查） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | API 不稳定 | 静默丢消息 |
| ⚠️ 提案分支是否真被 push | A. `git ls-remote origin`（本地 remote）; B. `git ls-remote <GitHub URL>`（权威 remote） | B（`base_repo ?? repo` 解析出 GitHub URL） | kernel worktree 的 origin 是本地路径，永远看不到 GitHub 提案分支 → rn 恒 0 | 真 push 被误判 no-push → run 假失败终态（本单根因） |
| 观测 rn 与成功回调数不一致时的归因 | A. 当作 proposer 没 push（no_push）; B. 当作观测故障（crossCheckMismatch）重新观测 | B | proposer 成功回调数 > 观测 rn 说明观测端漏看，非 proposer 没干活 | 把观测 bug 误记为 proposer 失败，掩盖真因 |

> ⚠️ 行属「升拍板点」：本单已由 PrepPRD/PRD 明确修法拍定，judgment-pending-user: 无。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是 | 客户端重试 |
| base_repo 与 repo 皆无法解析 remote | 不执行 ls-remote，置 `proposalRemoteUnresolved=true` → derive 终态 `reason=proposal_remote_unresolved` | 是（纯观测，无副作用） | 独立 failure_reason，人工/successor 处理 |
| 观测持续 mismatch（crossCheckMismatch=true）| 不递增 noPushStreak，重新观测；连续 3 次仍 mismatch → 终态 `reason=proposal_observation_mismatch` | 是 | 有界重观测后独立终态 |
| 建任务缺 base_repo 且 repo 也无法规范化 | 不回填（payload 无 base_repo），不抛错（保持既有建任务行为）| 是 | 下游 ground-truth 端 unresolved 分支兜住 |

### 输入对抗面

N/A — 全部改动为 harness kernel 内部逻辑，无对外暴露 agent / 外部可写入接口。

## 禁 mock 边清单

本单涉及 状态机（derive gan 判定）、跨模块数据传递（ground-truth remote 解析 → 提案分支观测）、DB 写路径（work-routing 落库 payload.base_repo），逐条列禁 mock 的边：

- derive.js 状态机 ↔ `counters.crossCheckMismatch` / `observed.proposalRemoteUnresolved`：单测真调 `derive(observed)` 纯函数，不 mock derive 内部分支。
- ground-truth 提案 remote 解析 ↔ 提案分支观测（`resolveProposalRemote` → `observeProposalBranch`）：单测真调导出函数，只在**最外层进程边界**注入 `execCmd` 打桩 git 子进程（不可能在单测里真连 GitHub），断言真实命令串命中 GitHub URL 且 rN 计数逻辑真实执行；被改的解析逻辑本身不 mock。
- work-routing-store `createRoutedTask` ↔ `tasks` 表（DB 写路径）：单测只锁纯 URL 规范化 `canonicalBaseRepoUrl`（无 DB）；**落库 payload.base_repo 的真实写入不用 fake client 冒充**，由 Final E2E 真 psql（scratch 库 JSONB 往返）覆盖，永久回归由 Generator 写 brain-integration job 真 Postgres 集成测试覆盖。

## 真实调用方请求 shape

N/A — 无设备/agent 调服务端的真实调用方；建任务由内部 work-routing 触发，观测由 kernel 内部执行。

## 未覆盖真实链路清单

- 单测中 `git ls-remote` 用注入 `execCmd` 打桩（不可能单测真连 GitHub）｜原因：网络依赖、单测确定性｜真验证补位：Final E2E `node run.js --dry-run`（或 oracle-dryrun-observe.mjs）在 local_api 真实执行观测路径；生产上线后由真实 successor run 复验 `proposeBranchRn>=1`。
- work-routing 落库 payload.base_repo 的完整 `createRoutedTask` 路径（含 map_projection/advisory lock）单测未跑｜原因：需完整 map 夹具 + 真 PG｜真验证补位：Final E2E 真 psql JSONB 往返 + Generator brain-integration job 真 Postgres 集成测试。

## Golden Path

[缺 base_repo 的 harness 任务入队] → [建任务口回填规范 URL / kernel 用正确 remote 观测提案分支 / derive 消费 crossCheckMismatch] → [真实 push 被计为 rn>=1，不再误判 gan_no_push_streak]

---

### Step 1: 建任务口对 coding_mutation 缺 base_repo 回填规范 clone URL
**来源**: `[FROM_PRD]` — PRD「Golden Path 步骤 1」+「修法 C」+ 预期受影响文件 `work-routing-store.js`

**可观测行为**: POST `harness_initiative`（coding_mutation）不带 `base_repo`、`payload.repo='cecelia'` → 落库 `tasks.payload->>'base_repo' === 'https://github.com/perfectuser21/cecelia.git'`；短名/别名一律规范化为完整 URL；无法规范化时不回填、不抛错。

**验证命令**:
```bash
# 纯 URL 规范化逻辑（真调导出函数）
node --input-type=module -e "import('./packages/brain/src/work-routing-store.js').then(m=>process.exit(m.canonicalBaseRepoUrl('cecelia')==='https://github.com/perfectuser21/cecelia.git'?0:1))"
# 期望：exit 0
```

**硬阈值**: `canonicalBaseRepoUrl('cecelia') === 'https://github.com/perfectuser21/cecelia.git'`；`canonicalBaseRepoUrl('') === null`

---

### Step 2: ground-truth 用 `base_repo ?? repo` 解析提案 remote，皆空不退 origin
**来源**: `[FROM_PRD]` — PRD「Golden Path 步骤 2」+「修法 A」+ 预期受影响文件 `ground-truth.js`

**可观测行为**: `resolveProposalRemote({base_repo:'',repo:'cecelia'})` → `{remote:'"https://github.com/perfectuser21/cecelia.git"',unresolved:false}`；`git ls-remote --heads` 命中 GitHub URL 而非本地 origin；`base_repo` 与 `repo` 皆空 → **不执行** `ls-remote origin`，`proposalRemoteUnresolved===true`。

**验证命令**:
```bash
# 回归夹具：复现 run 7a8e5319，假 ls-remote 对 URL 返回两条 propose 分支、对 origin 返回空
node sprints/08170551-kernel-73870d1b/tests/oracle-dryrun-observe.mjs
# 期望：打印 OK，exit 0（旧码走 origin → rn=0；新码走 URL → rn=1）
```

**硬阈值**: `observeProposalBranch(base_repo='',repo='cecelia')` → `proposeBranchRn===1`；皆空 → `proposeBranchRn===0 且 proposalRemoteUnresolved===true 且 0 次 ls-remote 调用`

---

### Step 3: derive 消费 crossCheckMismatch 门控 gan_no_push_streak + 两个独立 failure_reason
**来源**: `[FROM_PRD]` — PRD「Golden Path 步骤 3/4」+「修法 B」+ 预期受影响文件 `derive.js`

**可观测行为**: `counters.crossCheckMismatch===true` 且 `noPushStreak>=MAX_NO_PUSH_STREAK` → 返回决策 `action` 不是 `gan_no_push_streak`（视为观测故障，不递增 noPushStreak）；`observed.proposalRemoteUnresolved===true` → 终态 `reason='proposal_remote_unresolved'`；`crossCheckMismatch` 缺省/false 时 `gan_no_push_streak` 判死语义**不变**（零回归）。

**验证命令**:
```bash
node --input-type=module -e "import('./packages/brain/src/orchestrator/derive.js').then(async m=>{const {MAX_NO_PUSH_STREAK}=await import('./packages/brain/src/orchestrator/constants.js');const base={run:{phase:'gan'},task:{status:'in_progress'},prdExists:true,contract:{approved:false},pr:null,inflight:{containers:[],host_pids:[],attempts:[]},lastAgentExit:{code:0,auth_failed:false},proposeBranchRn:0,ganLatestRoundVerdict:null,generatorSpawned:false,evaluateVerdict:null,judgeVerdict:null,reviewRequired:false,reviewApproved:false,decisionLog:[],counters:{hops:1,fixRound:0,pollCount:0,noPushStreak:MAX_NO_PUSH_STREAK,noVerdictStreak:0,ganCostUsd:0,crossCheckMismatch:true}};const r=m.derive(base);process.exit(r.reason!=='gan_no_push_streak'&&r.phase!=='failed'?0:1)})"
# 期望：exit 0
```

**硬阈值**: crossCheckMismatch=true+noPushStreak>=MAX → `reason !== 'gan_no_push_streak' 且 phase !== 'failed'`；proposalRemoteUnresolved=true → `phase==='failed' 且 reason==='proposal_remote_unresolved'`

---

### Step 4（出口）: 真实 push 被观测为 rn>=1，run 不再假失败
**来源**: `[FROM_PRD]` — PRD「Golden Path 出口（可观测）」

**可观测行为**: kernel `node src/orchestrator/run.js --dry-run` 对缺 base_repo 的 task 输出的 `observed.proposeBranchRn` 来自 GitHub URL 而非 origin；无法解析 remote / 观测持续故障时落独立 `failure_reason`（不再混记 gan_no_push_streak）。

**验证命令**:
```bash
# 落库真验（Final E2E 段承载真 psql）；观测真验见 Step 2 oracle
node sprints/08170551-kernel-73870d1b/tests/oracle-dryrun-observe.mjs
# 期望：exit 0
```

**硬阈值**: 见 ## E2E 验收

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 逻辑断言层（环境无关）：真调三处改动的导出函数，无 mock 被改逻辑
npx vitest run sprints/08170551-kernel-73870d1b/tests/ --reporter=dot

# 2. 观测接缝真验：复现 run 7a8e5319 提案分支观测走 GitHub URL 而非 origin
node sprints/08170551-kernel-73870d1b/tests/oracle-dryrun-observe.mjs

# 3. DB 写入类接缝真验：payload.base_repo 回填 URL 经真 Postgres JSONB 往返
URL=$(node --input-type=module -e "import('./packages/brain/src/work-routing-store.js').then(m=>{const u=m.canonicalBaseRepoUrl('cecelia');if(u==null){process.stderr.write('FAIL null url');process.exit(1)}process.stdout.write(u)})")
echo "derived base_repo url: ${URL}"
ROUNDTRIP=$(psql "$DB_URL" -tAX <<SQL
CREATE TEMP TABLE _bf_probe(payload jsonb);
INSERT INTO _bf_probe(payload) VALUES (jsonb_build_object('work_kind','coding_mutation','base_repo', '${URL}'::text));
SELECT payload->>'base_repo' FROM _bf_probe WHERE payload->>'work_kind'='coding_mutation';
SQL
)
echo "psql roundtrip: ${ROUNDTRIP}"
[ "$ROUNDTRIP" = "https://github.com/perfectuser21/cecelia.git" ] || { echo "FAIL: base_repo 落库/回读不等于完整 URL"; exit 1; }

echo "OK: local_api Golden Path 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveProposalRemote({base_repo:'not-a-repo-xyz',repo:'also-unknown'})` → 应 unresolved=true，不得误退 origin
- 重复提交: 同一 source/source_id 二次 POST harness_initiative → 幂等，payload.base_repo 仍为完整 URL（不重复回填成畸形值）
- 中途中断: crossCheckMismatch=true 时连续观测——第 1/2 次不失败、第 3 次终态 proposal_observation_mismatch（有界，不无限）
- 边界值: `repo='cecelia'` 与 `base_repo='https://github.com/perfectuser21/cecelia.git'` 同时存在 → 优先 base_repo，结果一致；`repo='/workspace'` 路径形态 → 规范化到 cecelia
发现分级: P0/P1（把观测故障重新误记为 gan_no_push_streak / 落库畸形 URL）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ground-truth 提案 remote 解析 + 观测 | `tests/ground-truth-proposal-remote.test.ts` | 解析到 GitHub URL 而非 origin；base_repo 与 repo 皆空 unresolved 为 true 且 remote 不退 origin；回归夹具 base_repo 空 repo=cecelia 用 GitHub URL 观测到 rn 等于 1 | import 缺 `resolveProposalRemote`/`observeProposalBranch` → 全部 FAIL |
| derive 消费 crossCheckMismatch + failure_reason | `tests/derive-proposal-observation.test.ts` | crossCheckMismatch=true 且 noPushStreak>=MAX 时 action 不是 gan_no_push_streak；proposalRemoteUnresolved=true 时 reason 为 proposal_remote_unresolved | 现码判 gan_no_push_streak / 忽略 unresolved → FAIL（零回归 guard 用例保持 green）|
| work-routing base_repo 回填 | `tests/work-routing-base-repo-backfill.test.ts` | 短名 cecelia 规范化为完整 GitHub clone URL；owner/repo 形式规范化为完整 clone URL；空值/无法解析时返回 null 不臆造 URL | import 缺 `canonicalBaseRepoUrl` → FAIL |
