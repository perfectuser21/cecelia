# Sprint Contract Draft (Round 1)

Sprint: Harness PR 机器身份 + AI 验收前合并硬闸
journey_type: autonomous
target_environment: local_api

---

## 锚定父路声明

独立小路（无父路）—— journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 的 golden-paths 查询为空（PRD「累积 FR」段确认本 line 暂无历史行为），本 sprint 是恢复「合并唯一权威」的独立闭环，不依附既有父路。

---

## Unified Map（Step 1.0）

- scope: `cecelia` ／ repo: `perfectuser21/cecelia`
- changed_files radius: **未计算**（task.payload.expected_files 为空）→ `must_run_assertions: []`、`affected_business_nodes: []`。
- 说明：无 map radius 断言注入，本合同回归约束来自「已知约束（回归测试）」+ PRD Invariant 段，不回退领域硬编码。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动为：CI shell 判定脚本（`should-auto-merge.sh`）+ Brain 编排层纯函数/状态机（`derive.js`/`gates.js`/`contract-store.js`）+ DB 写路径（`harness_run_events`/`initiative_runs`/`tasks`），**不新增 HTTP 端点**，故无 response schema 需 codify。（Reviewer 第 6 维按「无 HTTP 响应」自动满分该项，验证 oracle 落在 shell 自测 + 真 PG 集成测试。）

---

## 已知约束

### 来自回归测试
- [`.github/workflows/scripts/__tests__/should-auto-merge.test.sh`] → `harness PR（feat(harness):）→ 跳过 auto-merge`；`普通 fix(brain) PR → 正常 auto-merge`；`fix(ci) PR → 正常 auto-merge`；`feat(dashboard) PR → 正常 auto-merge`；`非 cp-* 分支 → 跳过`；`auto-merge 可越过 needs 链中的 skipped jobs`（always()）；`--auto --squash --delete-branch` 排队；`contents: write + pull-requests: write` 最小权限。
  - **本 sprint 变更点**：判据从「标题 `feat(harness):` 前缀猜测」改为「不可伪造机器身份（`harness` label）」。原「feat(harness): → SKIP（仅凭标题）」断言必须迁移为「带 harness label → SKIP（任意 change_kind/title）」；同时新增「无 harness label 的 `fix(harness):` → MERGE」反例，证明不再靠标题猜。**不得删除**任何 /dev MERGE 正例（防误伤 /dev 通道，PRD 边界情况）。
- [`packages/brain/src/orchestrator/__tests__/contract-store.test.js`] → `materializeApprovedContract` 真 PostgreSQL：draft 原子换版、approved 同证据幂等、并发换版。
  - **本 sprint 变更点**：新增 `superseded`/未知状态 fail-closed 抛错回归，且 `approved` 异证据必须抛 mismatch（现有行为）不得回退。
- [`packages/brain/src/orchestrator/__tests__/kernel-*.pg.integration.test.js`] → kernel run 终局/终态一致性协调（run-store / stale-attempt / terminal-mismatch）。
  - **本 sprint 变更点**：新增「PR 外部已合 + Generator running + 无 Evaluator/Judge → premature_merge fail-closed」回归。

### 铁律清单 → Invariant 映射（来源: PRD Invariant 段）
- INV-1 [验收时钟 fail-closed]：本 sprint **不新建** validation clock；合并放行仍锚定同一 `head_sha`（`gates.mergeGate` 对 stale verdict 拒绝）→ 由 B-07 覆盖。
- INV-2 [抢竞态：不得越过 harness 验收 gate 抢合]：正是本 sprint 核心——通用 auto-merge 必须凭机器身份 SKIP harness PR（B-01/B-03），且外部已合不得绕过验收假记完成（B-04/B-05）。
- INV-3 [CONFLICTING 不空等]：N/A —— 本 sprint 不改 PR CONFLICTING/CI 空等处理路径（超范围，PRD「不在范围内」）。

