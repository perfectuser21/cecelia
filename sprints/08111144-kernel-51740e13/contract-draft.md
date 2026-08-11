# Sprint Contract Draft (Round 1) — 合并权收归单一裁决闸（harness-judge required check）

**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 覆盖父路 F1 开发闭环（journey e6f803f2）· 步4「交付有回执」(36121154) 第 1-6 步（本 sprint 即该步的「裁决闸不可绕过」实现，非独立小路）

gp-anchor: skipped (product-map.json not found)
contract-gate: present（packages/brain/src/lib/contract-gate.js 存在，本仓 cecelia，代码层 Contract Gate 生效，断言按「Contract Gate 合规惯用法速查表」书写）

---

## Response Schema（推导来源: NEW_PATTERN — registry 不可达，按仓内既有 harness 端点 snake_case + `error` 惯例推导；PRD 显式留给 proposer 定义）

### Endpoint: GET /api/brain/harness/pr-ownership

用途：给定一个 PR 号，查 `initiative_runs.pr_url` 是否存在精确匹配（`/pull/<pr_number>` 结尾），回答该 PR 是否属于某个 harness run。归属只凭 `pr_url`（kernel/relay-watchdog 写入），**不看标题/分支名**。

**入参**（query string）：
- `pr_number` (integer, 必填): 目标 PR 号。非正整数 → 400。

**Success (HTTP 200) — 属于某 harness run**:
```json
{"owned": true, "run_id": "11111111-1111-4111-8111-111111111111", "pr_number": 4755, "reason": "matched initiative_runs.pr_url"}
```

**Success (HTTP 200) — 不属于任何 harness run（真手动 /dev）**:
```json
{"owned": false, "run_id": null, "pr_number": 999123, "reason": "no initiative_runs.pr_url matches"}
```

- `owned` (boolean, 必填): true=harness-owned；false=无匹配。来源——NEW_PATTERN（本端点核心判据）。
- `run_id` (string|null, 必填): 命中的 `initiative_runs.id`（UUID）；owned=false 时为 null。来源——NEW_PATTERN。
- `pr_number` (integer, 必填): 回显入参，便于脚本/日志对账。来源——NEW_PATTERN。
- `reason` (string, 必填): 可追溯的判定原因串（NFR 可观测要求）。来源——NEW_PATTERN。

**禁用字段名**（不得作为正向断言字段名出现）: `is_harness`、`harness_owned`、`ownership`、`belongs`、`result`、`data`（同义替换词，统一用 `owned`）。

**Error (HTTP 400) — pr_number 非法**:
```json
{"error": "pr_number must be a positive integer"}
```

**Error (HTTP 500) — DB 异常**:
```json
{"error": "<db error message>"}
```

> 说明：端点本身**只如实回答归属**（200 owned / 200 not_owned / 400 / 500）。**fail-closed 语义在通道 1 脚本侧**（脚本把「curl 失败 / 超时 / 非 200 / 非法 JSON / owned 字段缺失」一律当 harness-owned → SKIP）。端点不返回 fail-closed 状态。

---

## Golden Path

[cp-* PR 的 CI 转绿] → [通道 1 脚本向 Brain 求证归属] → [harness-owned 则 SKIP + harness-judge check 默认 pending 物理挡住 --auto] → [kernel mergeGate 全过后置 harness-judge=success] → [PR 方可合并]

### Step 1: 通道 1 脚本以 PR 号向 Brain 归属端点求证（判据从标题正则换成 Brain 求证）
**来源**: `[FROM_PRD]` — PRD「必须实现」第 3 条 + 范围限定第 1 条（`should-auto-merge.sh` 判据由标题改 Brain 归属求证，fail-closed）

