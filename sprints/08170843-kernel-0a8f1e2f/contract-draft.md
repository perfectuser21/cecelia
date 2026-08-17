# Sprint Contract Draft (Round 1)

**Sprint**: 修复 gan_no_push_streak 误判（提案分支观测退本地 origin + 缺 base_repo 不兜底）
**journey_type**: autonomous
**target_environment**: local_api
**contract-gate**: cecelia worktree（`packages/brain/src/lib/contract-gate.js` 存在），走代码层 Contract Gate + skill 内置规则。
**gp-anchor**: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 Harness kernel 观测正确性修复，PrepPRD 未锚定 golden_path（step_id=none, ability_id 空）。

## Response Schema（推导来源: PRD 明确 + api_registry 现有 POST /api/brain/tasks 语义）

本 sprint 核心是 kernel 内部观测/建单逻辑，唯一对外 HTTP 面是既有 `POST /api/brain/tasks`
的落库副作用（不新增端点、不改响应外形）。

### Endpoint: POST /api/brain/tasks（既有端点，仅副作用变化）
**Success (HTTP 200/201)**: 沿用现有响应外形（`{ id, task_type, status, payload, ... }`），
本 sprint **不改响应字段名**。唯一新增约束：当请求为 coding_mutation 且未带 `base_repo`、
`payload.repo` 可解析时，落库 `tasks.payload.base_repo` 必须为完整 clone URL。
- `payload.base_repo` (string, 落库必填 for coding_mutation): 缺失时由 `createRoutedTask` 从
  `map_scope_repositories` 的 repo/aliases 规范化为 `https://github.com/<owner>/<repo>.git`。来源——PRD 系统处理 C。

**禁用字段名**: 不得改 `base_repo` → `baseRepo`/`repo_url`/`clone_url`；不得改 `repo` 键名。
**内部返回外形（非 HTTP，供单测断言）**:
```
observeProposalBranch(...) → { proposeBranchRn:number, proposeBranch:string|null,
  proposeBranchSha:string|null, proposalRemote:string|null, proposalRemoteUnresolved:boolean }
derive(observed).reason ∈ { 'gan_no_push_streak'（保留）, 'proposal_remote_unresolved'（新）,
  'proposal_observation_mismatch'（新）, ... }
```
新 `failure_reason` 只是 `initiative_runs.failure_reason` 字符串值，**不改** `harness_attempts.failure_class` 枚举、不需 migration。

## 已知约束（来自回归测试 + 累积 FR）

