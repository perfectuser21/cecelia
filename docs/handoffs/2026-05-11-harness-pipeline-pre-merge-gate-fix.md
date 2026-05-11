# PRD — Harness Pipeline 架构改造：evaluator pre-merge gate + infra 修复

**日期**：2026-05-11
**作者**：Alex（决策） + Claude（背景调查）
**状态**：等开工
**估时**：1 天

---

## 背景 / 问题

近 5 天连续派 W19-W27 harness pipeline 任务，每次都 task=failed。系统性排查（按 cecelia-harness-debug 7 层）后发现：

1. **架构层（主问题）**：evaluator 跑在 **PR merge 之后**（`harness-initiative.graph.js` evaluate 节点在子图返回后），违反 Anthropic harness "separating doing / judging" 原则。FAIL 时 main 已污染，fix loop 在污染的 main 上跑。
2. **决策层**：2026-04-09 决策"砍 evaluator，CI 是机械执行器"实证错误。CI（vitest mock）验代码层，evaluator（manual:bash）验行为层，两者验不同事不可替代。multiple memory 实证（W19/W20/W26 等）CI 全绿但行为崩。
3. **Infra 层（pipeline 跑不动）**：
   - `account_usage_cache` schema 缺 `seven_day_omelette` (Opus quota) 字段 → brain 选 quota 100% 的 account → 401
   - harness_planner docker `mem=512m` 太小 → opus prompt > 1M token cache → OOM 137
   - `cecelia-run` circuit breaker 305 failures 卡 HALF_OPEN → dispatcher 22 min 不 dispatch

注：5 个 SKILL 的内容修复已在 host 完成并通过 headless 链路 3 次验证（W27-shadow / v2 / v3 全 PASS），**但改动还没正经合 main**，本 PR 一并入。

---

## 成功标准

### SC-1: brain 编排 — evaluator 当 pre-merge gate

- **[BEHAVIOR]** `packages/brain/src/workflows/harness-task.graph.js` 含新节点 `evaluateContractNode`，调 evaluator container 跑 contract-dod-ws*.md 的 manual:bash 命令
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8'); if(!/evaluateContractNode/.test(c) || !/poll_ci.*evaluate_contract|evaluate_contract.*merge_pr/.test(c)) process.exit(1)"`
  期望: exit 0

- **[BEHAVIOR]** task graph conditionalEdges 顺序：`poll_ci → evaluate_contract`，`evaluate_contract → merge_pr (PASS) / fix_dispatch (FAIL)`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8'); const m=c.match(/addConditionalEdges\('evaluate_contract'[\s\S]{0,200}/); if(!m || !/merge_pr|fix_dispatch/.test(m[0])) process.exit(1)"`
  期望: exit 0

- **[BEHAVIOR]** initiative graph 的 `evaluate` 节点改名 `final_evaluate_e2e` 或加注释明确"我是 Golden Path 终验，不是 ws 单级 evaluate"，避免跟 task graph 子图内 evaluate 混淆
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!/final_evaluate|Golden Path 终验|final E2E/.test(c)) process.exit(1)"`
  期望: exit 0

### SC-2: brain infra — Opus quota 字段

- **[BEHAVIOR]** `account_usage_cache` 表加 `seven_day_omelette_pct` + `seven_day_omelette_resets_at` 字段（migration `package/brain/migrations/`）
  Test: `manual:psql "host=localhost user=cecelia dbname=cecelia" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='account_usage_cache' AND column_name IN ('seven_day_omelette_pct','seven_day_omelette_resets_at')" | grep -q "2"`
  期望: exit 0

- **[BEHAVIOR]** `account-usage.js` 的 `selectBestAccount` 函数读 omelette 字段，跳过 omelette ≥ 95% 的 account 当模型 = Opus
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8'); if(!/omelette.*95|seven_day_omelette.*skip|spendingCapped.*opus/i.test(c)) process.exit(1)"`
  期望: exit 0

### SC-3: brain infra — docker mem 限制

- **[BEHAVIOR]** harness_planner / harness_contract_propose / harness_contract_review docker 容器 `mem=2048m`（opus prompt > 1M token cache 需要）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!/harness_planner.*2048|tier.*opus.*2048|memOpus.*2048/.test(c)) process.exit(1)"`
  期望: exit 0

### SC-4: brain infra — circuit breaker 自愈

- **[BEHAVIOR]** `cecelia-run` circuit breaker HALF_OPEN 状态：1 个 probe task 成功 → 立即 CLOSED（不要因为历史 305 failures 残留卡住）
  Test: `manual:bash -c 'curl -sX POST localhost:5221/api/brain/circuit-breaker/cecelia-run/reset; sleep 1; STATE=$(curl -s localhost:5221/api/brain/circuit-breaker | jq -r ".breakers[\"cecelia-run\"].state"); [ "$STATE" = "CLOSED" ]'`
  期望: exit 0

### SC-5: 5 SKILL host 改动正经入 main

