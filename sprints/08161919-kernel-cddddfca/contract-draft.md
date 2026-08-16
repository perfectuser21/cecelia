# Sprint Contract Draft (Round 1)

覆盖父路 journey e6f803f2（harness GAN 环观测可信度）——独立小路（PrepPRD 未锚定具体 step，step_id=none）

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，代码层 Contract Gate 生效，本合同已按惯用法速查表写断言）

## Golden Path

[建 coding_mutation 任务(缺 base_repo)] → [payload.base_repo 回填规范 URL] → [Proposer 真 push 提案分支] → [kernel 对 GitHub URL 观测 rn≥1] → [真 push 正确计入，不误判 gan_no_push_streak]

---

### Step 1: 建 coding_mutation 任务时回填 base_repo 规范 URL

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + 「预期受影响文件」work-routing-store.js。

**可观测行为**: 调用方 POST 一条 coding_mutation harness_initiative 任务，即使不带 `base_repo`，落库
`tasks.payload->>'base_repo'` 也是规范 clone URL `https://github.com/perfectuser21/cecelia.git`（从
`map_scope_repositories` 的 repo/aliases 推导；短名/别名一律规范化为完整 URL）。

**验证命令**:
```bash
# 单测层（捕获 INSERT INTO tasks 的 payload 参数）
npx vitest run --root sprints/08161919-kernel-cddddfca tests/work-routing-base-repo-backfill.test.js
# 期望：payload.base_repo === https://github.com/perfectuser21/cecelia.git
```

**硬阈值**: `payload.base_repo === 'https://github.com/perfectuser21/cecelia.git'`（字面全等）。

---

### Step 2: kernel 提案 remote 解析优先 base_repo，回退 payload.repo，禁 origin 兜底

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条 + 根因 #1（ground-truth.js:736-739）。

**可观测行为**: `collectGroundTruth` 解析提案 remote 时用
`parseBaseRepo(payload.base_repo) ?? parseBaseRepo(payload.repo)`；命中 `perfectuser21/cecelia` →
对 `"https://github.com/perfectuser21/cecelia.git"` 跑 `git ls-remote`，观测到真实提案分支 → `proposeBranchRn ≥ 1`。
`git ls-remote` 命令串**绝不**再出现 `--heads origin`。

**验证命令**:
```bash
npx vitest run --root sprints/08161919-kernel-cddddfca tests/ground-truth-proposal-remote.test.js
# 期望：ls-remote 命令含 github.com/perfectuser21/cecelia.git；proposeBranchRn===1
```

**硬阈值**: `observed.proposeBranchRn === 1` 且 ls-remote 命令含规范 URL、不含 `ls-remote --heads origin`。

---

### Step 3: base_repo 与 repo 皆解析不到 → proposalRemoteUnresolved，不退 origin

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + Invariant「禁 origin 兜底」。

**可观测行为**: `payload.base_repo` 与 `payload.repo` 均缺失/无法解析时，`collectGroundTruth` **不执行**
`git ls-remote origin`，置 `observed.proposalRemoteUnresolved === true`、`observed.proposeBranchRn === 0`。

**验证命令**:
```bash
npx vitest run --root sprints/08161919-kernel-cddddfca tests/ground-truth-proposal-remote.test.js
# 期望：无 ls-remote origin 调用；observed.proposalRemoteUnresolved===true
```

**硬阈值**: `observed.proposalRemoteUnresolved === true`，且 execCmd 调用中不含含 `origin` 的 ls-remote。

---

### Step 4: derive.js gan_no_push_streak 触发门加 crossCheckMismatch 守卫 + 两新 failure_reason

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 根因 #2（derive.js:899）。

**可观测行为**:
1. `observed.proposalRemoteUnresolved === true` → `derive` 返回 `{phase:'failed', action:'mark_failed', reason:'proposal_remote_unresolved'}`（独立 failure_reason，绝不再折叠回 gan_no_push_streak）。
2. `counters.crossCheckMismatch === true`（proposer 成功回调数 > 观测 rn，即观测故障）且 `noPushStreak` 已达上限
   → `derive` **不**以 `gan_no_push_streak` 失败；改在 GAN 环内继续/重新观测并写 `verdict:proposal_observation_mismatch` 日志行；
   decisionLog 内本 GAN 纪元连续 3 条 `proposal_observation_mismatch` verdict → 才以 `reason='proposal_observation_mismatch'` mark_failed。