- [derive.test.js] → GAN 无硬轮数上限（刻意，勿加）；MAX_NO_PUSH_STREAK=2 / MAX_NO_VERDICT_STREAK=3 硬保护照抄
- [derive.test.js] → 重开后趋势闸按纪元切、force_approve 让路等既有语义不得回退
- [ground-truth.test.js] → collectGroundTruth 用 fake deps 注入 pool/execCmd，rN 解析 / inflight label / lastAgentExit 作用域不得破坏
- [counters.test.js] → `crossCheckMismatch = proposerCount !== proposeBranchMaxRn` 语义已存在，本 sprint 只消费不改
- [累积FR] context-manifest: unavailable（本 line 暂无历史 FR，PRD 累积 FR 段为空）
- [MAP_NOT_CONFIGURED] task.payload.map_repo=null → Unified Map radius 未配置，must_run_assertions 为空，不回退领域硬编码

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | (A) ground-truth 提案 remote 解析加 `payload.repo` 兜底 + 双空置 `proposalRemoteUnresolved`；(B) derive 的 gan_no_push_streak 只在 `crossCheckMismatch===false` 触发，观测故障走独立 failure_reason；(C) 建单口对 coding_mutation 缺 base_repo 回填规范 URL |
| **NFR（做得多好）** | | Brain semver 四处同步；DevGate 三项通过；纯 kernel 逻辑，无性能敏感路径 |
| **Invariant（永不违反）** | | 见下方 Invariant 段（Brain URL 权威 / 观测故障不记 GAN 逻辑失败 / planner role branch 不受影响） |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | 不适用（编排逻辑常驻，无 token/凭据时效） |
| **死亡告警（停了谁知道）** | | 观测故障不再吞进 gan_no_push_streak → 以独立 failure_reason 落 `initiative_runs`，主理人经 run 终态可见；⚠️ 若回填 URL 错误会导致后续观测全错 |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | 单测断言 observeProposalBranch/derive/createRoutedTask 真实返回值；E2E 查 `tasks.payload->>'base_repo'` 落库真值 + kernel dry-run 观测来自 URL |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 提案分支是否真被 push（rn 是否反映真实 push） | A. `ls-remote` 本地 origin; B. `ls-remote` Brain 授权 GitHub URL | B（GitHub URL） | 本地 workspace 的 origin 指向本地路径，看不到 GitHub 分支 | 真 push 被算 no-push → run 假失败（本 bug 根因） |
| ⚠️ remote 解析不到时如何归因 | A. 退 origin 静默继续; B. 置 proposalRemoteUnresolved 独立失败 | B（不退 origin） | 退 origin = 错误权威，掩盖真相 | 缺 base_repo 任务被误判 gan_no_push_streak |
| 观测 rn 与成功回调数不一致时 | A. 直接判 no_push_streak 失败; B. 视为观测故障重新观测，满 3 次才失败 | B | crossCheckMismatch 是崩溃窗口漏记信号，非真无 push | 观测故障被误记成 GAN 逻辑失败终态 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| remote 双空解析不到 | derive → mark_failed，reason='proposal_remote_unresolved'（独立值，不记 gan_no_push_streak） | 是（同 observed 幂等） | 无 origin 兜底（刻意），交建单口回填后重跑 |
| crossCheckMismatch=true（观测与回调不一致） | 不递增 noPushStreak，重新观测（写 verdict:proposal_observation_mismatch 日志行） | 是 | 连续 <3 次重新观测；满 3 次才 mark_failed reason='proposal_observation_mismatch' |
| 建单缺 base_repo 且 repo 不可解析 | 保持缺失（不写错 URL） | 是 | 由 derive 侧 proposalRemoteUnresolved 兜底暴露 |

### 输入对抗面

N/A —— 本 sprint 全为 kernel 内部编排逻辑，无对外暴露 agent / 用户可写入接口。

## 禁 mock 边清单

- ground-truth 代码 ↔ git remote（`git ls-remote`）：本单改 remote 解析与是否执行 ls-remote，冻结测试用既有 `execCmd` seam **注入**假 exec（依赖注入，非 `vi.mock` git），返回真实 shape 的 ls-remote 输出验证走 URL / 不退 origin。禁止 `vi.mock` 掉 git 调用本身。
- derive 状态机 ↔ counters（crossCheckMismatch / noPushStreak / proposalObservationMismatchStreak）：本单改状态迁移归因，derive 冻结测试直接构造真实 counters 形状驱动纯函数，不 mock derive 内部分支。
- work-routing-store 代码 ↔ tasks 表 payload 写路径：本单改 INSERT INTO tasks 的 payload 落库形态，冻结测试用既有 fake client seam 捕获真实 INSERT 参数断言（依赖注入，非真 PG；真 PG 由 E2E 覆盖）。
- 允许 mock 的更外层无关依赖：无（本单不涉及第三方 API / 通知渠道）。

---

## Golden Path

[提案分支已推到 GitHub] → [kernel 用 Brain 授权 GitHub URL 观测提案分支] → [derive 用 crossCheckMismatch/remoteUnresolved 正确归因] → [建单口缺 base_repo 回填规范 URL] → [rn 反映真实 push，run 不再 gan_no_push_streak 假失败]

### Step 1: ground-truth 提案 remote 解析加 payload.repo 兜底 + 双空不退 origin
**来源**: `[FROM_PRD]` — PRD 系统处理 A + 边界情况第 1 条 + 根因 1/2。