### 累积 FR（context-manifest）
`context-manifest: unavailable`（`/api/brain/line/e6f803f2-.../context-manifest` 返回空）；PRD「累积 FR」段确认本 line 暂无历史行为，无累积约束需并入。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

（当前仓库 `cecelia` 根目录无 `product-map/generated/product-map.json`，按 skill v9.18 cross-repo file-existence gated 规则整体跳过，不阻塞。）

---

## 真实调用方请求 shape

**调用方**：`.github/workflows/ci.yml` 的 `auto-merge` job（通用 auto-merge 通道）。
**被调**：`.github/workflows/scripts/should-auto-merge.sh`（判定脚本）。

生产调用方（ci.yml auto-merge job）向脚本传参的**真实 shape**（本 sprint 落地后逐字段一致，禁止 DoD 用不同 shape）：

| 位置 | 参数 | 来源（GitHub 事件，server 权威，runner 只读） | 现状 → 目标 |
|---|---|---|---|
| `$1` | `HEAD_BRANCH` | `${{ github.head_ref }}`（走 env，防注入） | 不变 |
| `$2` | `PR_TITLE` | `${{ github.event.pull_request.title }}`（走 env） | 保留但**不再作为 harness 判据** |
| `$3` | `PR_LABELS` | `${{ join(github.event.pull_request.labels.*.name, ' ') }}`（空格拼接，走 env；已有先例见 ci.yml:1794/1869） | **新增**：脚本据此识别 `harness` 机器身份 |

**判据**：`PR_LABELS` 空格分隔 token 中含 `harness` → 输出 `SKIP:...`（交还 harness evaluator+judge gate）；否则 cp-* 分支 → 输出 `MERGE`。`harness` label 由 **Brain 侧签发**（PRD ASSUMPTION：runner 不可自伪造，marker Brain 签发/校验，runner 只读）——脚本只读 GitHub 事件回报的 label，不接触任何签发凭据。

> ⚠️ 机器身份**签发**（Brain 在建/发现 generator PR 时给 PR 打 `harness` label）是本 fix 不可省的前置，否则 should-auto-merge 读到永远为空的 label = 空判据。当前仓库 generator 建 PR（`harness-generator/SKILL.md:563` `gh pr create --title "feat(harness):"`）**未打 label**，`harness` label 目前仅 `archive-learnings.yml:120` 使用。本 sprint 必须补齐「Brain 签发 harness label 到 generator PR」这一跳（见 Golden Path Step 1 与「未覆盖真实链路清单」）。

---

## 禁 mock 边清单

本单改动涉及**状态机（derive 路由）/ 生命周期钩子（run 终局 finalize）/ DB 写路径 / 跨模块数据传递（derive→finalize→event-store）**，failing test 必须不 mock 被改的边：

- `derive()` ↔ kernel run finalize（`finalizeKernelRun`）↔ DB 表 `initiative_runs`/`tasks`/`harness_attempts`：premature_merge 集成测试必须真 Postgres 验 run.phase/ task.status/ failure_reason 落库，不 mock finalize、不 mock DB。
- 代码 ↔ DB 表 `harness_run_events`（accountable event）：必须真跑 `append_harness_run_event(...)`（真 `run-event-store.append`），不 mock event-store。
- `contract-store.materializeApprovedContract` ↔ DB 表 `initiative_contracts`：draft/approved/superseded/未知状态分流必须真 Postgres 验，不 mock DB（沿用现有 `contract-store.test.js` 真 PG 模式）。
- `should-auto-merge.sh`：纯 shell 判定脚本，**无接缝边**——RED-A 断言真实执行脚本本身（bash），非 mock。

