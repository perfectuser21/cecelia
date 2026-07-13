---
id: harness-controller-skill
description: |
  Harness Controller — PR-level 单 session 编排者（SDD 模式）。2026-07-05 cecelia #3554 起为**唯一编排路径**：
  Brain 硬校验 payload.orchestrator==='skill-relay'，LangGraph 图已废弃（代码保留观察期但不再被 invoke）。
  一个 claude session 从头跑完一条 sprint：planner → GAN(proposer×reviewer) → generator(TDD) → evaluator → judge → merge → report。
  移植 Superpowers 6.0 subagent-driven-development 零件：进度台账 / 文件接力 / 四态出口协议 / 单评审双裁决 / compaction 恢复。
  点火方：Brain harness dispatch（无头）或人工前台（同一份 skill 两种触发，行为一致）。
  /dev 仍是唯一需求入口：本 skill 消费 /dev 路径C 的交接契约（PrepPRD + 铁律清单 + NFR），不做需求对抗。
version: 1.9.0
created: 2026-07-04
changelog:
  - 1.9.0: Step 4 新增 evaluate_verdict 上报硬性动作——evaluator 出裁决后立刻 PATCH relay-runs 带 evaluate_verdict（PASS/FAIL/FIXED 原样发，cecelia#3754 起写侧接住落 initiative_runs.evaluate_verdict；此前该列全 NULL=裁决只活在台账文本里，机器不可读）；fix loop 每轮重评后同样上报（COALESCE 覆盖语义，最后一次为准）
  - 1.8.1: fix——phase-event 自报两条 curl 加 -m 10 超时与 || true best-effort，PATCH 前加 EVT_ID 空值守卫（POST 失败则跳过 PATCH，防打到无 :id 的 URL），与文档既有 relay-runs best-effort curl 风格一致
  - 1.8.0: T7 phase-event复活——每阶段派 subagent 前后 POST/PATCH /api/brain/harness/phase-event 自报，让 initiative_run_events 重新有写入方（07-04 LangGraph→relay 切换后断供），同时给 cecelia 侧 zombie-reaper 心跳判活提供第二信号（防长阶段被 updated_at 单信号误杀）；HARNESS_INITIATIVE_ID 缺失（前台手跑）时整段跳过不阻塞
  - 1.7.0: Step 6 merge 后追加 staging_e2e 派生（POST /api/brain/harness/staging-e2e，best-effort 不阻塞）——覆盖本 session 自己 merge 与外部已合并两条路径，这是 staging→production 放行层当前唯一的任务产生入口（此前该层因旧 LangGraph 图（已废弃，不再被 invoke）停用而悬空 10 天，cecelia decision 76ab76ea 拍板恢复）
  - 1.6.0: 跨 repo 化刀3——①Step 5 judge 主路径切 Brain API（curl POST /api/brain/harness/judge，worktree 传宿主绝对路径 $HARNESS_WORKTREE_HOST，brain@1.242.0 spawn 注入；FIXED 由 API 归一 PASS；CLI 降为 cecelia 本机兜底不删）②CI 门禁三件套②按 base_repo 映射 smoke 约定（cecelia/zenithjoy/第三方各走各的，第三方无约定跳过）
  - 1.5.0: CI 配套硬规矩扩两条——第 3 条补 zenithjoy smoke 棘轮基线联动（PR #1156 起 baseline-lint 机械强制新 smoke 进 smoke-baseline.txt）；新增第 5 条 E2E 验收脚本必须有 CI 回归宿主（merge 前确认 e2e-verify 脚本入库且被 e2e-*.yml paths 或 nightly glob 收集，堵"E2E 只活一次"的持续回归洞，与合同测试第 1 条对称）
  - 1.4.0: Step 0 新增 0.3 前台点火防护（07-06 infrastructure 任务 8e281976 实证分裂：payload 缺 orchestrator 字段被 Brain 41 秒标 terminal failed，前台 session 浑然不觉继续裸跑）——人工前台接管必做两步：a.确认任务未被标 failed（missing_orchestrator_flag 秒杀）b.PATCH status=in_progress 认领防 tick 双 spawn；并写明前台无 initiative_run 行时 relay-runs 上报 404 是预期行为
  - 1.3.2: Step 3 generator 验收 PR 存在后立即早上报 pr_url（PATCH relay-runs phase=generate + pr_url，非阻塞；端点未上线时 400 忽略）；CI 配套硬规矩 + Step 3 prompt 测试文件措辞改为"由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制"（消除虚假 CI 强校验宣称，对齐 zenithjoy 当前 lint 实际能力）
  - 1.3.1: description 更新 — 由"替代 LangGraph 图的编排位置"改为"唯一编排路径"（cecelia #3554 硬校验 orchestrator=skill-relay，图废弃进入观察期）
  - 1.3.0: EVA 提分五处 additive（GAP #1②/#3/#5/#6/#7①）——①Step 2 合同格式硬检查(BEHAVIOR≥4/E2E段/manual:bash 确定性bash) ②Step 6 merge 前 head==锚定sha 硬检查 + Step 7 PATCH 补 verdict/cost/pr_url ③Step 1 planner 验收扩至尾部两字段+NFR段+行数 ④台账升级每阶段一行+附件(.harness/verdicts/<phase>-<sha7>.json 随 PR 入库) ⑤恢复规则补 generator (Red) commit TDD 纪律核对
  - 1.2.1: 台账 append 旁增加进度上报 PATCH(phase 中间态 planning/gan/generate/evaluate)——dashboard 进度条数据源;白名单扩展由 cecelia 侧 relay-watchdog PR 提供
  - 1.2.0: vendored Superpowers 6.0 三个确定性文件接力脚本(scripts/task-brief|review-package|sdd-workspace,MIT)——review diff 强制走 review-package(记录 BASE,禁 HEAD~1);工作区统一 .harness
  - 1.1.1: Step 4 补 evaluator unverifiable[] 兜底职责（T5 配套：controller 逐条核对无法验证项后才放行，对齐 SDD 6.0 Cannot-verify 裁决）
  - 1.1.0: N4 三跑实证修订——①merge 前禁退出(run-3 恢复session早退实证)②台账每步硬性 bash③report 回写 initiative_runs phase(治巡逻误报 Stuck)④CI 门禁三件套前置进 generator 验收(三跑均在 CI 才踩)
  - 1.0.0: 首版——SDD 模式移植（主理人 2026-07-04 拍板：单 session skill 接力，不自造 orchestrator，Brain 核心不动）