- **[ARTIFACT]** `packages/workflows/skills/harness-contract-proposer/SKILL.md` version >= 7.6.0
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8'); if(!/^version: 7\.[6-9]/m.test(c)) process.exit(1)"`

- **[ARTIFACT]** `packages/workflows/skills/harness-contract-reviewer/SKILL.md` version >= 6.4.0 + 不含 "Round 5 force APPROVED" 死轮 cap 字样
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8'); if(!/^version: 6\.[4-9]/m.test(c) || /Round 5：\*\*外部硬 cap/.test(c)) process.exit(1)"`

- **[ARTIFACT]** `packages/workflows/skills/harness-generator/SKILL.md` version >= 6.3.0 + 含 `tasks[].files` schema 段
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8'); if(!/^version: 6\.[3-9]/m.test(c) || !/tasks\[\]\.files/.test(c)) process.exit(1)"`

- **[ARTIFACT]** `packages/workflows/skills/harness-evaluator/SKILL.md` version >= 1.3.0 + 含 "pre-merge gate" 字样
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8'); if(!/^version: 1\.[3-9]/m.test(c) || !/pre-merge gate/.test(c)) process.exit(1)"`

### SC-6: 端到端真验

- **[BEHAVIOR]** 派 W28 真 harness pipeline 任务（playground GET /divide 或类似新 endpoint）— task=completed
  Test: `manual:bash -c 'TID=$(curl -sX POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"title\":\"[W28] post-fix verify\",\"task_type\":\"harness_initiative\",\"payload\":{\"source\":\"manual_w28\",\"thin_prd\":\"GET /divide?a=N&b=M 返 {result:a/b,operation:\\\"divide\\\"} schema keys=[\\\"operation\\\",\\\"result\\\"]; b=0 → 400 + {error}\",\"sprint_dir\":\"sprints/w28-playground-divide\",\"timeout_sec\":3600,\"e2e_validation\":true,\"walking_skeleton\":{\"thin_features\":[\"F1\"]}}}" | jq -r .id); for i in $(seq 1 120); do S=$(curl -s localhost:5221/api/brain/tasks/$TID | jq -r .status); [ "$S" = "completed" ] && break; [ "$S" = "failed" ] && exit 1; sleep 30; done; [ "$S" = "completed" ]'`
  期望: exit 0

---

## 范围

### 在范围内

| 文件 | 改动 |
|---|---|
| `packages/brain/src/workflows/harness-task.graph.js` | **加 evaluateContractNode**（80-120 行）+ import evaluator container spawn 逻辑 + 改 conditionalEdges（poll_ci → evaluate_contract → merge_pr / fix_dispatch） |
| `packages/brain/src/workflows/harness-initiative.graph.js` | 现有 `evaluate` 节点改名 `final_evaluate_e2e`（语义清理，标 Golden Path 终验）；删除被 task graph 内化的 evaluate 重复逻辑 |
| `packages/brain/migrations/2XX_account_usage_omelette.sql` | 加 `seven_day_omelette_pct` + `seven_day_omelette_resets_at` 字段 |
| `packages/brain/src/account-usage.js` | `refreshAccountUsage` 读 Anthropic API `seven_day_omelette`；`selectBestAccount` 当 Opus 模型时跳过 omelette ≥ 95% account |
| `packages/brain/src/docker-executor.js` | harness_planner/propose/review tier opus → `mem=2048m`（当前 512m） |
| `packages/brain/src/circuit-breaker.js` | HALF_OPEN 状态下 1 个 probe success → 立即 CLOSED + clear failures 计数 |
| `packages/workflows/skills/harness-contract-proposer/SKILL.md` | host 已改 v7.6 — 入 main |
| `packages/workflows/skills/harness-contract-reviewer/SKILL.md` | host 已改 v6.4 — 入 main |
| `packages/workflows/skills/harness-generator/SKILL.md` | host 已改 v6.3 — 入 main |
| `packages/workflows/skills/harness-evaluator/SKILL.md` | host 已改 v1.3 — 入 main |
| `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` | 加 evaluateContractNode 单测 + 路由测试（PASS → merge_pr / FAIL → fix_dispatch） |
| `packages/brain/src/__tests__/account-usage-omelette.test.js` | 新文件 — 单测 selectBestAccount 跳过 omelette ≥ 95% account |
| `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh` | 新 smoke — 派 dry-run W28 验证 evaluator 真 pre-merge gate |
| `docs/learnings/cp-MMDDHHNN-harness-pre-merge-gate-fix.md` | Learning 文件 |

### 不在范围内

- `harness-planner` SKILL（v8.2 已对齐，不动）
- `pickSubTaskNode` 真等 depends_on（多 ws DAG 延后处理，当前 walking skeleton 单 ws 不影响）
- GitHub branch protection 加 evaluator status check（brain 自己控 merge 时机，不需要 GitHub status check 双重）
- 改 cecelia-run / cecelia-bridge 本身逻辑（只改 circuit breaker 自愈）
- Codex / xian 相关任务路由

---

## 不做