**允许 mock 的更外层边界**（登记进「未覆盖真实链路清单」）：
- Brain ↔ GitHub Label/Merge API（第三方 GitHub REST，本地 evaluator 无法造真 live PR）——外层边界，单测可 mock `gh`/`execFn` 断言「以 `harness` label 调用」，真验补位见清单。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统对外承诺 | ① should-auto-merge 凭不可伪造机器身份对 harness PR（任意 change_kind/title）输出 SKIP、对无身份 /dev PR 输出 MERGE；② kernel 遇「PR 外部已合 + Generator running + 无 Evaluator/Judge」时 fail-closed 记 `premature_merge`、不标 completed、建可追责事件；③ 合并唯一放行=同 head_sha 上 Evaluate PASS/FIXED + Judge PASS + merge handler 三者齐备；④ contract-store：draft 原子换版 / approved 同证据幂等 / superseded/未知 fail-closed。 |
| **NFR** | 性能/可靠/安全 | 安全：不把通用 internal token 交给不受信 runner，机器身份 marker 由 Brain 签发/校验（runner 只读 GitHub 事件 label）；验收真实性：AI Evaluator 独立阅读 PR/合同复现风险，不得仅复述 CI；合并锚定：放行必须锚定同一 head_sha，跨 sha verdict 一律拒（stale）。 |
| **Invariant** | 永不违反 | 无「同 head_sha 的 Evaluate PASS/FIXED + Judge PASS」不得合并、更不得把无 AI 验收的外部合并假记 completed；已批准（approved）合同证据不符 / superseded 合同不得被静默覆盖。 |
| **判定点** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期** | 何时失效 | verdict 绑定 `pr_head_sha`；PR 出现新 commit（head_sha 变化）→ 旧 verdict 立即 stale 失效，须在新 head_sha 上重验。`harness` label 随 PR 生命周期存在，PR 关闭即失效。 |
| **死亡告警** | 停了谁知道 | premature_merge → run 进 `failed`（可被巡检/监控发现，非静默 done）；并写 `harness_run_events`（可追责事件，account 可追溯）。should-auto-merge 判据回归被 CI `lint-auto-merge-decision` job 守护，退化即红。 |
| **失败语义** | 挂了怎么办 | 见下方失败语义声明 |
| **效果确认** | 已发≠已生效 | premature_merge：psql 查 `run.phase != 'done'`、`run.failure_reason='premature_merge'`、`task.status != 'completed'`，且 `harness_run_events` 有对应事件行；should-auto-merge：脚本 exit 0 + stdout 首词 `SKIP`/`MERGE` 断言。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 「该 PR 是否为 Harness-owned」 | A. 标题 `feat(harness):` 前缀字符串猜; B. 不可伪造 `harness` label（Brain 签发） | B. `harness` label | A 只覆盖 `feat(harness):`，`fix(harness):` 等其它 change_kind 全漏网（事故 PR #4870 根因） | 漏判 → harness PR 被通用 auto-merge 抢合、架空 AI 验收裁决权（不可逆合并 / 直接面客错误） |
| ⚠️ 「外部已合并是否属过早合并」 | A. 只看 `pr.merged=true` 即判 run done; B. `pr.merged` **且** Generator inflight **且** 缺 Evaluate/Judge verdict → premature_merge | B. 复合信号 | A 无法区分「验收通过后正常合并」与「验收前被抢合」，事故正是 A（derive.js:686 单信号短路） | 假记完成、静默丢失验收结论（静默丢数据 / 不可逆假成功收尾） |