---

> **语言规则: 所有输出简体中文。**
> **角色**: 车间主任（编排/派活/验收），不亲自写代码。每个阶段派 fresh subagent（Task tool），自己只保留协调所需的最小上下文。

# /harness-controller — PR-level 单 session 接力编排

## 硬约束（凌驾于一切阶段逻辑）

1. **CONTRACT IS LAW**：合同批准后，任何阶段不得改合同/合同测试来迁就实现
2. **judge 是 merge 唯一权威**：CI 绿只是必要条件；evaluator PASS + judge PASS 才允许 merge（`should-auto-merge.sh` CI 双保险兜底，但你不得依赖它兜底）
3. **绝不让同一 subagent 无变化重试**：BLOCKED 必须改变某样东西（补上下文/换模型/拆任务/上报）
4. **台账先行**：每个阶段完成立刻 append 台账，永远信台账+git/PR 外部真相，不信自己记忆
5. **零人为交互**（无头模式）：任何不确定 → 派 Research subagent 查（代码/decisions/learnings）代答；仅 review_required 的人工门除外
6. **完成判据 = PR MERGED + report done，两者齐才许结束 session**：修完 CI、推完 commit 都不算完——`gh pr view` 显示 MERGED 之前，你没有任何理由输出完成结论或停止工作（N4 run-3 实证：恢复 session 修完 CI 自判完成早退，害整条 run 多一次点火）

## Step 0: 上下文装载 + 台账检查（每次进入/恢复都先做）