- ❌ 不重写整个 harness graph（最小侵入 — 加 1 个节点 + 改 4-5 行 edges）
- ❌ 不动 GAN 收敛趋势检测（已用 detectConvergenceTrend，无上限 + 趋势兜底，跟用户原话对齐）
- ❌ 不删 task-plan.json 协议（generator v6.3 已对齐 tasks[].files）
- ❌ 不重启所有 brain ack / dispatcher 逻辑

---

## 测试策略

按 cecelia 测试金字塔分档：

| 改动 | 测试档 | 实现 |
|---|---|---|
| `evaluateContractNode` pure function | unit (vitest) | mock evaluator container 输出，断言路由决策 |
| task graph conditionalEdges 拓扑 | unit (vitest) | 测 poll_ci → evaluate_contract → merge_pr/fix_dispatch 三条路径 |
| `account-usage.js` selectBestAccount Opus 跳过 | unit (vitest) | mock account_usage_cache 表数据，断言选择结果 |
| migration 升 omelette 字段 | integration (psql) | 真跑 migration 看 schema 变化 |
| circuit breaker 自愈 | unit (vitest) | mock 1 个 probe success，断言 state 转 CLOSED |
| docker mem 限制 | integration | 启动 cecelia-task-* 容器看 mem limit |
| **端到端**（W28 真 pipeline） | E2E (smoke.sh) | 派真 task，看 task=completed |

**TDD 纪律**：
- commit 1 = 测试文件 + 失败的 unit test（red）
- commit 2 = 实现让 unit test 绿
- smoke.sh 跟 unit 一起在 commit 2 完成

---

## 受影响文件汇总

**新增（4 文件）**：
- `packages/brain/migrations/2XX_account_usage_omelette.sql`
- `packages/brain/src/__tests__/account-usage-omelette.test.js`
- `packages/brain/scripts/smoke/harness-pre-merge-gate-smoke.sh`
- `docs/learnings/cp-MMDDHHNN-harness-pre-merge-gate-fix.md`

**修改（8 文件）**：
- `packages/brain/src/workflows/harness-task.graph.js`
- `packages/brain/src/workflows/harness-initiative.graph.js`
- `packages/brain/src/account-usage.js`
- `packages/brain/src/docker-executor.js`
- `packages/brain/src/circuit-breaker.js`
- `packages/workflows/skills/harness-contract-proposer/SKILL.md` ← host 已改
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md` ← host 已改
- `packages/workflows/skills/harness-generator/SKILL.md` ← host 已改
- `packages/workflows/skills/harness-evaluator/SKILL.md` ← host 已改
- `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`

---

## 风险 + 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| evaluator 容器需要 PR 分支 worktree + node 依赖 | 容器跑不起 | evaluator container 现已用 cecelia/runner:latest（含 node），mount PR worktree 即可。复用 generator container 的 worktree 路径 |
| `executeMerge` 调用 `gh pr merge` 被 GitHub branch protection 拦 | merge fail | brain bot token 配 admin / bypass，已有 |
| migration 在 live DB 跑 | 表 lock | 加字段是 ADD COLUMN nullable，不 lock |
| docker mem 提到 2048m × 多容器 | 机器内存压力 | us-mac-m4 8GB RAM，限 2 个 opus concurrent 容器即 4GB + brain 自身，安全 |
| circuit breaker 改太宽松 | 真 outage 时不触发 | HALF_OPEN → CLOSED 需要至少 1 个 success，仍是机械门禁 |
| task graph 子图改坏 | 阻塞所有 harness task | unit test 覆盖 + smoke.sh 真验 + 走 PR review |

---

## 历史教训锚点

下列 memory 是本 PRD 决策依据：

- `harness-pipeline-evaluator-as-pre-merge-gate.md`（2026-05-11，本次新写）— 撤销 04-09 决策
- `harness-gan-design.md` — GAN 无上限，趋势收敛（reviewer v6.4 已对齐）
- `feedback_brain_pull_before_reload.md` — Brain reload 前 host pull main
- `feedback_brain_deploy_syntax_smoke.md` — Brain deploy 前真启 server 冒烟
- `feedback_complete_product_delivery.md` — 5 项闭环（代码+CI+merge+部署+真验）
- `w19-walking-skeleton-pipeline-validated.md` — harness pipeline 工厂证书
- `dynamic-capacity-model.md` — capacity 模型

---

## 验收锚点

PR 合并 + brain reload 后派 W28 真 pipeline：

- task 进度走过 prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert → pick_sub_task → run_sub_task (sub-graph: spawn → await_callback → ... → poll_ci → **evaluate_contract** → merge_pr) → advance → ... → final_evaluate_e2e → report
- 期望 task=completed
- 期望 evaluator container 在 PR merge **之前**被 spawn（看 docker logs 时间戳）
- 期望 evaluator FAIL 路径走 fix_dispatch（手动制造一个 PR 漂字段名的反向场景，看是否 main 不被污染）

## journey_type: dev_pipeline