> 两条 ⚠️ 判定点均属「升拍板点」级别（误判后果不可逆/面客）。PRD 的 Golden Path 第 3 条已由主理人显式拍定「合并唯一放行三闸」，两判定点方案 B 与之一致，**无需再升拍**；notes 不额外登记 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| should-auto-merge：无 harness label 的 /dev PR | 输出 `MERGE`（正常放行 /dev，误拦会卡死所有 /dev） | 是（纯判定，无副作用） | 无（判据确定性） |
| Brain 未成功给 harness PR 打 label | should-auto-merge 读到空 label → 会 MERGE（潜在绕过）——故 label 签发须在 Brain 侧 PR 记录路径保证，失败须显式记 | 由 Brain PR 记录路径幂等保证 | 见「未覆盖真实链路清单」真验补位 |
| kernel 遇 premature_merge | fail-closed：run 不标 done、task 不标 completed、`failure_reason='premature_merge'`、建可追责事件 | 是（`append_harness_run_event` 对 `(run_id, source_type, source_id, source_version)` UNIQUE，重复 reconcile 不重复建事件） | 无（安全红线，宁失败不假成功） |
| contract-store 附着合同为 superseded/未知态 | 抛错 fail-closed，禁止静默覆盖 | 是（同证据 approved 幂等返回；draft 原子换版；superseded/未知恒抛） | 无 |

### 输入对抗面

N/A —— 本 sprint 无对外暴露 agent。`should-auto-merge.sh` 输入来自 GitHub 事件（PR title/branch/labels），其中 title/branch 为用户可控输入，**现状已走 env 而非内联 `${{ }}`**（ci.yml 注释明确防 shell 注入），本 sprint 不新增内联注入面；`harness` label 由 Brain 签发、脚本只读，无越权指令面。

---

## Golden Path

系统从 [Harness Generator 产出 PR] → 经过 [Brain 签发不可伪造机器身份 + 通用 auto-merge 凭身份 SKIP] → [外部已合但无 AI 验收 → fail-closed 记 premature_merge] → 到达 [合并唯一权威只在同 head_sha AI 验收通过后放行]。

---

### Step 1: Brain 给 Harness generator PR 签发不可伪造机器身份（`harness` label）
**来源**: `[AI_ADDED]` — PRD ASSUMPTION「harness label 由 Brain 在建 PR 时下发，runner 不可自伪造」的落地前置。理由：当前 generator 建 PR 只带 `feat(harness):` 标题、不带 label，若不补此跳，Step 2 读到的 label 恒空、整条硬闸落空（防「有枪没上膛」）。

**可观测行为**: Brain 在记录/发现 generator PR 的路径上，用 Brain 自己的凭据给该 PR 打 `harness` label；不受信 runner 侧不下发签发凭据。