```bash
# 0.1 任务上下文（Brain dispatch 注入 env；前台手跑则从参数拿）
: "${HARNESS_TASK_ID:?}" "${SPRINT_DIR:?}"
BRAIN=${BRAIN_URL:-http://localhost:5221}
TASK=$(curl -s "$BRAIN/api/brain/tasks/$HARNESS_TASK_ID")
# payload 里应有：prep_prd_body（/dev 交接）、journey_id、review_required、target_environment、base_repo

# 0.2 台账（compaction/崩溃恢复的锚，SDD 6.0 模式）
LEDGER=".harness/progress.md"
mkdir -p .harness .harness/verdicts
# .harness 整体忽略，但 verdicts/（裁决留痕附件）放行随 PR 入库
printf '*\n!.gitignore\n!verdicts/\n!verdicts/**\n' > .harness/.gitignore
cat "$LEDGER" 2>/dev/null || echo "(新 sprint，无台账)"
```

**0.3 前台点火防护（人工前台接管必做；Brain dispatch 注入 env 的无头跑跳过）**

前台点火 = 你自己 POST 注册了 harness_initiative 任务后，本 session 直接接管当 controller（不等 Brain tick 派发）。这条路径有两种分裂风险，07-06 infrastructure 任务 8e281976 实证过第一种：payload 缺 `orchestrator:"skill-relay"` 字段 → Brain executor 硬校验 41 秒把任务标 terminal failed（missing_orchestrator_flag），而前台 session 浑然不觉继续裸跑，Brain 记账与实际执行彻底分裂。第二种：任务停在 queued 会被下一个 tick 捡走 spawn 无头容器，与前台形成双跑。所以接管前必做：

```bash
# a. 确认任务活着（payload 必须含 orchestrator:"skill-relay"，/dev v21.4.0+ 模板已带；缺了会被秒杀）
STATUS=$(curl -s "$BRAIN/api/brain/tasks/$HARNESS_TASK_ID" | jq -r '.status // .task.status // empty')
if [ "$STATUS" = "failed" ]; then
  echo "任务已被 Brain 标 failed（大概率 payload 缺 orchestrator 字段）——修 payload 重新注册，禁止带着死任务裸跑"
  exit 1
fi

# b. 立即认领（queued→in_progress 是合法迁移；dispatcher 只 spawn queued 任务，认领后不会双跑）
[ "$STATUS" = "queued" ] && curl -s -X PATCH "$BRAIN/api/brain/tasks/$HARNESS_TASK_ID" \
  -H "Content-Type: application/json" -d '{"status":"in_progress"}'
```

前台点火没有 initiative_runs 行（该行由 Brain spawnSkillRelaySession INSERT，前台不经过它），因此各阶段的进度上报 `PATCH relay-runs` 会 404（"v2 run not found"）——这是**预期行为**，`|| true` 吞掉即可，不代表流程出错，也不会被 relay-watchdog 误重点火（它只扫 initiative_runs 行）。Brain 侧前台建档端点落地后本段更新。

**恢复规则**：台账里标 `done` 的阶段直接跳过；从第一个无记录阶段续跑。台账记录格式（每阶段一行，append-only）：

```
planner: done (sprint-prd.md@<commit7>, invariants=N, fr=N)
gan: done (contract-draft.md@<branch> r<N>, verdict=APPROVED, 铁律覆盖=N/N, rubric=.harness/verdicts/gan-<sha7>.json)
generator: done (pr=#<num>, red=<sha7>, green=<sha7>)
evaluator: done (verdict=PASS, sha=<pr_head7>, verdict_file=.harness/verdicts/evaluate-<sha7>.json)
judge: done (verdict=PASS, sha=<pr_head7>)
merge: done (pr=#<num> MERGED)
report: done
```

**台账升级：每阶段一行 + 附件（裁决留痕归档，把 N/A 变成分）**——relay 各棒的结构化产出（rubric scores、Golden Path 对照表、unverifiable[]、双门结果）只活在 subagent 报告文本里就等于没发生，评不了也审计不了。约定：
- 附件路径统一 `.harness/verdicts/<phase>-<sha7>.json`（phase = gan / evaluate 等，sha7 = 锚定 commit 前 7 位），**随 PR 入库**
- gan 行必附 reviewer 最终轮 rubric JSON 路径；evaluator 行必附 verdict JSON 路径（含 verdict/unverifiable[]/双门结果）
- controller 在验收对应阶段时负责把 subagent 报告里的结构化 JSON 落到该路径，再写台账行——**没有附件文件的 gan/evaluator done 行视为台账不完整**
- 为让 verdicts 随 PR 入库，Step 0 的 `.harness/.gitignore` 需放行该目录（见 Step 0 代码）