**可观测行为**: `.github/workflows/scripts/should-auto-merge.sh <head_branch> <pr_number>`，对 cp-* 分支 curl `GET $BRAIN_URL/api/brain/harness/pr-ownership?pr_number=<n>`（带 `--max-time` 超时）；`owned:true`→输出 `SKIP:...`；`owned:false`→输出 `MERGE`；curl 失败/超时/非 200/非法 JSON/owned 缺失→输出 `SKIP:...`（fail-closed）。非 cp-* 分支保留原 SKIP 行为。**脚本不再读 PR 标题**。

**验证命令**（bash 单测 + E2E 真 Brain；见 ## E2E 验收）:
```bash
# 单测（fake curl shim，自足）：owned:true → SKIP
BRAIN_URL=http://x bash .github/workflows/scripts/should-auto-merge.sh cp-x 4755 | grep -q '^SKIP'
# E2E（真 Brain）：见 ## E2E 验收 步骤 6
```
**硬阈值**: owned:true→stdout 以 `SKIP` 开头且 exit 0；owned:false→stdout 含 `MERGE`。

---

### Step 2: Brain 归属端点按 initiative_runs.pr_url 精确匹配回答归属
**来源**: `[FROM_PRD]` — PRD「必须实现」第 2 条 + 范围限定第 2 条（新增/接线 Brain 归属查询端点，依据 `initiative_runs.pr_url`）

**可观测行为**: `GET /api/brain/harness/pr-ownership?pr_number=4755` 命中已写入 `pr_url` 的 run → `{owned:true, run_id:<uuid>}`；未命中 → `{owned:false, run_id:null}`；`pr_number=abc` → 400 `{error}`。匹配须精确到 `/pull/<n>` 结尾（`pr_number=475` 不得命中 `/pull/4755`）。

**验证命令**:
```bash
psql "$DB_URL" -c "INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(), 'https://github.com/perfectuser21/cecelia/pull/4755')"
curl -sf "localhost:5221/api/brain/harness/pr-ownership?pr_number=4755" | jq -e '.owned == true and (.run_id | type == "string")'
curl -sf "localhost:5221/api/brain/harness/pr-ownership?pr_number=475" | jq -e '.owned == false'   # 前缀不得误命中
```
**硬阈值**: 命中 owned=true 且 run_id 为 UUID 字符串；前缀号 owned=false；非法号 HTTP 400。

---

### Step 3: harness-owned PR 在 kernel 置 success 前 harness-judge check 非 success（物理挡住 --auto）
**来源**: `[FROM_PRD]` — PRD「必须实现」第 1 条 + Invariant「裁判前不可合并」

**可观测行为**: GitHub 分支保护把 `harness-judge` 注册为 required status check（[ASSUMPTION] 见下）；harness-owned PR 从未有人上报该 context → GitHub 视为 pending → `gh pr merge --auto` 与通用 auto-merge 都排队等待，PR 物理不可合并。本 PR 负责「kernel 侧置 success」与「归属侧决定是否放行」，required check 的分支保护注册由配置提供。

**验证命令**（接缝——GitHub 原生行为，真目标验证见接缝清单）:
```bash
# 逻辑侧（可 CI 验）：kernel 未置 success 前，merge_pr 未被派发（无 judge PASS → mergeGate deny）
# 见 Step 4 的 mergeGate 单测；GitHub --auto 排队行为属接缝，见 ## 接缝清单
echo "接缝：GitHub required-check 排队为原生机制，真目标验证在真实 PR 上"
```
**硬阈值**: 无 judge PASS 时 `mergeGate({judgeVerdict:null,...}).allow === false`（reason=judge_verdict_missing）。

---

### Step 4: kernel mergeGate 全过后，merge_pr 在 gh pr merge 之前置 harness-judge check=success
**来源**: `[FROM_PRD]` — PRD「必须实现」第 1 条 + 范围限定第 3 条（kernel 在 mergeGate 全部条件满足后置 `harness-judge`=success，不改 mergeGate 判定条件本身）