3. 零回归：`crossCheckMismatch === false` 且真无 push → 保持 `gan_no_push_streak` 原语义不变。

**验证命令**:
```bash
npx vitest run --root sprints/08161919-kernel-cddddfca tests/derive-gan-no-push-guard.test.js
# 期望：mismatch=true→非 gan_no_push_streak；unresolved=true→proposal_remote_unresolved；mismatch=false→gan_no_push_streak（零回归）
```

**硬阈值**: 三条断言全过（见 tests/derive-gan-no-push-guard.test.js）。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应契约变更。变更为 orchestrator 内部字段（`observed.proposalRemoteUnresolved`、
`observed.proposeBranchRn`）+ `tasks.payload.base_repo` 回填 + `initiative_runs.failure_reason` 新增字符串值
（`proposal_remote_unresolved` / `proposal_observation_mismatch`），无对外新增/变更端点。Reviewer 第 6 维按内部字段
oracle（vitest 断言 + Final E2E psql）核。

**新增 failure_reason 字符串值（非枚举，不改 harness_attempts.failure_class）**:
- `proposal_remote_unresolved`
- `proposal_observation_mismatch`

---

## 已知约束（来自回归测试 + 累积 FR）

- [orchestrator/__tests__/ground-truth.test.js] → collectGroundTruth 用 fake deps 断言 PR/rN 解析；本单沿用其 fakePool/fakeExecCmd 契约，不得破坏 rN 正则解析与 inflight label 过滤。
- [orchestrator/__tests__/derive.test.js] → derive 纯函数全分支：`no_push_streak >= 2 → failed reason=gan_no_push_streak` 原用例必须继续通过（本单只在 crossCheckMismatch=true 时让路，false 分支逐字节不变）。
- [orchestrator/__tests__/counters.test.js] → `crossCheckMismatch = proposerCount !== proposeBranchMaxRn`、`after>before` 语义不得改动（本单不碰 counters.js）。
- [__tests__/integration/work-routing-store.integration.test.js] → createRoutedTask 事务契约（BEGIN/COMMIT、advisory lock、receipt 不可变）不得回退；base_repo 回填只增字段不改事务边界。
- [累积FR] context-manifest: unavailable（proposer 运行时 postgres:false，无法拉取；journey e6f803f2 查询结果均为 planned 态，本 line 暂无已验收 ability）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①建单口缺 base_repo 时回填规范 clone URL；②提案 remote 解析 base_repo→repo 回退 + 禁 origin 兜底；③derive gan_no_push_streak 门加 crossCheckMismatch 守卫 + 两新独立 failure_reason |
| **NFR（做得多好）** | 性能/可靠 | 无新增延迟约束（PrepPRD 未指定）；Brain semver 四处同步；DevGate 三项必过 |
| **Invariant（永不违反）** | 不变量 | 见「## Invariant 覆盖（INV 条目）」；核心：两新 failure_reason 独立、禁 origin 兜底、不改 counters 语义、不改 failure_class 枚举 |
| **判定点（怎么知道）** | 对外部真相的判断假设 | 见「判定点登记表」 |
| **保质期（何时过期）** | 失效/退役 | 永久生效（编排纠错逻辑，无过期）；两新 failure_reason 字符串常驻 |
| **死亡告警（停了谁知道）** | 停摆告警 | 若回填/守卫回退，harness run 会重现 gan_no_push_streak 假失败 → initiative_runs.failure_reason 观测（回归夹具 + Final E2E 是探针） |
| **失败语义（挂了怎么办）** | 故障策略 | 见「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执 | Final E2E psql 回读 tasks.payload->>'base_repo'；kernel --dry-run 输出 observed.proposeBranchRn 来源 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 提案分支是否真实存在（rn 观测） | A. 对 payload 解析出的 GitHub URL 跑 ls-remote; B. 退 origin 跑 ls-remote | A（URL）；无法解析则不跑、置 proposalRemoteUnresolved | origin 是 kernel worktree 本机 remote，永远看不到 GitHub 分支（根因 #1 实证 rn 恒 0） | 真 push 被误判无 push → gan_no_push_streak 假失败终态（生产 run 7a8e5319 实证） |
| ⚠️ rn=0 是真无 push 还是观测故障 | A. 直接判无 push 递增 noPushStreak; B. 用 crossCheckMismatch（proposerCount>观测rn）区分观测故障 | B | proposer 成功回调数 > 观测 rn = 记了没看到 = 观测故障，非真无 push | 观测故障被当真无 push → 假失败（无人消费 crossCheckMismatch，根因 #2 实证） |