**外部真相优先**：台账说 generator done 但 `gh pr view` 说 PR 不存在 → 信 gh，重跑该阶段并在台账 append 更正行（不删旧行）。

**恢复时 generator TDD 纪律核对（#3540/#3542 实证：watchdog 重点火接续的跑无 (Red) commit——恢复 session 从中途接手时把"合同起草 commit"当 Red）**：generator 阶段部分完成（PR 已存在但台账无 generator done 行）时，接续前先跑：

```bash
git log --grep='(Red)' --oneline <PR分支>
```

查不到 (Red) commit → **不默认通过**，派 fix 轮要求 generator 补 TDD 纪律说明（说明 Red 基线在哪个 commit / 为何缺失 + 补跑合同测试证明先红后绿），核对通过后才继续接手。

**台账写入是硬性动作，不是可选项**（N4 三跑均未写台账，恢复全靠翻 git——本版修正）。每阶段完成必须执行**两个动作**（台账 + 进度上报，后者是 dashboard 进度条的数据源）：

```bash
echo "<阶段>: done (<关键证据>)" >> .harness/progress.md
# 进度上报（阶段→phase 映射：planner 完成→gan 开始报 gan;GAN 完成→generate;generator 完成→evaluate;
# judge PASS 后→由 report 步骤报 done。失败终局报 failed。上报失败不阻塞流程,warn 即可）
curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" -d '{"phase":"<下一阶段:planning|gan|generate|evaluate>"}' || true
```

## phase-event 自报（每阶段硬性动作，T7）

每次派阶段 subagent **前后**各执行一条 curl，让 Brain 的 `initiative_run_events` 有细粒度阶段心跳（zombie-reaper 以此作第二判活信号，防止长阶段被 `updated_at` 单信号误杀）：

```bash
# 派发前（<node> = planner|proposer|reviewer|generator|evaluator|judge|merge|report）
EVT_ID=$(curl -s -m 10 -X POST "$BRAIN/api/brain/harness/phase-event" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$HARNESS_INITIATIVE_ID\",\"node\":\"<node>\",\"status\":\"running\",\"model\":\"<模型档>\"}" | jq -r .id || true)

# subagent 返回后（成功 done / 失败 failed；cost_usd 可得才带）——EVT_ID 空（POST 失败）则跳过 PATCH
[ -n "$EVT_ID" ] && curl -s -m 10 -X PATCH "$BRAIN/api/brain/harness/phase-event/$EVT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"done\",\"ts_end\":$(date +%s)}" || true
```

- `HARNESS_INITIATIVE_ID` 未注入（前台手跑）→ 整段跳过，不报错不阻塞
- curl 失败 → 只记 log 继续，自报绝不阻塞主流程
- GAN 循环里 proposer/reviewer 每轮各报一对

## Step 1: Planner（写 PRD）

派 fresh subagent（Task tool，模型=标准档）：派发前后按「phase-event 自报」节自报 node=planner。

```
prompt: 调用 Skill(harness-planner)。上下文：
  TASK_ID=<id> SPRINT_DIR=<dir> BRAIN_URL=<url>
  PrepPRD 全文见 task payload.prep_prd_body（你自己 curl 取）。
  产出 <SPRINT_DIR>/sprint-prd.md 并 commit。
  报告格式：status(DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) + 产物路径 + invariant/累积FR 加载数
```

- harness-planner v8.12+ 自带整条 line 的 invariant 三源 + 累积 FR 加载——**验收时检查 sprint-prd.md 含「## Invariant 约束」「## 累积 FR」两段**，缺了 = planner 报告不实，打回重跑
- **验收清单扩展（4 跑实证：仅走完整点火链的 run1 齐全，恢复/二次点火路径下 planner 拿薄 prompt 大面积漏项）**，以下四项与"两段"同权，任一缺 = planner 报告不实，打回重跑：
  1. **尾部两字段**：PRD 末尾含 `journey_type:` 与 `target_environment:`（proposer 选模板、evaluator 派机器都依赖它们，缺了下游全瞎）
  2. **NFR 段**：含 `## NFR` 段，或显式写明"NFR: N/A"（静默缺失不算过）
  3. **PRD 行数（thin-slice 上限）**：`wc -l` 校验不超 thin-slice 上限（run4 曾 278 行失守）；超限 → 打回要求裁剪或标注"不计入"理由