**可观测行为**: `packages/brain/src/orchestrator/kernel-handlers.js` 的 `merge_pr(ctx)` 在 CLEAN 合并路径上，先 `gh api repos/<owner>/<repo>/statuses/<head_sha> -X POST -f state=success -f context=harness-judge`，**再** `gh pr merge`。BEHIND/CONFLICTING 路径不置 success（未真正合并）。mergeGate 判定条件（evaluate PASS + judge PASS + verdict SHA 锚定 + 人审）**不改**。

**验证命令**:
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js -t 'harness-judge' 2>&1 | grep -E 'passed|✓'
```
**硬阈值**: 单测断言 execCmd 被以 `statuses/<sha> ... state=success ... context=harness-judge` 调用，且该调用序号 < `gh pr merge` 调用序号；BEHIND/CONFLICTING 路径不出现 statuses 调用。

---

### Step 5: 手动 /dev 的 cp-* PR（Brain 明确 not_owned）照旧被通用 auto-merge 合并（红线：不回归）
**来源**: `[FROM_PRD]` — PRD「必须实现」第 5 条 + Invariant「不误拦 /dev」

**可观测行为**: Brain 返回 `owned:false` 的 cp-* PR → 脚本输出 `MERGE` → ci.yml auto-merge job 照旧 `gh pr merge --auto`。误拦会卡死所有 /dev 流程（红线）。

**验证命令**:
```bash
# not_owned → MERGE（fake curl 自足单测 + E2E 真 Brain 用一个从未 seed 的 pr_number）
curl -sf "localhost:5221/api/brain/harness/pr-ownership?pr_number=99900001" | jq -e '.owned == false'
```
**硬阈值**: 未 seed 的 pr_number → owned:false → 脚本 stdout 含 `MERGE`。

---

### Step 6: 回归——#4755 / #4759 两起事故在新机制下均判定 harness-owned / SKIP
**来源**: `[FROM_PRD]` — PRD Golden Path 出口 + 验收「回归断言（真实历史数据）」

**可观测行为**: seed 两条 run（pr_url 分别指向 `/pull/4755`、`/pull/4759`），以分支 `cp-08101107-04e4690d`(4755) 与 `cp-08101246-643b5302`(4759) 调用脚本 → 两者均 `owned:true` → 脚本均输出 `SKIP`。当天两起绕过 judge 的合并不会重演。

**验证命令**:
```bash
psql "$DB_URL" -c "INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(),'https://github.com/perfectuser21/cecelia/pull/4759')"
BRAIN_URL=http://localhost:5221 bash .github/workflows/scripts/should-auto-merge.sh cp-08101246-643b5302 4759 | grep -q '^SKIP'
```
**硬阈值**: 4755 与 4759 两分支均 owned:true、脚本均 SKIP。

---

## 真实调用方请求 shape

本 sprint 的「真实调用方」是 **CI 通用 auto-merge job（ci.yml `auto-merge` step）** 调用 `should-auto-merge.sh`，以及 **should-auto-merge.sh 作为 HTTP 调用方**调 Brain 归属端点。逐字段对齐生产调用方：

| 调用方 | 认证方式 | 关键字段（逐字） | Content-Type |
|---|---|---|---|
| ci.yml auto-merge step → should-auto-merge.sh | 无（本地进程 arg） | `$1=HEAD_BRANCH`（`${{ github.head_ref }}`）、`$2=PR_NUMBER`（`${{ github.event.pull_request.number }}`，**替换原 `$2=PR_TITLE`**）；`BRAIN_URL` 走 env（`${{ vars.BRAIN_URL \|\| 'http://localhost:5221' }}`，已在 job env 中） | — |
| should-auto-merge.sh → Brain | 无（内网 GET） | query `pr_number=<整数>`；path `/api/brain/harness/pr-ownership` | — |

> 生产 ci.yml 现状：`should-auto-merge.sh "$HEAD_BRANCH" "$PR_TITLE"`；`PR_NUMBER` 与 `BRAIN_URL` 已存在于同一 step 的 env（见 .github/workflows/ci.yml auto-merge job）。本 PR 把第二个实参从 `$PR_TITLE` 改为 `$PR_NUMBER`，不新增 env。

---

## 禁 mock 边清单

本单涉及「跨模块数据传递（脚本↔Brain HTTP）」+「DB 读路径（端点↔initiative_runs）」+「生命周期钩子（kernel merge_pr）」，以下边**禁 mock**，failing test / E2E 必须真跑：

- **should-auto-merge.sh ↔ Brain pr-ownership 端点（HTTP）**：`## E2E 验收` 中用真 curl 打真 Brain（真 `node server.js` + 真端点），不得用 fake curl 冒充这条边。（fast 单测允许用 fake curl shim 单独覆盖 5xx/非法 JSON/超时三态，但真 HTTP 边必须由 E2E 覆盖至少一次 owned/not_owned。）
- **Brain pr-ownership 端点 ↔ initiative_runs 表（Postgres 读）**：端点集成测试与 E2E 必须打真 Postgres（`$DB_URL`，真 migration bootstrap 后 seed 真行），禁止 mock pool 返回假 owned。
- **kernel merge_pr ↔ gh（execCmd 外部边界）**：`execCmd`（gh CLI）是外部工具边界，单测允许 spy（断言调用序列与参数），**但不得 mock 掉 merge_pr 自身逻辑**——必须真调 `createKernelHandlers(deps).merge_pr(ctx)` 走真实分支判断。