**验证命令**（单测 — mock 外层 GitHub `gh`/execFn，断言以 `harness` label 调用；接缝真验见「未覆盖真实链路清单」）:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/harness-pr-identity.test.js --reporter=verbose
# 期望：exit 0；断言 Brain PR 记录路径以 label 名 "harness" 调用 GitHub label API，且不向 runner 暴露 internal token
```
**硬阈值**: 单测 exit 0；断言参数含字面 `harness`。

---

### Step 2: 通用 auto-merge 凭机器身份判定（RED-A）
**来源**: `[FROM_PRD]` — Golden Path 第 1 条（RED-A）。

**可观测行为**: `should-auto-merge.sh <branch> <title> <labels>`：labels 含 `harness` → 输出 `SKIP:...`（不论 change_kind/title）；cp-* 分支且 labels 无 `harness` → 输出 `MERGE`。`ci.yml` auto-merge job 把 `github.event.pull_request.labels.*.name` 空格拼接传入 `$3`。

**验证命令**:
```bash
# RED-A 正例：fix(harness) + harness label → SKIP
OUT=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-6a99f97c" "fix(harness): kernel 合并硬闸" "harness")
printf '%s' "$OUT" | grep -qE '^SKIP' || { echo "FAIL: harness 机器身份未被 SKIP: $OUT"; exit 1; }
# RED-A 反例（防误伤 /dev）：普通 fix(brain) 无 label → MERGE
OUT2=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-abc" "fix(brain): 修复调度" "")
printf '%s' "$OUT2" | grep -qx 'MERGE' || { echo "FAIL: 普通 /dev PR 未被 MERGE: $OUT2"; exit 1; }
# 反猜测：fix(harness) 但无 label → MERGE（证明不再靠标题猜）
OUT3=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-def" "fix(harness): 无身份" "")
printf '%s' "$OUT3" | grep -qx 'MERGE' || { echo "FAIL: 无身份 fix(harness) 仍被标题猜成 SKIP: $OUT3"; exit 1; }
echo "OK"
```
**硬阈值**: 三分支输出分别为 SKIP / MERGE / MERGE。

---

### Step 3: RED-A 回归自测（守护判据不回退）
**来源**: `[FROM_PRD]` — PRD 预期受影响文件 `should-auto-merge.test.sh`（RED-A 回归）；CI `lint-auto-merge-decision` job 已跑此自测。

**可观测行为**: 更新后的 `should-auto-merge.test.sh` 全绿：harness label → SKIP（任意 title）、无 label /dev → MERGE、非 cp-* → SKIP、always()/--auto/最小权限 结构断言全过。

**验证命令**:
```bash
bash .github/workflows/scripts/__tests__/should-auto-merge.test.sh || { echo "FAIL: auto-merge 判据自测未全绿"; exit 1; }
echo "OK"
```
**硬阈值**: 自测 exit 0（`Results: FAIL=0`）。

---

### Step 4: kernel 外部已合且无 AI 验收 → fail-closed（RED-B）
**来源**: `[FROM_PRD]` — Golden Path 第 2 条（RED-B）。

**可观测行为**: `derive(observed)` 对「`pr.merged=true` + inflight generator running + `evaluateVerdict=null` 或 `judgeVerdict=null`」返回 `{phase:'failed', action:'mark_failed', reason:'premature_merge'}`（而非现状 `pr_merged`/done）；kernel finalize 据此：`initiative_runs.phase != 'done'`、`initiative_runs.failure_reason='premature_merge'`、`tasks.status != 'completed'`，并向 `harness_run_events` append 一条可追责事件。

**验证命令**（纯函数单测 + 真 PG 集成测试）:
```bash
cd packages/brain
# 纯函数：derive 路由
npx vitest run src/orchestrator/__tests__/derive-premature-merge.test.js --reporter=verbose || { echo "FAIL: derive 未路由 premature_merge"; exit 1; }
# 真 PG：run/task 未 completed + failure_reason + accountable event
DATABASE_URL="$DB_URL" DB="$DB_URL" NODE_ENV=test npx vitest run --config vitest.integration.config.js src/orchestrator/__tests__/kernel-premature-merge.pg.integration.test.js --reporter=verbose || { echo "FAIL: premature_merge 真 PG 回归未过"; exit 1; }
echo "OK"
```
**硬阈值**: 两测均 exit 0；集成测试内断言 `phase<>'done'` 且 `failure_reason='premature_merge'` 且 `task.status<>'completed'` 且 `harness_run_events` 命中事件。

---

### Step 5: 合并唯一放行三闸（同 head_sha Evaluate PASS/FIXED + Judge PASS + merge handler）
**来源**: `[FROM_PRD]` — Golden Path 第 3 条（铁律）。

**可观测行为**: `gates.mergeGate({evaluateVerdict, judgeVerdict, prHeadSha, reviewRequired, reviewApproved})`：缺 evaluate/judge、verdict 非 PASS/FIXED、或 verdict 的 `pr_head_sha` 与当前 head 不匹配（stale）→ `{allow:false, reason:...}`；三闸齐备且锚定同 head_sha → `{allow:true}`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/gates.test.js --reporter=verbose || { echo "FAIL: mergeGate 唯一权威回归未过"; exit 1; }
echo "OK"
```
**硬阈值**: exit 0；覆盖 evaluate_verdict_missing / stale_evaluate_verdict / judge_verdict_missing / stale_judge_verdict / all_gates_passed 各至少一断言。

---

### Step 6: contract-store 状态分流 + 真实 PostgreSQL 回归
**来源**: `[FROM_PRD]` — Golden Path 第 4 条（顺带修正）。