**可观测行为**: `payload.base_repo` 空但 `payload.repo='cecelia'` 时，观测提案分支的 ls-remote 命令走
`https://github.com/perfectuser21/cecelia.git`（非本地 origin）；`base_repo` 与 `repo` 皆空时不执行任何 ls-remote origin，返回 `proposalRemoteUnresolved=true`。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js -t "remote 解析" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: 两条 remote 解析用例全过（exit 0）。

---

### Step 2: 回归夹具复现 rn=0 → rn=1
**来源**: `[FROM_PRD]` — PRD E2E 验收点 2 + 验收「回归夹具」。

**可观测行为**: 假 ls-remote 对 GitHub URL 返 run 7a8e5319 的两条 propose 分支、对 origin 返空 →
新码 `proposeBranchRn===1`（旧码退 origin → rn=0）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/ground-truth-proposal-remote.test.js -t "回归夹具" >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: 夹具用例 rn=1 与 rn=0 对照全过。

---

### Step 3: derive gan_no_push_streak 误判闸
**来源**: `[FROM_PRD]` — PRD 系统处理 B + 边界情况第 3 条 + Invariant「failure 归因」。

**可观测行为**: `crossCheckMismatch===true` 且 `noPushStreak>=MAX_NO_PUSH_STREAK` → 不判 gan_no_push_streak（重新观测）；
`proposalRemoteUnresolved===true` → mark_failed reason=`proposal_remote_unresolved`；
mismatch 连续 3 次 → mark_failed reason=`proposal_observation_mismatch`；`crossCheckMismatch===false` 时保留旧 gan_no_push_streak 行为（零回归）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/derive-no-push-gate.test.js >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: 4 条 derive 用例全过（含零回归）。

---

### Step 4: 建单口缺 base_repo 回填规范 URL
**来源**: `[FROM_PRD]` — PRD 系统处理 C + 边界情况第 2 条 + 根因 3。

**可观测行为**: coding_mutation 任务不带 `base_repo`、`repo='cecelia'` → 落库 `tasks.payload.base_repo === 'https://github.com/perfectuser21/cecelia.git'`；已带 base_repo 时不覆盖。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170843-kernel-0a8f1e2f/tests/work-routing-base-repo-backfill.test.js >/dev/null 2>&1 && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: 回填用例 + 不覆盖用例全过。

---

### Step 5: Brain semver 四处同步 + DevGate 三项通过
**来源**: `[AI_ADDED]` — 理由：CLAUDE.md 硬门禁，Brain 改动必须过版本同步与 facts-check，否则 CI 拦截。

**可观测行为**: `bash scripts/check-version-sync.sh` 与 `node scripts/facts-check.mjs` 与
`node packages/quality/scripts/devgate/check-dod-mapping.cjs` 全 exit 0。