- 四态处置：见「四态协议」节
- 完成 → 台账 append → Step 2

## Step 2: GAN（合同对抗，proposer × reviewer 循环）

循环（无硬轮数上限——刻意设计，禁加 MAX_ROUNDS；守护 = 预算/streak，见下）。每轮派 proposer/reviewer 前后按「phase-event 自报」节各自报一对（node=proposer / node=reviewer）：

1. 派 **proposer** fresh subagent：`调用 Skill(harness-contract-proposer)`，输入 = sprint-prd.md 路径 + 上轮 reviewer feedback 文件路径（首轮无）。产出 contract-draft.md + contract-dod.md + tests/ 推到 propose 分支
2. 派 **reviewer** fresh subagent：`调用 Skill(harness-contract-reviewer)`，输入 = PRD + 合同路径。产出 rubric 打分 + verdict
3. **controller 只认结构化 verdict**：APPROVED → 出环；REVISION → feedback 落文件、回 1
4. **铁律覆盖硬检查（controller 自查，不信 reviewer 自觉）**：PrepPRD 交接的每条铁律，在 contract-dod.md 里 grep 到对应断言才算过；缺 → 作为 feedback 打回 proposer（这是"0→1 积累必须加载"的机械保证）
5. **合同格式硬检查（确定性 bash，机器卡，不靠自觉）**：铁律覆盖只查"内容有没有"，本条查"格式对不对"——run4 实证：contract-dod.md 无一条 `[BEHAVIOR]` 也通过了旧检查。以下三项任一不过 → 打回 proposer 重出，**不许进 Step 3**：

```bash
DOD="<SPRINT_DIR>/contract-dod.md"
DRAFT="<SPRINT_DIR>/contract-draft.md"
# ① [BEHAVIOR] 条目 ≥4（proposer Step 2b 模板下限，住 dod）
[ "$(grep -c '\[BEHAVIOR\]' "$DOD")" -ge 4 ] || { echo "FAIL: [BEHAVIOR] 条目不足 4"; }
# ② 含 ## E2E 验收 段（proposer 实际结构：E2E 段住 contract-draft.md，非 dod）
grep -q '## E2E 验收' "$DRAFT" || { echo "FAIL: contract-draft.md 缺 ## E2E 验收 段"; }
# ③ 含 manual:bash 可执行验收命令（住 dod）
grep -q 'manual:bash' "$DOD" || { echo "FAIL: 缺 manual:bash 验收命令"; }
```

任一行输出 FAIL → 把 FAIL 原文作为 feedback 落文件、回本节第 1 步重派 proposer；三项全过才允许台账记 gan done

守护（照抄旧图语义）：proposer 连续 2 轮没 push 产物 / reviewer 连续 3 轮无 verdict / 成本超预算 → 终局 FAIL 上报

完成 → 台账 append（含轮次、铁律覆盖 N/N）→ Step 3

## Step 3: Generator（TDD 实现，SDD×TDD 的接点）

派 fresh subagent（模型=标准档）：派发前后按「phase-event 自报」节自报 node=generator。

```
prompt: 调用 Skill(harness-generator)。CONTRACT_BRANCH=<branch> SPRINT_DIR=<dir>。
  铁律：commit 1 = 合同测试原样 checkout(Red)，commit 2+ = 实现(Green)；
  测试文件 commit 1 后不可改（由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制）；push 前自跑合同 [BEHAVIOR] 全过。
  报告：四态 + pr_url + Red/Green commit SHA
```

- generator 内部 TDD 纪律由 harness-generator skill 承载（不变）；controller 验收三件事：**PR 真实存在**（gh pr view）、**commit 顺序含 (Red)/(Green)**、**CI 在跑**
- **PR 存在后立即早上报 pr_url**（验收 `gh pr view` 成功后执行，非阻塞；端点未上线返回 400 忽略即可）：