（无纯 UI/纯文档豁免；本单为后端+CI 接缝改动。）

---

## 接缝清单（碰真实世界的点 — 逻辑断言 vs 接缝断言）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 状态 |
|---|---|---|---|---|
| 1 | GitHub required status check 排队 `--auto` | `harness-judge` 作为 required check 时，GitHub 原生排队机制挡住 `gh pr merge --auto`——这是 GitHub 行为，非本仓代码 | 需真实 GitHub PR + 分支保护配置：构造一个 harness-owned PR，未上报 `harness-judge` → 观察 `gh pr merge --auto` 排队不合并；kernel `gh api statuses ... state=success` 后 → PR 合并。**真目标=真实 GitHub 仓库** | `logic-done-pending`（GitHub 原生机制，CI/本地无法复现分支保护；逻辑侧由 Step 3/4 单测+E2E 兜住：未 judge PASS 则 kernel 不置 success、脚本 SKIP） |
| 2 | ci.yml auto-merge step 实参改 `$PR_NUMBER` | 真实 CI 运行时 `github.event.pull_request.number` 注入 | 逻辑侧可 CI 验（bash 结构测断言 step 调 `should-auto-merge.sh "$HEAD_BRANCH" "$PR_NUMBER"`）；真目标由后续真实 PR 触发 CI 观察 | logic-done（结构断言 CI 可验） |

> 逻辑断言（环境无关，CI 绿=done）：端点归属判定、脚本五态决策、mergeGate deny、kernel 置 status 顺序、回归两分支——全部 CI/E2E 可验。
> 接缝断言（真目标验）：接缝 #1 的「GitHub `--auto` 真排队」标 `logic-done-pending`，须在真实 GitHub PR 上校准，不得写死「GitHub 一定会挡」当已验。

---

## 未覆盖真实链路清单