**验证命令**:
```bash
cd /workspace && bash scripts/check-version-sync.sh && node scripts/facts-check.mjs && node packages/quality/scripts/devgate/check-dod-mapping.cjs && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: 三项 exit 0。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

> journey_type=autonomous / target_environment=local_api：curl 打真实 Brain（localhost:5221）+ psql 查落库真值 + node kernel dry-run。
> 本 sprint 无用户/租户/业务身份模型（Brain harness 自有 tasks 表，非多租户业务应用），故不含 signup/login 自举；
> 只声明 Fleet 注入的 attempt 级 `DB_URL`，先对空库跑仓库真实 migration，再 POST 真实建单口。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SOURCE_ID="e2e-base-repo-backfill-$(date +%s)-${RANDOM}"
cleanup() { rm -f /tmp/e2e-create.json; }
trap cleanup EXIT

# 1. 空库跑仓库真实 migration（Brain 自带 migrate.js），机检 tasks 表存在。
node packages/brain/src/migrate.js >/tmp/e2e-migrate.log 2>&1
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t || { echo "FAIL: tasks 表未创建"; exit 1; }

# 2. POST 一条不带 base_repo、repo=cecelia 的 coding_mutation harness_initiative 任务（真实建单口）。
curl -sfS -H 'content-type: application/json' -X POST "$BRAIN_URL/api/brain/tasks" \
  -d "{\"title\":\"e2e base_repo 回填\",\"task_type\":\"harness_initiative\",\"source_id\":\"$SOURCE_ID\",\"mutation_intent\":\"write\",\"change_kind\":\"bugfix\",\"payload\":{\"repo\":\"cecelia\",\"map_scope\":[\"F1\"]}}" \
  > /tmp/e2e-create.json
TASK_ID=$(jq -er '.id' /tmp/e2e-create.json)

# 3. psql 查落库 base_repo == 完整 URL（DB 写入类：带时间窗口防历史数据冒充）。
BASE_REPO=$(psql "$DB_URL" -tAc "SELECT payload->>'base_repo' FROM tasks WHERE id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'")
[ "$BASE_REPO" = "https://github.com/perfectuser21/cecelia.git" ] || { echo "FAIL: base_repo 落库=$BASE_REPO"; exit 1; }

# 4. kernel dry-run 观测 proposeBranchRn 来自 GitHub URL 而非 origin（回归夹具语义）。
#    dry-run 输出中 observed.proposalRemote 必须含 github.com（不是裸 origin）。
DRY=$(node packages/brain/src/orchestrator/run.js --dry-run --task "$TASK_ID" 2>&1 || true)
echo "$DRY" | grep -q "github.com/perfectuser21/cecelia" || { echo "FAIL: dry-run 未走 GitHub URL 观测: $DRY"; exit 1; }
echo "$DRY" | grep -qE "ls-remote[^\n]*\borigin\b" && { echo "FAIL: dry-run 退回了本地 origin"; exit 1; } || true

echo "✅ local_api Golden Path 验证通过"
```

> 说明：步骤 4 的 `run.js --dry-run --task` 若当前入口不支持该 flag，Generator 需补一条只读 dry-run 观测入口（不派发、不写终态），仅打印 observed.proposalRemote / proposeBranchRn；这是 PRD E2E 验收点 2 的可执行化，属实现范围。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `POST /api/brain/tasks` 传 `payload.repo="不存在的仓"` → 应保持 base_repo 缺失并由 derive 侧 proposalRemoteUnresolved 暴露，禁止写错 URL
- 错输入: `payload.base_repo` 传非 GitHub 串（如 `"file:///tmp/x"`）→ 观测不得退 origin，应判 unresolved
- 重复提交: 同 source_id 连发两次建单 → 幂等，不产生双份 base_repo 冲突
- 边界值: `payload.repo` 为别名 `perfectuser21/cecelia` 全名 vs 短名 `cecelia` → 两者都规范化为同一完整 URL
- 中途中断: migration 未跑完即 POST → 应 5xx，不得写半截 payload
发现分级: P0/P1（观测退 origin / 写错 URL / 观测故障被记成 gan_no_push_streak）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ground-truth remote 解析 | `tests/ground-truth-proposal-remote.test.js` | `ls-remote 命令串走 GitHub URL，不走 origin`；`不执行 ls-remote origin，proposalRemoteUnresolved=true` | observeProposalBranch is not a function → FAIL |
| ground-truth 回归夹具 | `tests/ground-truth-proposal-remote.test.js` | `对 GitHub URL 返两条 propose 分支、对 origin 返空 → 新码 rn=1`；`仅对 origin 返分支`（模拟旧码退 origin 的本地 workspace）→ rn=0` | observeProposalBranch is not a function → FAIL |
| derive 误判闸 | `tests/derive-no-push-gate.test.js` | `不判 gan_no_push_streak`；`mark_failed reason=proposal_observation_mismatch`；`mark_failed reason=proposal_remote_unresolved`；`仍照旧判 gan_no_push_streak`（零回归） | reason 仍为 gan_no_push_streak / 未识别新 reason → FAIL |
| work-routing 回填 | `tests/work-routing-base-repo-backfill.test.js` | `落库 payload.base_repo 为完整 GitHub URL`；`已带 base_repo 时不覆盖` | payload 无 base_repo → expected null to be truthy → FAIL |