```bash
PR_URL_EARLY=$(gh pr view --json url -q .url 2>/dev/null || echo "")
if [ -n "$PR_URL_EARLY" ]; then
  curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
    -H "Content-Type: application/json" \
    -d "{\"phase\":\"generate\",\"pr_url\":\"$PR_URL_EARLY\"}" || true
fi
```
- **CI 门禁三件套 push 前自查**（N4 三跑全在 CI 才踩这些门，各浪费一轮修复——左移到此）：①contract-draft.md 含 Test Contract 表且 [BEHAVIOR] 覆盖文本与测试 it() 名称子串匹配 ②feat 改动带本 repo 约定的 smoke 脚本（按 base_repo 映射：cecelia = packages/brain/scripts/smoke/<feature>-smoke.sh 且登记 packages/quality/smoke-allowlist.txt；zenithjoy = .github/workflows/scripts/smoke/<feature>-smoke.sh 且进 smoke-baseline.txt 棘轮；其他第三方 repo 无此约定 → 本条跳过，以该 repo CI 实际门禁为准）③DoD 条目全勾 [x]。任一缺失 → 让 generator 补完再 push
- CI 失败 → 派 fix subagent（同 skill Mode 2，带失败日志），fix 轮次计入台账，上限 20
- 完成（CI 全绿）→ 台账 append → Step 4

## Step 4: Evaluator（真跑验收）

先跑**确定性双门**（不烧 LLM）：
- ARTIFACT 门：合同 [ARTIFACT] Test 命令逐条 bash 真跑，失败 → 直接判 FAIL 回 generator fix
- Contract Gate 反作弊（弱 oracle/mock 环境/exit-0 兜底红线）：命中 → `contract_invalid` 终局（责任在 GAN，不进 fix loop）

双门过 → 派 evaluator fresh subagent：`调用 Skill(harness-evaluator)`（target_environment 路由由 evaluator skill 自带）。派发前后按「phase-event 自报」节自报 node=evaluator。
- **verdict 锚定 PR head SHA 记入台账**；PR 后续有新 commit → 旧 verdict 作废必须重评
- FIXED 按 PASS 归一（前科语义）；FAIL → 带 feedback 回 Step 3 fix
- **evaluator 报 unverifiable[] 非空时（T5 第三态）**：controller 必须逐条兜底——用自己掌握的跨阶段上下文核对（查合同原意/看 PR diff/必要时派 Research subagent 实测）；确认是真缺口 → 按 FAIL 处理回 Step 3；确认可放行 → 记台账后继续。**禁止不核对就当 PASS 放行**

**evaluate_verdict 上报（1.9.0 起硬性动作，与台账 append 同时做）**——evaluator 每次出裁决（含 fix loop 重评）后立刻 best-effort 上报，让 initiative_runs.evaluate_verdict 有结构化值（cecelia#3754 起 PATCH 接住该字段；非法值 Brain 只 warn 不 400，绝不阻塞）：

```bash
curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" \
  -d '{"phase":"evaluate","evaluate_verdict":"<PASS|FAIL|FIXED>"}' || true
```

- verdict 原样发（FIXED 不用自己归一，Brain/gates 侧做归一）；写侧 COALESCE=提供即覆盖，fix loop 多轮以最后一次为准
- 前台手跑无 initiative_run 行时 404 照旧 `|| true` 吞掉（同进度上报语义）

## Step 5: Judge（独立裁判，硬门禁）

- 派发前后按「phase-event 自报」节自报 node=judge。
- 只对 evaluator PASS 复核。**主路径：curl Brain judge API**（跨 repo 化刀3：controller 跑在 relay 容器/第三方 repo 时，cecelia 相对路径脚本不存在，API 是唯一稳定入口；DeepSeek + Golden Path 逐步覆盖校验，逻辑=harness-judge.js 原样）：