- **接缝 #1（GitHub required-check 真排队）**：无法在隔离 evaluator/CI 环境复现 GitHub 分支保护，`gh pr merge --auto` 的真实排队行为标 `logic-done-pending`。真验证补位计划：主理人在 cecelia 仓分支保护中把 `harness-judge` 注册为 harness-owned PR 的 required check 后，用一个真实 harness-owned PR 走一遍（谁=主理人/kernel 运维；何时=required check 上线后首个 harness run；环境=真实 GitHub）。**在其注册前，通道 1 的 Brain 求证判据即可独立兜住通道 1**（PRD 边界情况第 4 条）。
- **engine-pr-watchdog（通道 3）改造**：本 PR 不改 zenithjoy-skills 源（不在 WORKSPACE_REPOSITORIES）。改造说明 + 所需 Brain 端点契约见交付物 `${SPRINT_DIR}/engine-pr-watchdog-retrofit.md`（[ARTIFACT]）。通道 3 落地前由第 1 条 required check 兜住。
- **B-04/B-05 快验单测用 fake curl（PATH 注入）顶替 Brain HTTP**：仅为确定性覆盖 fail-closed 三态 / 决策三态（无需起 Brain）。该「脚本↔Brain HTTP」真实边由 `## E2E 验收`（真 `node server.js` + 真端点）与 B-01/B-02/B-06（真 curl localhost:5221）覆盖 owned/not_owned/回归，**非静默 mock**（已登记于 ## 禁 mock 边清单）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 新增 Brain `GET /harness/pr-ownership` 归属端点；通道 1 脚本判据换 Brain 求证（fail-closed）；kernel merge_pr 在合并前置 `harness-judge` status=success；产出通道 3 改造说明 |
| **NFR（做得多好）** | 非功能 | 脚本对 Brain 求证设 `--max-time`（5s）超时；超时/5xx/非法 JSON/owned 缺失一律 fail-closed→SKIP；判定原因串可追溯 |
| **Invariant（永不违反）** | 不变量 | 裁判前不可合并；fail-closed；不误拦 /dev；归属只信 initiative_runs.pr_url；不动裁决内核（mergeGate/evaluator/judge/gear 不改） |
| **判定点（怎么知道）** | 见判定点登记表 | 见下方登记表 |
| **保质期（何时过期）** | 失效条件 | 归属判定随 `initiative_runs.pr_url` 生命周期；pr_url 写入后长期有效，run 记录不删则判定稳定 |
| **死亡告警（停了谁知道）** | 告警 | Brain 端点 5xx → 脚本 fail-closed SKIP（安全侧）；脚本输出原因串进 CI 日志，auto-merge job 失败会 PATCH Brain task failed（沿用既有回写） |
| **失败语义（挂了怎么办）** | 见失败语义声明 | 见下方 |
| **效果确认（已发≠已生效）** | 回执 | 端点回显 `pr_number` + `reason`；脚本 stdout `SKIP:<原因>`/`MERGE` 可对账；kernel 置 status 后 `gh api statuses` 返回可查 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 某 PR 是否 harness-owned | A. PR 标题 `feat(harness):` 前缀; B. 分支名; C. `initiative_runs.pr_url` 精确匹配 | C. `initiative_runs.pr_url` 精确匹配（`/pull/<n>` 结尾） | 标题/分支名是 LLM 自由撰写（#4755 实证漏过）；pr_url 由 kernel/relay-watchdog 写入，非 LLM | 判 not_owned 而实为 owned → 绕过 judge 被合并（#4755/#4759 重演，直接面客错误，不可逆） |
| ⚠️ Brain 求证失败时如何取默认 | A. fail-open（当 not_owned→MERGE）; B. fail-closed（当 owned→SKIP） | B. fail-closed | 宁可卡住等 kernel 也不放绕过 judge 的合并；误 SKIP 的手动 /dev PR 可人工合，误 MERGE 的 harness PR 不可逆 | 若 fail-open 则 Brain 抖动瞬间恢复绕过（红线破） |

