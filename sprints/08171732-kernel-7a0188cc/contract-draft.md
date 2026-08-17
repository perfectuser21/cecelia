# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api
**Base repo**: cecelia（perfectuser21/cecelia）

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，代码层 gate 生效）

锚定父路声明: **独立小路（无父路）** —— 本 sprint 是 packages/brain 后端 kernel 观测修复，无父 Golden Path 依赖。

---

## Response Schema（推导来源: PRD字面）

N/A — 本单无新增/变更 HTTP 响应字段（改动全在 kernel 观测内部函数 + 建任务口 payload 回填）。

唯一对外可观测契约是 **DB 字段**（非 HTTP body）：
- `tasks.payload->>'base_repo'`：coding_mutation 任务落库后必须为完整 clone URL（`https://github.com/<owner>/<repo>.git`），不得为空、短名或本地路径。
- `initiative_runs.failure_reason`（自由字符串列）新增两个合法值：`proposal_remote_unresolved`、`proposal_observation_mismatch`（不改 `harness_attempts.failure_class` 枚举，无 migration）。

**禁用字段名**: 无（不新增 HTTP 字段）。

---

## Golden Path

[proposer 真实 push 提案分支] → [kernel 解析提案 remote：base_repo→repo 兜底，禁退 origin] → [观测到分支 rn≥1 不误判 / 皆无则独立失败 / 观测故障重观测] → [建任务口缺 base_repo 即回填规范 URL]

### Step 1: 提案 remote 解析走 base_repo→repo 兜底，命中别名表映射为 GitHub URL
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + 修法 A。

**可观测行为**: `payload.base_repo` 为空但 `payload.repo='cecelia'` 时，kernel 用 `parseBaseRepo(base_repo) ?? parseBaseRepo(repo)` 解析出 `perfectuser21/cecelia`，`git ls-remote --heads` 打到 `https://github.com/perfectuser21/cecelia.git`（不是本地 `origin`）。

**验证命令**:
```bash
(cd /workspace && npx vitest run --no-cache \
  sprints/08171732-kernel-7a0188cc/tests/ground-truth-proposal-remote.test.ts --reporter=basic)
# 期望：resolveProposalRemote / collectGroundTruth 用例全过（ls-remote 命令串含 github.com/perfectuser21/cecelia.git）
```

**硬阈值**: A1/A3 用例 exit 0；`observed.proposeBranchRn===1`（真 push 的两条 propose 分支被看到）。

---

### Step 2: base_repo 与 repo 皆解析不到 → 禁退 origin，置 proposalRemoteUnresolved
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 边界情况「皆空」。

**可观测行为**: 两者都解析不到时**不执行** `git ls-remote --heads origin`，`observed.proposalRemoteUnresolved===true`，`proposeBranchRn===0`（不把无法观测硬算成 no-push）。

**验证命令**:
```bash
(cd /workspace && npx vitest run --no-cache \
  sprints/08171732-kernel-7a0188cc/tests/ground-truth-proposal-remote.test.ts --reporter=basic)
# 期望：A2 用例通过——无 `ls-remote --heads origin` 命令、proposalRemoteUnresolved===true
```

**硬阈值**: 断言 `deps.execCmd` 调用中无匹配 `/ls-remote --heads origin\b/` 的命令；`observed.proposalRemoteUnresolved===true`。

---

### Step 3: derive 消费观测——gan_no_push_streak 只在 crossCheckMismatch=false 触发；unresolved 独立失败
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3/4 步 + 修法 B。

**可观测行为**:
- `counters.crossCheckMismatch===true`（成功回调数 > 观测 rn）→ 绝不判 `gan_no_push_streak`；改为 `wait:running` + reason `proposal_observation_mismatch`（重观测，不递增 noPushStreak）；连续 3 次仍 mismatch 才 `mark_failed reason=proposal_observation_mismatch`。
- `observed.proposalRemoteUnresolved===true` → `mark_failed reason=proposal_remote_unresolved`（独立 failure_reason）。
- `crossCheckMismatch===false` 且 noPushStreak 到顶 → 仍判 `gan_no_push_streak`（零回归）。