```bash
# worktree 必须传宿主绝对路径：容器内用 $HARNESS_WORKTREE_HOST（Brain spawn 注入，brain@1.242.0 起）；
# 本机前台直跑时即 worktree 绝对路径本身。禁止传容器内 /workspace（Brain 容器读不到）。
JUDGE_RESP=$(curl -s -m 300 -X POST "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/judge" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$HARNESS_TASK_ID\",\"sprint_dir\":\"$SPRINT_DIR\",\"worktree\":\"${HARNESS_WORKTREE_HOST:-$PWD}\"}")
VERDICT=$(echo "$JUDGE_RESP" | jq -r '.verdict // empty')
FEEDBACK=$(echo "$JUDGE_RESP" | jq -r '.feedback // ""')
# HTTP 恒 200：VERDICT=PASS（API 已把 FIXED 归一为 PASS）→ 放行；FAIL/ERROR/空 → 一律按 FAIL 处理
```

  - agent_verdict 缺省时 API 自读 `<worktree>/.brain-result.json`；可选字段：agent_verdict / agent_feedback / prompt_dir / transcript_file
  - 兜底（仅 cecelia 本机直跑且 Brain API 不可达时）：`node scripts/harness-judge-cli.mjs --task-id <id> --sprint-dir <dir> --pr <url>`（CLI 保留不删，但第三方 repo 容器内不得作为主路径）
- judge FAIL → 带 feedback 回 Step 3（打回重写）；judge PASS → 台账 append（锚 sha）→ Step 6
- **禁止**：跳过 judge / 替 judge 降级 / 在 judge 前 merge

## Step 6: Review 门（仅 review_required=true）+ Merge

- merge 动作前后按「phase-event 自报」节自报 node=merge。
- review_required → 起预览环境 + Bark 通知主理人（附 approve 命令），阻塞等 task_events 批准事件
- **merge 前 SHA 锚定硬检查（确定性 bash，c66bbedc 实证：锚定后又进代码 commit、未重评直接 merge）**——"新 commit 旧 verdict 作废"不只写在 Step 4，merge 这里必须机械复核：

```bash
[ "$(gh pr view <pr> --json headRefOid -q .headRefOid)" = "$ANCHORED_SHA" ] || 回 Step 4 重评
```

  不相等 → **禁止 merge**，回 Step 4 以当前 head 重评（evaluator + judge 都要），台账 append 重评行后才可回到本步
- merge（唯一权威路径）：evaluator PASS + judge PASS（+ 人工批准如需）→ `gh pr merge --squash --delete-branch`
  - BEHIND → `gh pr update-branch` ≤3 次；**update 改变 head sha → evaluator/judge verdict 以新 sha 重锚**（轻量 rebase 不重评，台账记 re-anchor 行）
  - CONFLICTING → 终局 FAIL 上报
- **派生 staging_e2e（merge 确认后，best-effort，绝不阻塞）**：无论是本 session 自己 `gh pr merge` 成功、还是发现 PR 已被外部合并（`gh pr view` 直接是 MERGED），只要确认 MERGED 就派生一次——这是当前 staging→production 放行层唯一的产生入口，漏派会让这条 PR 永远进不了 staging E2E：

```bash
PR_URL=$(gh pr view <pr> --json url -q .url)
curl -s -m 15 -X POST "$BRAIN_URL/api/brain/harness/staging-e2e" \
  -H "Content-Type: application/json" \
  -d "{\"pr_url\":\"$PR_URL\",\"pr_branch\":\"$PR_BRANCH\",\"sub_task_id\":\"$HARNESS_TASK_ID\",\"initiative_id\":\"$HARNESS_INITIATIVE_ID\",\"journey_id\":\"$CECELIA_JOURNEY_ID\",\"base_repo\":\"$BASE_REPO\"}" \
  || echo "[staging-e2e] 派生调用失败（best-effort，不阻塞 merge）"
```

  非 200（含调用失败/超时）不得阻塞后续流程，台账 append 一行 `staging_e2e_spawned pr=<url>`（失败也记，写清失败原因）后继续 Step 7。
- 完成 → 台账 append → Step 7

## Step 7: Report（收尾六步）

调用 Skill(harness-report)（Phase A/B 不变：回写 Brain task 状态 → Dashboard → Notion → 飞书 → 本地备份 → Sprint 状态同步）。派发前后按「phase-event 自报」节自报 node=report。