> ⚠️ 两个判定点误判后果严重（不可逆合并 / 绕过裁决）。PrepPRD 已在 Invariant 明确 fail-closed 与「归属只信 pr_url」，属已拍板红线，无需再升拍板点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写库 | 是（幂等键 task_id） | 客户端重试 |
| 脚本对 Brain 求证超时/连接拒绝 | 输出 `SKIP:fail-closed(...)`，exit 0 | 是（纯查询无副作用） | fail-closed：当 harness-owned 处理，交 kernel gate |
| 脚本收 Brain 5xx / 非法 JSON / owned 字段缺失 | 输出 `SKIP:fail-closed(...)`，exit 0 | 是 | fail-closed → SKIP |
| 端点 DB 查询异常 | 返回 500 `{error}` | 是（只读查询） | 脚本侧 fail-closed 兜住 |
| kernel `gh api statuses` 失败 | execCmd throw → merge_pr 抛错 → 本 hop 不合并，下一轮重试 | 是（status POST 幂等，同 context 覆盖） | 保留审计，交下一轮 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | 本 sprint 无对外暴露 agent；`pr_number` 为整数入参，非自然语言，端点做正整数校验并参数化 SQL（防注入），不构成 prompt injection 面 |

---

## 已知约束（来自回归测试 + 累积 FR）

- [.github/workflows/scripts/__tests__/should-auto-merge.test.sh] → 「harness PR（feat(harness):）→ 跳过 auto-merge」「普通 fix(brain) PR → 正常 auto-merge」「非 cp-* 分支 → 跳过」「auto-merge 可越过 needs 链中的 skipped jobs（always()）」「auto-merge 排队等待全部分支保护条件（--auto）」「auto-merge job 具备最小写权限」
  - 约束迁移：标题类断言（feat(harness):→SKIP / fix→MERGE）随判据改 Brain 后**语义变更**，generator 必须把这些用例改成「Brain owned:true→SKIP / owned:false→MERGE / 非 cp-*→SKIP」；workflow 结构类断言（always() / --auto / 写权限）**保留不动**，另新增「auto-merge step 以 `$PR_NUMBER` 而非 `$PR_TITLE` 调脚本」结构断言。
- [packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js] → 「merge 按 GitHub 真相处理 CLEAN / BEHIND / CONFLICTING」「BEHIND 补齐走版本无关 gh api PUT」「连续三次 BEHIND 封顶」——generator 新增 status=success 调用**不得破坏**这些既有断言（CLEAN 路径新增一条 execCmd 调用，BEHIND/CONFLICTING 路径不新增）。
- [packages/brain/src/orchestrator/gates.js] → `mergeGate` 判定条件**不改**（Invariant 不动裁决内核）。
- [累积FR] context-manifest: unavailable（Brain 不可达，无法拉取 journey e6f803f2 累积 FR；PRD 已注明本 line 暂无历史）
- **DevGate（改 packages/brain 必过）**：generator 提交前须过 `node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`（brain 版本四处同步 + package.json version bump）、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。本 sprint **不新增 migration / 不改 EXPECTED_SCHEMA_VERSION**（仅新增只读端点 + 处理器逻辑）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `GET /harness/pr-ownership?pr_number=-1` / `?pr_number=0` / `?pr_number=1e9` / `?pr_number=4755;DROP TABLE` → 期望 400 或安全（参数化，不注入），绝不 500 崩或误 owned
- 前缀误命中: seed `/pull/4755`，查 `pr_number=475` 与 `pr_number=47550` → 均须 owned:false（`/pull/` 精确结尾匹配，不被 LIKE 前缀/子串误伤）
- 重复提交: 同一 pr_number 连查两次 → 幂等同结果；kernel 对同一 head_sha 重复置 status=success → 幂等覆盖不报错
- 中途中断: 脚本 curl 进行中 Brain 被 kill → fail-closed SKIP，不 hang（`--max-time` 生效）
- 边界值: pr_url 带尾部 `/`（`/pull/4755/`）或 `/files` 后缀是否仍精确命中 4755；多条 run 同 pr_url 时 run_id 取其一不报错
发现分级: P0/P1（误判 not_owned 致绕过 judge / 端点 500 崩 / SQL 注入）→ 阻塞 merge；P2/P3（reason 串不精确、日志噪音）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> journey_type=autonomous；evaluator 本地执行。脚本自足：解析 `$DB_URL` → 真 migration bootstrap 空库 → 启真 Brain（`node server.js`）→ seed 真 initiative_runs → 真 curl 端点 + 真跑 should-auto-merge.sh + 真跑 kernel-handlers 单测。禁 mock 被改的边（脚本↔Brain HTTP、端点↔Postgres 均真跑）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
REPO="perfectuser21/cecelia"
BASE_URL="http://127.0.0.1:5221"
SCRIPT=".github/workflows/scripts/should-auto-merge.sh"
BRAIN_PID=""
FAKE_DIR="$(mktemp -d)"
cleanup() {
  [ -z "$BRAIN_PID" ] || kill "$BRAIN_PID" 2>/dev/null || true
  rm -rf "$FAKE_DIR" /tmp/harness-brain.log 2>/dev/null || true
}
trap cleanup EXIT