**可观测行为**: `materializeApprovedContract`：附着 `draft` → 单事务原子换版（插 v2 approved + 置 v1 superseded + run.contract_id 切 v2）；附着 `approved` 且同证据 → 幂等返回；附着 `approved` 异证据 → 抛 mismatch；附着 `superseded`/未知态 → 抛错 fail-closed（禁静默覆盖已批准/已废弃合同）。

**验证命令**:
```bash
cd packages/brain && DATABASE_URL="$DB_URL" DB="$DB_URL" NODE_ENV=test npx vitest run --config vitest.integration.config.js src/orchestrator/__tests__/contract-store.test.js --reporter=verbose || { echo "FAIL: contract-store 状态分流真 PG 回归未过"; exit 1; }
echo "OK"
```
**硬阈值**: exit 0；含 draft 换版 / approved 同证据幂等 / superseded fail-closed / 未知态 fail-closed 各断言。

---

## 未覆盖真实链路清单

| 真实链路点 | 为何被替身/未 E2E | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| Brain → GitHub「给 generator PR 打 `harness` label」（Step 1 签发） | 本地 evaluator（local_api）无法造出 GitHub live PR + 真 label 事件；单测 mock 外层 `gh`/execFn 断言「以 harness label 调用」 | 下一次真实 harness run：观察 generator PR 是否被 Brain 打上 `harness` label、且通用 auto-merge 对其输出 SKIP（标 `logic-done-pending`，真验前不得标 done） |
| GitHub external-merge 真实 webhook/discovery → kernel premature_merge | 集成测试用真 PG 复现 `observed`（`pr.merged=true` + generator running + 无 verdict），但 GitHub → `discoverPrFromGithub` 那一跳用构造 observed 顶替（外层第三方边界） | 生产巡检：复盘事故类 run，确认 premature_merge 事件与 run failed 落库（接缝，真机=生产 Brain） |

> 本清单会由 harness-controller 原样呈现进 PR 描述，不静默。除以上两处 GitHub 接缝外，本合同核心判据（should-auto-merge / derive / gates / contract-store）均在真目标（真 shell / 真 PG）验证。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

> evaluator 模式 B（final-e2e）按 target_environment=local_api 本地执行以下单个 bash 块。需要真 Postgres 的段依赖 Fleet 注入的 attempt 级 `DB_URL`（全新空库）；脚本先跑仓库真实 migration bootstrap，再跑真 PG 集成测试。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── 段 A：RED-A（无需 DB）——机器身份判据 + 回归自测 ───────────────────────────
bash .github/workflows/scripts/__tests__/should-auto-merge.test.sh
OUT=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-6a99f97c" "fix(harness): kernel 合并硬闸" "harness")
printf '%s\n' "$OUT" | grep -qE '^SKIP' || { echo "FAIL: harness 机器身份未被 SKIP: $OUT"; exit 1; }
OUT2=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-abc" "fix(brain): 修复调度" "")
printf '%s\n' "$OUT2" | grep -qx 'MERGE' || { echo "FAIL: 普通 /dev PR 未被 MERGE: $OUT2"; exit 1; }
OUT3=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-def" "fix(harness): 无身份" "")
printf '%s\n' "$OUT3" | grep -qx 'MERGE' || { echo "FAIL: 无身份 fix(harness) 仍被标题猜成 SKIP: $OUT3"; exit 1; }
echo "✅ 段 A（RED-A 机器身份判据）通过"