**验证命令**:
```bash
(cd /workspace && npx vitest run --no-cache \
  sprints/08171732-kernel-7a0188cc/tests/derive-gan-observation.test.ts --reporter=basic)
# 期望：B1/B2/B3/B4 五条用例全过
```

**硬阈值**: derive 五条用例 exit 0。

---

### Step 4: 建任务口缺 base_repo 即回填规范 clone URL
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 + 修法 C。

**可观测行为**: `createRoutedTask` 对 `coding_mutation` 任务，payload 缺 `base_repo` 时从 `map_scope_repositories` 的 repo/aliases 推出规范 URL 写入 `payload.base_repo`；短名/别名一律规范化为 `https://github.com/<owner>/<repo>.git`；未知短名不猜测（返回 null，不回填）。

**验证命令**:
```bash
# 纯逻辑（规范化）——DB-free：
(cd /workspace && npx vitest run --no-cache \
  sprints/08171732-kernel-7a0188cc/tests/work-routing-base-repo.test.ts --reporter=basic)
# DB 写路径真验（真 Postgres，见 ## E2E 验收 第 3 段）
```

**硬阈值**: `canonicalRepoCloneUrl('cecelia',facts)==='https://github.com/perfectuser21/cecelia.git'`；真 PG 集成测试查 `tasks.payload->>'base_repo'` 等于完整 URL。

---

## 已知约束（来自回归测试）

- [ground-truth.test.js] collectGroundTruth 用 fake deps 断言解析逻辑；rN 解析 / inflight label 过滤 / lastAgentExit hop 作用域必须保持。
- [derive.test.js] deriveGan 无硬轮数上限（刻意）；budgetCap/noPushStreak/noVerdictStreak 硬保护语义不得回退；趋势闸/纪元规则不受本单影响。
- [counters.test.js] `crossCheckMismatch = proposerCount !== proposeBranchMaxRn`；本单**只读**该字段，不改 counters.js 的 after>before 语义。
- [work-routing-store.integration.test.js] createRoutedTask 的 coding_mutation 路由（seedActiveF1 真 PG 夹具）必须保持；本单只增 base_repo 回填，不改路由裁决。
- [累积FR] （本 line 暂无已验收历史，context-manifest N/A）
- [Invariant] 真实 push 的提案分支绝不能被算成 no-push；观测退到本地 origin 属禁止行为（本 sprint 铁律）。
- [MAP] scope/repo 未随 task.payload.map_scope 注入 → 标 `[MAP_NOT_CONFIGURED]`，本单不依赖 Unified Map radius。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①提案 remote 解析 base_repo→repo 兜底并禁退 origin；②皆无则 proposalRemoteUnresolved 独立失败；③crossCheckMismatch 时不误判 gan_no_push_streak，重观测≤3 次；④建任务口缺 base_repo 回填规范 URL |
| **NFR（做得多好）** | 非功能 | 提案观测最多重观测 3 次后判失败；纯函数确定性（禁 Date/random）；Brain semver 四处同步 |
| **Invariant（永不违反）** | 不变量 | 真实 push 的提案分支绝不算成 no-push；未解析出 remote 时禁退本地 origin；不改 counters.js after>before 语义；不改 failure_class 枚举 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效退役 | repoMap 别名表随仓库增减维护（DEFAULT_REPO_MAP / HARNESS_REPO_MAP）；无 token 类过期物 |
| **死亡告警（停了谁知道）** | 告警 | 观测故障写 `verdict:proposal_observation_mismatch` 决策日志行；新 failure_reason 独立记入 initiative_runs.failure_reason，run 失败即人可见 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | proposeBranchRn≥1 = 观测到真实分支；tasks.payload->>'base_repo' 真查落库 = 回填生效 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ proposer 是否真的 push 了提案分支 | A. ls-remote 打本地 origin; B. ls-remote 打规范 GitHub URL(base_repo→repo 兜底); C. 只信内存回调 | B. ls-remote 打规范 GitHub URL | 本地 origin 指向本机 clone，看不到 GitHub 分支；内存回调可能漏记 | **静默把真 push 算成 no-push → run 假失败**（本单根因，误判后果严重） |
| proposal remote 无法解析时的处置 | A. 退 origin 兜底; B. 置 unresolved 独立失败 | B. unresolved 独立失败 | 退 origin 会重演误判；独立 failure_reason 可诊断 | 退 origin → 无限重演假失败 |
| crossCheckMismatch 是观测故障还是真 no-push | A. 直接判 no_push_streak; B. 视为观测故障重观测≤3 次 | B. 重观测≤3 次 | 成功回调数 > rn 说明观测漏看，非 proposer 没干活 | 直接失败 → 假失败；无限重观测 → 卡死（故设 3 次上限） |