# 0. 解析 attempt DB_URL → 离散 DB_* 环境变量（server.js/db.js/migrate.js 走 DB_DEFAULTS 离散变量）
eval "$(node -e '
const u = new URL(process.env.DB_URL);
const q = (s) => String(s).replace(/"/g, "\\\"");
console.log(`export DB_HOST="${q(u.hostname)}"`);
console.log(`export DB_PORT="${q(u.port || 5432)}"`);
console.log(`export DB_USER="${q(decodeURIComponent(u.username))}"`);
console.log(`export DB_PASSWORD="${q(decodeURIComponent(u.password))}"`);
console.log(`export DB_NAME="${q(u.pathname.replace(/^\//, ""))}"`);
')"
export PORT=5221

# 1. 真 migration bootstrap 空库，机检目标表存在
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('public.initiative_runs') IS NOT NULL" | grep -qx t || { echo "FAIL: initiative_runs 表未创建"; exit 1; }

# 2. 启真 Brain，等健康端点就绪
node packages/brain/server.js >/tmp/harness-brain.log 2>&1 &
BRAIN_PID=$!
for i in $(seq 1 60); do
  curl -sf "$BASE_URL/api/brain/harness/ping" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "FAIL: Brain 未就绪"; tail -30 /tmp/harness-brain.log; exit 1; }
  sleep 1
done

# 3. seed 真 initiative_runs（#4755 / #4759 归属行）
psql "$DB_URL" -c "INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(), 'https://github.com/perfectuser21/cecelia/pull/4755')"
psql "$DB_URL" -c "INSERT INTO initiative_runs (initiative_id, pr_url) VALUES (gen_random_uuid(), 'https://github.com/perfectuser21/cecelia/pull/4759')"

# 4. 端点：owned / not_owned / 前缀不误命中 / error path（真 HTTP 真 Postgres）
curl -sf "$BASE_URL/api/brain/harness/pr-ownership?pr_number=4755" | jq -e '.owned == true and (.run_id | type == "string") and .pr_number == 4755' || { echo "FAIL: 4755 应 owned"; exit 1; }
curl -sf "$BASE_URL/api/brain/harness/pr-ownership?pr_number=99900001" | jq -e '.owned == false and .run_id == null' || { echo "FAIL: 未 seed 号应 not_owned"; exit 1; }
curl -sf "$BASE_URL/api/brain/harness/pr-ownership?pr_number=475" | jq -e '.owned == false' || { echo "FAIL: 前缀 475 误命中 4755"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/brain/harness/pr-ownership?pr_number=abc")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 pr_number 未返 400（实际 $CODE）"; exit 1; }

# 5. 脚本 × 真 Brain：owned→SKIP / not_owned→MERGE / 非 cp-*→SKIP
OUT=$(BRAIN_URL="$BASE_URL" bash "$SCRIPT" cp-08101107-04e4690d 4755); echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: owned 未 SKIP: $OUT"; exit 1; }
OUT=$(BRAIN_URL="$BASE_URL" bash "$SCRIPT" cp-manual-dev 99900001); echo "$OUT" | grep -q 'MERGE' || { echo "FAIL: not_owned 未 MERGE: $OUT"; exit 1; }
OUT=$(BRAIN_URL="$BASE_URL" bash "$SCRIPT" feature/manual xyz); echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: 非 cp-* 未 SKIP: $OUT"; exit 1; }