> ⚠️ 两条判定点误判后果严重（假失败终态直接杀 run）。PrepPRD 已在 PRD 根因契约中拍板（禁 origin 兜底 + crossCheckMismatch 守卫为 Invariant），无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 提案 remote 无法解析（base_repo+repo 皆空） | mark_failed reason=proposal_remote_unresolved，拦截，不退 origin | 是（纯观测，无副作用） | 建单口回填 base_repo 从源头消除；否则 fail-closed 显式失败而非静默假绿 |
| 观测故障（crossCheckMismatch=true） | 不失败，写 proposal_observation_mismatch 日志并重新观测；连续 3 次才 mark_failed reason=proposal_observation_mismatch | 是（重新观测幂等） | 让 ground-truth remote 修复在下一跳自愈 rn；有界重试防死循环 |
| crossCheckMismatch=false 且真无 push | mark_failed reason=gan_no_push_streak（原语义） | 是 | 原行为不变（零回归） |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单为 Brain 内部 orchestrator + 建单口逻辑，无对外暴露 agent 输入面。

---

## Invariant 覆盖（INV → DoD BEHAVIOR 映射）

| 铁律 | 覆盖方式 | 落点 |
|------|----------|------|
| INV-独立失败因（proposal_remote_unresolved / proposal_observation_mismatch 独立，不折叠回 gan_no_push_streak） | 可执行断言 | contract-dod.md **B-03**（reason 字面值断言） |
| INV-禁 origin 兜底（base_repo+repo 皆解析不到时不跑 ls-remote origin） | 可执行断言 | contract-dod.md **B-02**（无 origin ls-remote 调用断言） |
| INV-不改语义（counters.js after>before / crossCheckMismatch 计算不动） | N/A 断言（守恒核查） | 本单 diff 不触碰 packages/brain/src/orchestrator/counters.js（Reviewer git diff 核实） |
| INV-不加枚举（harness_attempts.failure_class 不变） | N/A 断言（守恒核查） | 本单只加 initiative_runs.failure_reason 字符串值，无 migration、无枚举改动（Reviewer 核 diff 无 migration 文件） |

---

## 禁 mock 边清单

本单涉及「跨模块数据传递」（payload → ground-truth 提案 remote 解析）与「DB 写路径」（createRoutedTask payload 落库），故：

- **payload ↔ ground-truth 提案 remote 解析**（本单改 taskPayload → proposalRemote 字符串这条边）：`tests/ground-truth-proposal-remote.test.js` **真调** `collectGroundTruth`，不 mock 其内部；只 stub 最外层 git 子进程（execCmd）与 DB（pool）——这两者是 Golden Path 之外的外部边界（git CLI / Postgres 驱动），按规则属「更外层无关依赖」，允许 stub。被改的边（payload→remote 字符串→ls-remote 命令）全程真跑，断言落在 execCmd 收到的真实命令串上。
- **derive ↔ counters 数据**（crossCheckMismatch 守卫）：`tests/derive-gan-no-push-guard.test.js` 真调纯函数 `derive`，无 mock（derive 刻意不 import DB）。crossCheckMismatch 由 counters.js 计算，本单不改其计算，测试直接注入 observed.counters（与 loop.js 生产注入路径同形）。
- **代码 ↔ tasks 表（DB 写路径）**：`createRoutedTask` 的 payload 构造（新增 base_repo）在 `tests/work-routing-base-repo-backfill.test.js` 用仓库既有约定的捕获 client 断言 INSERT INTO tasks 的 payload 参数（照抄 work-routing-store.integration.test.js 的 vi.fn 捕获模式）。**真实 PG 落库回读**这条 DB 写边由 `## E2E 验收`（local_api，Fleet 注入真 `$DB_URL`）用 psql 查 `tasks.payload->>'base_repo'` 独立真验，见「## 未覆盖真实链路清单」登记。

---

## 未覆盖真实链路清单