> `judgment-pending-user: proposer 是否真的 push`（⚠️ 判定点；PrepPRD 未显式拍板，但方法 B 已由 PRD 修法 A 明确指定为 SSOT，合同据此实现；如主理人有更优土办法可在人审阶段调整）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是（幂等键 task_id） | 客户端重试 |
| proposal remote 皆无法解析 | `mark_failed reason=proposal_remote_unresolved`（拦截，不放行） | 是（纯函数据 observed 判定） | 无降级——缺 remote 无法观测，独立失败可诊断 |
| crossCheckMismatch（观测漏看） | 前 3 次 `wait:running` 重观测；第 3 次仍 mismatch → `mark_failed reason=proposal_observation_mismatch` | 是（据 decisionLog 计数，不递增 noPushStreak） | 重观测即降级路径 |
| 建任务口缺 base_repo 且短名未知 | `canonicalRepoCloneUrl` 返回 null，不回填（payload.base_repo 保持缺省）；不猜测 | 是 | 下游仍走原缺失路径，不引入错误 URL |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单全为 kernel 内部编排 + 建任务口 payload 规范化，无对外暴露 agent / 外部用户可写入接口。

---

## 禁 mock 边清单

本单改动涉及**状态机（derive gan_no_push 触发条件）+ 跨模块数据传递（ground-truth→derive 的 observed 观测）+ DB 写路径（work-routing-store 写 tasks.payload）**，适用禁 mock 边规则：

- **derive.js ↔ counters（crossCheckMismatch 字段）**：derive 为纯函数，测试真传 `counters.crossCheckMismatch`，不 mock 任何邻居（`derive-gan-observation.test.ts` 直接调 `derive(observed)`）。
- **ground-truth.js 内部「选 remote / 是否 ls-remote / 输出 proposalRemoteUnresolved」逻辑**：`ground-truth-proposal-remote.test.ts` 真跑 `collectGroundTruth`，只注入 `execCmd`（git 子进程，属**外层外部边界**，非被改的模块边）与 `pool`（DB 读，返回真实 SQL 形状 rows）；被改的选 remote 逻辑与 rn 解析真实执行。
- **work-routing-store.js ↔ tasks 表（payload.base_repo 写入）**：DB 写路径**禁 mock**——真 Postgres 验证由 `packages/brain/src/__tests__/integration/work-routing-base-repo.integration.test.js`（Generator 复用 seedActiveF1 真 PG 夹具）承载，E2E 第 3 段用注入的 scratch `DB_URL` 真跑，psql/vitest 真查 `tasks.payload->>'base_repo'` 落库。`work-routing-base-repo.test.ts` 只覆盖规范化纯逻辑（`canonicalRepoCloneUrl`），不 mock DB 边、也不冒充 DB 写验证。

（纯规范化逻辑 `canonicalRepoCloneUrl` 与纯函数 `derive` 无接缝边，允许直测。）

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