**追加硬性动作——回写 initiative_runs 终态**（否则 Brain 巡逻把 run 误判为 Stuck at Planner 并派干预任务，N4 实证）：

```bash
curl -s -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" \
  -d '{"phase":"done","verdict":"PASS","cost":<总成本USD数字>,"pr_url":"<pr_url>"}'
  # 终局失败改 {"phase":"failed","failure_reason":"<一句话>","verdict":"FAIL","cost":<总成本>,"pr_url":"<有PR则填>"}
```

**PATCH body 三个新字段是硬性要求，不许只 PATCH phase**（#3540 为此加的字段，1.2.1 及以前只写 phase → dashboard verdict 全空、cost 全 0）：`verdict` = 最终裁决（PASS/FAIL）、`cost` = 全程累计成本、`pr_url` = PR 链接（从台账/`gh pr view --json url` 取）。`evaluate_verdict` 已在 Step 4 出裁决时上报过，此处不必重发（要重发也无害，COALESCE 覆盖）。

台账 append `report: done`，确认 PR 状态 = MERGED（硬约束 6），输出最终摘要，session 结束。

## 四态协议（所有 subagent 统一出口，处置表）

| 状态 | controller 动作 |
|---|---|
| DONE | 验收产物（外部真相核对）→ 台账 → 下一阶段 |
| DONE_WITH_CONCERNS | 读 concerns：正确性/scope 问题先解决再走；观察类记台账继续 |
| NEEDS_CONTEXT | 补齐缺失上下文（自己查或派 Research subagent 查），**同模型重派** |
| BLOCKED | 分诊：缺上下文→补料重派 / 需更强推理→**升级模型重派** / 任务太大→拆分 / 计划本身错→终局上报。绝不无变化重试 |

## CI 配套硬规矩（controller 的检查责任）

1. 合同测试 merge 后**永久留在 repo** 跑 regression——merge 前确认测试文件在 PR diff 里且路径在 CI 收集范围
2. tdd-commit-order（提交顺序）由 lint-tdd-commit-order CI 强校验；测试文件 commit 1 后不可改——由 evaluator CONTRACT-IS-LAW 与 judge 复核把关，CI 机械闸 lint-contract-test-immutability 落地后由其强制；controller 不得绕过任何已有门禁
3. feat PR 必须带 smoke 脚本（CI lint 强制）；zenithjoy 侧该 smoke 必须同步加进 `.github/workflows/scripts/smoke-baseline.txt`（棘轮闸 baseline-lint 机械强制，PR #1156 起——新债不欠，漏加 = `Smoke Glob Gate Passed` 红合不进）
4. **禁 `gh pr merge --admin`**，禁绕 CI
5. **E2E 验收脚本必须有 CI 回归宿主**（与第 1 条对称——合同测试留 repo 还不够，E2E 脚本也不能"只活一次"）：merge 前确认 contract-draft.md `## E2E 验收` 落地的脚本（e2e-verify.ps1 / e2e-verify.sh）已随 PR 入库到 `sprints/<sprint_dir>/`，且被某个 workflow 收集（现有 e2e-*.yml 的 paths 命中、或 nightly e2e glob 收集范围内）。evaluator 跑过一次 ≠ 有人持续守着；查不到收集宿主 → 让 generator 补 workflow 接线后才许 merge

## 文件接力纪律（SDD 6.0）

- 阶段间传**文件路径**，不往 subagent prompt 里粘贴大产物（合同/PRD/diff）
- review 用的 diff 以"派发前记录的 BASE"生成，**绝不用 HEAD~1**（多 commit 会静默截断）——用本 skill 自带脚本，不手拼：

```bash
# 派 generator/review 前记录 BASE=$(git rev-parse HEAD)
bash <skill目录>/scripts/review-package "$BASE" HEAD   # → .harness/review-<base7>..<head7>.diff(commits+stat+U10 diff 单文件)
bash <skill目录>/scripts/task-brief <PLAN文件> <N>      # → .harness/task-N-brief.md(单任务切片,喂 subagent 用路径)
```
- controller 自己不读全量 diff/合同——保持协调上下文恒定小，长跑不 compaction；万一 compaction，Step 0 台账恢复