- **createRoutedTask 单测用捕获 client（非真 PG）| 为什么**：proposer 起草期 `runtime_resources.postgres=false`，且冻结合同单测须能在无 PG 的 CI 通道运行；捕获 client 断言的是本单唯一改动点（payload 构造），DB 事务边界本单未改。**真验证补位**：`## E2E 验收`（local_api，Fleet 注入真 `$DB_URL`）跑真 `createRoutedTask`/建单 API 后 psql 回读 `tasks.payload->>'base_repo'`——由 Evaluator 在 harness_evaluate task 执行，真 PG 覆盖 DB 写边。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
REPO_ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$REPO_ROOT"

# 1. 空库 bootstrap：跑仓库真实 migration，机检目标表存在。
node packages/brain/scripts/run-migrations.mjs 2>/dev/null \
  || node packages/brain/src/migrate.js 2>/dev/null \
  || npm --prefix packages/brain run migrate 2>/dev/null || true
psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: tasks 表未就绪"; exit 1; }
psql "$DB_URL" -tAc "SELECT to_regclass('public.map_scope_repositories') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: map_scope_repositories 表未就绪"; exit 1; }

# 2. 单测层三根因全绿（proposer 冻结测试的实现后回归）。
npx vitest run --root sprints/08161919-kernel-cddddfca \
  tests/ground-truth-proposal-remote.test.js \
  tests/derive-gan-no-push-guard.test.js \
  tests/work-routing-base-repo-backfill.test.js --reporter=basic \
  || { echo "FAIL: 冻结合同单测未全绿"; exit 1; }

# 3. 建单口回填 base_repo 真 PG 验证：跑 createRoutedTask 对真库落一条不带 base_repo 的
#    coding_mutation 任务，psql 回读 tasks.payload->>'base_repo' 必须是完整 URL。
node -e '
  const pg = require("pg");
  const { createRoutedTask } = require("./packages/brain/src/work-routing-store.js");
  (async () => {
    const pool = new pg.Pool({ connectionString: process.env.DB_URL });
    const facts = [{ scope_key: "cecelia", repo: "cecelia", aliases: ["perfectuser21/cecelia"] }];
    const sid = "e2e-backfill-" + Date.now();
    const res = await createRoutedTask(pool, {
      source: "api", source_id: sid, title: "e2e base_repo backfill",
      description: "缺 base_repo 建单回填", mutation_intent: "write",
      declared_change_kind: "bugfix", repo_hint: "cecelia", map_scope_hint: ["F1"],
      branch: "cp-e2e-backfill", base_sha: "a".repeat(40),
    }, facts).catch((e) => { console.error("createRoutedTask err", e.message); process.exit(3); });
    const row = await pool.query("SELECT payload->>\x27base_repo\x27 AS base_repo FROM tasks WHERE id=$1", [res.task_id]);
    const got = row.rows[0] && row.rows[0].base_repo;
    if (got !== "https://github.com/perfectuser21/cecelia.git") {
      console.error("FAIL: base_repo=" + got); process.exit(1);
    }
    console.log("OK: tasks.payload.base_repo=" + got);
    await pool.end();
  })();
' || { echo "FAIL: 真 PG 未回读到规范 base_repo（node 退非 0）"; exit 1; }

echo "✅ Golden Path 验证通过（建单回填 + 提案 remote 解析 + derive 守卫）"
```

> 说明：map 认证节点 'F1' 若 scratch 库未激活，node 段以 exit 3 显式失败（不静默），Evaluator 据此判 map bootstrap 缺失而非误判绿。kernel `run.js --dry-run` 对该 task 输出 observed.proposeBranchRn 来源（GitHub URL vs origin）作为 Step 2/3 的补充人工核查点，随 Evaluator 环境能力执行。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `payload.repo` 传无法解析的垃圾短名（如 `repo:"nonexistent-xyz"`）→ 应 proposalRemoteUnresolved=true，不退 origin、不崩溃。
- 别名歧义: `payload.base_repo` 传别名 URL（含 `.git` / 结尾 `/`）→ parseBaseRepo 应正确归一化到 `perfectuser21/cecelia`。
- 重复提交: 同 source_id 重放 createRoutedTask（幂等）→ base_repo 回填不得破坏既有幂等重放（复用已冻结 receipt evidence）。
- 边界值: crossCheckMismatch=true 恰好连续第 3 次 mismatch → 边界应 mark_failed reason=proposal_observation_mismatch，第 2 次不失败。
发现分级: P0/P1（假失败终态复发/建单口回填破坏幂等）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