```bash
#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ---- 1. 合同冻结测试：A/B/C 真实逻辑（deterministic L2，DB-free）----
npx vitest run --no-cache sprints/08171732-kernel-7a0188cc/tests/ --reporter=basic

# ---- 2. DevGate 三项 + 版本四处同步（改 Brain 强制门禁）----
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs

# ---- 3. DB 写路径真验（fix C：code↔tasks 表；Fleet 注入 attempt 级 scratch DB_URL）----
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL for local_api}"
export DATABASE_URL="$DB_URL"
# 空库用仓库真实 migration bootstrap 后，跑真 PG 集成测试（复用 seedActiveF1 夹具）
node packages/brain/scripts/migrate.js >/tmp/harness-migrate.log 2>&1 \
  || node packages/brain/src/db/migrate.js >/tmp/harness-migrate.log 2>&1 \
  || { echo "FAIL: brain migration bootstrap 失败，见 /tmp/harness-migrate.log"; exit 1; }
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: tasks 表未 bootstrap"; exit 1; }
(cd packages/brain && DB_URL="$DB_URL" DATABASE_URL="$DB_URL" \
  npx vitest run --no-cache ./src/__tests__/integration/work-routing-base-repo.integration.test.js --reporter=basic)

# ---- 4. 缺 base_repo 建单 → psql 真查落库为完整 URL（fix C 真实副作用，带时间窗防伪）----
COUNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE payload->>'work_kind'='coding_mutation' AND payload->>'base_repo'='https://github.com/perfectuser21/cecelia.git' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: 5 分钟内无 base_repo 回填为完整 URL 的 coding_mutation 任务落库"; exit 1; }

echo "✅ Golden Path 验证通过（A/B/C 逻辑 + DevGate + DB 写路径真验）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `payload.repo` 为非法短名（如 `cecelia/../evil`、空串、纯数字）→ 应 unresolved/返回 null，绝不拼出畸形 URL 或退 origin。
- 重复提交: 同一 source/source_id 二次 createRoutedTask（advisory lock 幂等）→ base_repo 回填不得二次改写已存在受信 payload。
- 中途中断: crossCheckMismatch 重观测第 2 次时 rn 变为 ≥1（proposer 补 push 被看到）→ 应立即回正常 GAN 路由，不得继续走 mismatch 计数直到失败。
- 边界值: `base_repo` 已是完整 URL 但结尾无 `.git` / 带尾斜杠 → 规范化幂等；proposeBranchRn 在 URL 与 origin 混合 ls-remote 输出下只认 URL 侧。
发现分级: P0/P1（真 push 被算 no-push / 回填出错误 URL / 无限重观测）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 提案 remote 解析（A） | `tests/ground-truth-proposal-remote.test.ts` | `base_repo 空 + repo=cecelia`、`base_repo 与 repo 皆空`、`未知短名`、`ls-remote 命令串含 GitHub URL 且 proposeBranchRn=1`、`不执行 ls-remote origin，proposalRemoteUnresolved=true` | → resolveProposalRemote is not a function / rn=0 / unresolved undefined |
| derive 观测消费（B） | `tests/derive-gan-observation.test.ts` | `crossCheckMismatch=true 且 noPushStreak 到顶`、`已连续 3 次观测故障`、`仅 2 次观测故障`、`proposalRemoteUnresolved=true` | → gan_no_push_streak 误判（应为 proposal_* reason） |
| 建任务口回填（C） | `tests/work-routing-base-repo.test.ts` | `短名 cecelia`、`短名 zenithjoy`、`已是完整 URL`、`未知短名` | → canonicalRepoCloneUrl is not a function |

**BEHAVIOR 覆盖名均为对应 `it()` 名字面子串**（下游按字符串匹配回测试用例）。

---

## AI_ADDED 标注

本合同全部 Golden Path Step 均为 `[FROM_PRD]`（1:1 对应 PRD 修法 A/B/C 与 Golden Path 5 步）；无 `[AI_ADDED]` 步骤。防造假约束（时间窗 `created_at > NOW() - interval '5 minutes'`、真 PG 验 DB 写、ls-remote 命令串断言）为 PRD「验收必须翻译成可验证断言」的具体 codify，非新增 scope。