# 6. 回归红线：#4755 / #4759 两分支均 SKIP（当天事故不重演）
OUT=$(BRAIN_URL="$BASE_URL" bash "$SCRIPT" cp-08101107-04e4690d 4755); echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: #4755 回归"; exit 1; }
OUT=$(BRAIN_URL="$BASE_URL" bash "$SCRIPT" cp-08101246-643b5302 4759); echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: #4759 回归"; exit 1; }

# 7. fail-closed（真脚本 × 连接拒绝的 Brain）→ SKIP
OUT=$(BRAIN_URL="http://127.0.0.1:1" bash "$SCRIPT" cp-x 4755); echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: 连接拒绝未 fail-closed SKIP: $OUT"; exit 1; }

# 8. 脚本 fail-closed 三态（fake curl shim：5xx / 非法 JSON / 超时）→ 均 SKIP
cat > "$FAKE_DIR/curl" <<'FAKE'
#!/bin/bash
case "$FAKE_MODE" in
  5xx)     printf '{"error":"boom"}\n500'; exit 0 ;;
  badjson) printf 'not-json\n200'; exit 0 ;;
  timeout) exit 28 ;;   # curl 超时退出码
  owned)   printf '{"owned":true,"run_id":"11111111-1111-4111-8111-111111111111","pr_number":4755,"reason":"x"}\n200'; exit 0 ;;
  notowned)printf '{"owned":false,"run_id":null,"pr_number":1,"reason":"x"}\n200'; exit 0 ;;
esac
FAKE
chmod +x "$FAKE_DIR/curl"
for m in 5xx badjson timeout; do
  OUT=$(FAKE_MODE=$m PATH="$FAKE_DIR:$PATH" BRAIN_URL="$BASE_URL" bash "$SCRIPT" cp-x 4755)
  echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: fail-closed[$m] 未 SKIP: $OUT"; exit 1; }
done
OUT=$(FAKE_MODE=notowned PATH="$FAKE_DIR:$PATH" BRAIN_URL="$BASE_URL" bash "$SCRIPT" cp-x 1); echo "$OUT" | grep -q 'MERGE' || { echo "FAIL: fake not_owned 未 MERGE"; exit 1; }

# 9. kernel merge_pr 置 harness-judge=success 且序在 gh pr merge 之前（真跑单测）
npx vitest run packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js 2>&1 | tail -20 | grep -qE 'passed|✓' || { echo "FAIL: kernel-handlers 单测未过"; exit 1; }

# 10. 通道 1 脚本 bash 单测（含 workflow 结构断言）真跑
bash .github/workflows/scripts/__tests__/should-auto-merge.test.sh

echo "✅ Golden Path 验证通过：归属端点 + 脚本五态 + 回归 + kernel 置闸"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 通道 1 归属判据（脚本↔Brain 边） | `sprints/08111144-kernel-51740e13/tests/pr-ownership-gate.red.test.ts` | `harness-owned(owned:true) 应 SKIP`、`Brain 5xx 应 fail-closed SKIP`、`not_owned 的 cp-* 应 MERGE 不回归 dev` | → ≥2 failures（当前脚本按标题判、无 Brain 求证；owned/5xx 两条红，not_owned 为 /dev 不回归守卫）|

> `BEHAVIOR 覆盖` 每个覆盖名均为对应 `it()` 名的字面子串。
> 永久回归测试（进 CI，hard rule 20）由 generator 落在仓内：`.github/workflows/scripts/__tests__/should-auto-merge*.test.sh`（脚本五态 + 结构）、`packages/brain/src/routes/__tests__/harness-pr-ownership*.test.js`（端点 owned/not_owned/前缀/400）、`packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js`（新增 status 置闸断言）。sprint tests/ 仅作 TDD 红证。