# ── 段 B：把 DB_URL 拆成 migrate.js / 测试所需的离散变量（空库 bootstrap）─────────
PROTO_REMOVED="${DB_URL#*://}"
CREDS="${PROTO_REMOVED%%@*}"
HOSTPORTDB="${PROTO_REMOVED#*@}"
export DB_USER="${CREDS%%:*}"
export DB_PASSWORD="${CREDS#*:}"
HOSTPORT="${HOSTPORTDB%%/*}"
export DB_HOST="${HOSTPORT%%:*}"
export DB_PORT="${HOSTPORT##*:}"
DBNAME_Q="${HOSTPORTDB#*/}"
export DB_NAME="${DBNAME_Q%%\?*}"
export DATABASE_URL="$DB_URL"
export DB="$DB_URL"
export NODE_ENV=test
cd "$REPO_ROOT/packages/brain"
node src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('public.harness_run_events') IS NOT NULL" | grep -qx t || { echo "FAIL: harness_run_events 表缺失（migration 未生效）"; exit 1; }
psql "$DB_URL" -tAc "SELECT to_regclass('public.initiative_contracts') IS NOT NULL" | grep -qx t || { echo "FAIL: initiative_contracts 表缺失"; exit 1; }
echo "✅ 段 B（空库 migration bootstrap）通过"

# ── 段 C：纯函数 + 机器身份签发（mock 外层 gh）+ 真 PG 集成回归 ─────────────────
npx vitest run src/orchestrator/__tests__/harness-pr-identity.test.js --reporter=verbose
npx vitest run src/orchestrator/__tests__/derive-premature-merge.test.js --reporter=verbose
npx vitest run src/orchestrator/__tests__/gates.test.js --reporter=verbose
npx vitest run --config vitest.integration.config.js \
  src/orchestrator/__tests__/kernel-premature-merge.pg.integration.test.js \
  src/orchestrator/__tests__/contract-store.test.js \
  --reporter=verbose
echo "✅ 段 C（premature_merge fail-closed + mergeGate 三闸 + contract-store 状态分流 真 PG）通过"

echo "✅ Golden Path 全程验证通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `should-auto-merge.sh` 传畸形 labels（如 `"pre-harness harnessy"` / `"HARNESS"` 大小写 / 含 `harness` 子串的其它 label 名如 `harness-canary`）——验证只精确匹配独立 token `harness`，不被子串/大小写误判为 SKIP，也不漏判。
- 重复提交: 对同一 premature_merge run 重复触发 reconcile ——`harness_run_events` 不重复建事件（UNIQUE 幂等），run 不因二次 reconcile 翻回 done/completed。
- 中途中断: contract-store 换版事务中途（模拟并发/异常）——draft→v2 换版要么整体成功要么整体回滚，不留 v1 approved 与 v2 approved 并存的双批准态。
- 边界值: mergeGate 传 evaluate PASS 但 judge 的 `pr_head_sha` 比 evaluate 落后一个 commit（跨 sha）——必须 stale 拒绝，不得因「两者都 PASS」放行。
发现分级: P0/P1（无 AI 验收却放行合并 / 假记完成 / 静默覆盖已批准合同）→ 阻塞 merge；P2/P3（判据措辞、日志噪音）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| RED-A 机器身份判据 | `${SPRINT_DIR}/tests/should-auto-merge-identity.test.ts` | `fix(harness) + harness label → SKIP` | → 1 failure（现状返 MERGE） |
| RED-B premature_merge 路由 | `${SPRINT_DIR}/tests/derive-premature-merge.test.ts` | `pr.merged + generator running + 无 verdict → premature_merge` | → 1 failure（现状返 pr_merged/done） |

> 注：`${SPRINT_DIR}/tests/` 两个文件是 TDD Red 证据（proposer 产出，运行即红）。落地时的**永久回归测试**位于真实代码树：`.github/workflows/scripts/__tests__/should-auto-merge.test.sh`、`packages/brain/src/orchestrator/__tests__/{derive-premature-merge,gates,kernel-premature-merge.pg.integration,contract-store,harness-pr-identity}.test.js`；`kernel-premature-merge.pg.integration.test.js` 与 `contract-store.test.js` 须登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 及 ci.yml `brain-integration` job 调用清单（contract-store 已在列）。
