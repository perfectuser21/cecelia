---
id: harness-controller-skill
description: |
  Harness Controller — PR-level 单 session 编排者（SDD 模式）。2026-07-05 cecelia #3554 起为**唯一编排路径**：
  Brain 硬校验 payload.orchestrator==='skill-relay'，LangGraph 图已废弃（代码保留观察期但不再被 invoke）。
  一个 claude session 从头跑完一条 sprint：planner → GAN(proposer×reviewer) → generator(TDD) → evaluator → judge → merge → report。
  移植 Superpowers 6.0 subagent-driven-development 零件：进度台账 / 文件接力 / 四态出口协议 / 单评审双裁决 / compaction 恢复。
  点火方：Brain harness dispatch（无头）或人工前台（同一份 skill 两种触发，行为一致）。
  /dev 仍是唯一需求入口：本 skill 消费 /dev 路径C 的交接契约（PrepPRD + 铁律清单 + NFR），不做需求对抗。
version: 2.9.0
created: 2026-07-04
changelog:
  - 2.9.0: gear 档位：新增 gear=segmented 分叉（骨架棋盘 + 分段串行点绿，移植自 cecelia #4027 harness-gear 一体化 60a80ddc 决策2）——HARNESS_GEAR=segmented 时 Step 1 planner 照跑、Step 2 GAN 透传该档位给 proposer 输出多段 task-plan.json、GAN 后先派骨架 generator 落全红棋盘、再按 task-plan.json 串行段循环 generator(WORKSTREAM_INDEX)+evaluator(SEGMENT_EVAL)，同段 2 次仍败转 escalate，全段绿后走现行全量总验；复用既有 Step 0.1 HARNESS_GEAR 解析与 gear=hotfix 同款 default 不生效声明，不与 2.8.0 hotfix 支路冲突；HARNESS_GEAR 缺失/=default/=hotfix 时本节整节不生效
  - 2.8.0: gear=hotfix 短流程支路（handoff 0716 刀C，fcb459b5-c510-4f45-b41f-e71b100d94f1）——Step 0 新增 HARNESS_GEAR 变量（来源 payload.gear）；当 HARNESS_GEAR=hotfix 时跳过 GAN（proposer/reviewer）直接由 controller 从 thin_prd 锚定断言组装 contract-draft.md/contract-dod.md（输出 [gear=hotfix] skip proposer/reviewer GAN）；两条安全阀铁律：①generator 发现需改 Golden Path 断言 → FATAL 报错升档，禁止顺手改；②thin_prd 缺锚定声明 → 拒绝 hotfix，回退全流程（走完整 GAN 路径）；新增 examples/hotfix-shortflow/ 示例文件；全流程默认档（无 gear 字段）路径零回归
  - 2.7.0: Step 6 新增「毕业（测试入册）」机械步（刀1b relay 路径，配套 cecelia test-pyramid-guard 孤儿棘轮锁 0）——judge PASS 后、SHA 锚定与 merge 前，仓库存在 scripts/graduate-sprint-tests.mjs 时必须跑毕业脚本把 sprints/ 下 tests/ 与 e2e-verify.sh 搬进永久池（tests/regression/<slug>/ + scripts/smoke/e2e/<slug>.sh），commit+push 等 CI 绿再锚定；无脚本的 repo（如 zenithjoy-workspace）跳过。SHA 锚定条款新增与 update-branch 对称的毕业 commit 豁免（git diff --stat HEAD~1 证明纯 rename 零内容变更 → re-anchor 不触发 Step 4 全量重评）。插点依据：evaluator B-1 已把 e2e-verify.sh 固化完毕、merge 后无人再接手，且 guard 棘轮 orphans=0 会把没毕业的 PR 拦红
  - 2.5.0: 规则C配套（handoff 0714 刀2，proposer 9.10.0/reviewer 9.5.0）——Step 3 generator 验收新增「未覆盖真实链路清单转呈」：合同含 ## 未覆盖真实链路清单 段（非 N/A）必须原样进 PR 描述（缺则让 generator gh pr edit 补上）；Step 7 report 同步把该清单转呈最终报告/通知正文。mock 豁免必须呈现给用户，禁止静默
  - 2.6.0: EVA v2 审计六处修法——①Step 7 cost 条文诚实化（controller 拿不到 subagent 真实成本，30 条实证 29 条恒 0：有真实数据才填，否则填 0 并台账注明 cost=unsettled，Brain 侧 session 用量结算是正解已立案）②Step 5 judge VERDICT 对称上报 relay-runs judge_verdict（DB 30 条仅 2 非空的病根）③Step 3 PR 开出即台账 append 中间态 generator: pr_opened 行（31e29c09 实证死亡窗口台账止步 gan）④Step 3 controller 验收扩为四件：PR body/title 必须 grep 到 task id（Step 0.4 外部真相重建依赖此约定）⑤横切纪律 A 加 gan 附件质量门（rubric 必须标准 7 维，d063b3e5 实证自创 5 维）+ gan done 行登记 judgments_written=N ⑥report 台账行带明细 verdict/learnings_inserted/concerns（a85e0582 实证裸行无从审计）
  - 2.4.0: 治断点恢复失忆（issue 45dd6925）——Step 0.4 新增「台账缺失 ≠ 新 sprint」外部真相重建：.harness/progress.md 是 gitignore 本地文件，worktree 收割/重建后必然蒸发（07-13 d063b3e5 实证重派=全新 clone，恢复 session 重跑 planner+GAN 白烧 $7+）；台账不存在时先查 gh pr list（open→重建台账续跑 / merged→直跳 merge 后半程）+ relay-runs phase 佐证，全无外部真相才许当新 sprint
  - 2.3.0: refactor Step 3 CI 阻塞等待——抽共享 scripts/ci-poll.sh（退出码 0=全绿/10=有失败/11=BEHIND，sleep 30 在脚本内），Step 3 循环体改为调用脚本，出口动作不变（绿→evaluator，失败→fix subagent）；engine-pr-watchdog Step 2 同步改造，单一 SSOT 不漂移
  - 2.2.0: 治 relay 断链头号死因「结束发言等 CI」——新增硬约束 7（等外部事件必须前台阻塞轮询，禁止"等通知"后停止输出：headless -p 模式结束输出=进程退出=session 自杀）+ Step 3 新增「CI 阻塞等待」机械段（同步 bash sleep 30 轮询循环，Bash 超时立刻重发不结束 turn，绝不 run_in_background；照抄 engine-pr-watchdog 已验证模式）。07-12 实证：31e29c09/a1bf1ba5/4bb31ef5 三条 relay 均在 generator 开出 PR 后说"等待 CI 结果通知"正常退出（45 turns/18min，离任何资源墙都远），evaluator/judge/merge/report 全链 0 执行、任务假 done；watchdog 重点火的恢复 session 又以"CI 在跑等信号"1 turn 再死。对照组 a85e0582 全程未撒手，1h47m 八节点全通——链本身是通的，死因只此一处
  - 2.1.0: Step 7 收尾追加自杀式 tmux 关窗——检测 $TMUX/读会话名/后台延迟 kill-session，非 tmux 或读不到会话名降级为提示不阻塞（07-08/09 T2/T3/T4 三个有头任务收尾后 tmux 窗口不自关，空转两天没人关；cecelia #4c6c6ca5 配套）
  - 2.0.0: 重写（自我进化 P3→P5 试点）——吸收 1.0.0~1.9.0 全部踩坑修订后整体重组：横切纪律（台账/进度上报/phase-event/文件接力）归拢为独立一节不再散落各 Step；历史事故叙事压缩为短引用；操作规则、bash 块、API 契约字符串全部保留。规则零新增零删除，纯结构重组
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

编排语义：skill-relay 单 session 接力（LangGraph 图已废弃，不再被 invoke）。流程主线：

```
Step 0 装载/恢复 → 1 planner → 2 GAN(proposer×reviewer) → 3 generator(TDD)
→ 4 evaluator(双门+真跑) → 5 judge → 6 review门+merge(+staging_e2e派生) → 7 report
```

## 硬约束（凌驾于一切阶段逻辑）

1. **CONTRACT IS LAW**：合同批准后，任何阶段不得改合同/合同测试来迁就实现
2. **judge 是 merge 唯一权威**：CI 绿只是必要条件；evaluator PASS + judge PASS 才允许 merge（`should-auto-merge.sh` CI 双保险兜底，但你不得依赖它兜底）
3. **绝不让同一 subagent 无变化重试**：BLOCKED 必须改变某样东西（补上下文/换模型/拆任务/上报）
4. **台账先行**：每个阶段完成立刻 append 台账，永远信台账+git/PR 外部真相，不信自己记忆
5. **零人为交互**（无头模式）：任何不确定 → 派 Research subagent 查（代码/decisions/learnings）代答；仅 review_required 的人工门除外
6. **完成判据 = PR MERGED + report done，两者齐才许结束 session**：修完 CI、推完 commit 都不算完——`gh pr view` 显示 MERGED 之前，你没有任何理由输出完成结论或停止工作（N4 run-3 实证：恢复 session 修完 CI 自判完成早退，害整条 run 多点火一次）
7. **等任何外部事件（CI/部署/审批）必须前台阻塞轮询，禁止"结束发言等通知"**：headless `claude -p` 模式下你结束输出的那一刻进程就退出了，没有任何人会来"通知"你——说"等待 CI 结果通知"然后停止输出 = session 自杀（07-12 实证：31e29c09/a1bf1ba5/4bb31ef5 三条 relay 全断在 generator 后"等 CI"，evaluator/judge/merge/report 全链 0 执行，任务假 done；被 watchdog 重点火的恢复 session 又说一句"CI 在跑等信号"1 turn 再死）。等待方式只有一种：同步 bash sleep 轮询循环（机械做法见 Step 3「CI 阻塞等待」），单次 Bash 调用超时就立刻发起下一次调用，绝不 run_in_background，绝不输出"等待…"后停手

## 横切纪律（每个阶段都适用的硬性动作）

### A. 台账（append-only，compaction/崩溃恢复的锚）

台账 = `.harness/progress.md`。**每阶段完成必须执行两个动作**（台账写入是硬性动作不是可选项——N4 三跑均未写台账，恢复全靠翻 git）：

```bash
# 动作一：台账 append
echo "<阶段>: done (<关键证据>)" >> .harness/progress.md
# 动作二：进度上报（dashboard 进度条数据源。阶段→phase 映射：planner 完成→gan 开始报 gan;
# GAN 完成→generate;generator 完成→evaluate;judge PASS 后→由 report 步骤报 done。
# 失败终局报 failed。上报失败不阻塞流程,warn 即可）
curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" -d '{"phase":"<下一阶段:planning|gan|generate|evaluate>"}' || true
```

台账记录格式（每阶段一行，append-only）：

```
planner: done (sprint-prd.md@<commit7>, invariants=N, fr=N)
gan: done (contract-draft.md@<branch> r<N>, verdict=APPROVED, 铁律覆盖=N/N, judgments_written=N, rubric=.harness/verdicts/gan-<sha7>.json)
generator: done (pr=#<num>, red=<sha7>, green=<sha7>)
evaluator: done (verdict=PASS, sha=<pr_head7>, verdict_file=.harness/verdicts/evaluate-<sha7>.json)
judge: done (verdict=PASS, sha=<pr_head7>)
merge: done (pr=#<num> MERGED)
report: done (verdict=<v>, learnings_inserted=<N>, concerns=<无|数量>)
```

**附件约定（裁决留痕归档，把 N/A 变成分）**——relay 各棒的结构化产出（rubric scores、Golden Path 对照表、unverifiable[]、双门结果）只活在 subagent 报告文本里就等于没发生，评不了也审计不了：
- 附件路径统一 `.harness/verdicts/<phase>-<sha7>.json`（phase = gan / evaluate 等，sha7 = 锚定 commit 前 7 位），**随 PR 入库**
- gan 行必附 reviewer 最终轮 rubric JSON 路径；evaluator 行必附 verdict JSON 路径（含 verdict/unverifiable[]/双门结果）
- controller 在验收对应阶段时负责把 subagent 报告里的结构化 JSON 落到该路径，再写台账行——**没有附件文件的 gan/evaluator done 行视为台账不完整**
- **gan 附件质量门（EVA v2）**：gan 附件的 rubric JSON 必须含标准 7 维 `rubric_scores`——缺维/自创维度 = 无效 verdict，打回 reviewer 重出（d063b3e5 实证 reviewer 自创 5 维照样被当有效 verdict 收下）
- **判定点回执（EVA v2）**：gan done 行必须登记 `judgments_written=N`（从 reviewer 报告取）；合同有判定点登记表但 N=0 → 台账记一行 WARN，不静默放过
- 为让 verdicts 随 PR 入库，Step 0 的 `.harness/.gitignore` 需放行该目录（见 Step 0 代码）

**外部真相优先**：台账说 generator done 但 `gh pr view` 说 PR 不存在 → 信 gh，重跑该阶段并在台账 append 更正行（不删旧行）。

### B. phase-event 自报（T7，zombie-reaper 第二判活信号）

每次派阶段 subagent **前后**各执行一条 curl，让 Brain 的 `initiative_run_events` 有细粒度阶段心跳（07-04 LangGraph→relay 切换后该表一度断供；zombie-reaper 以此作第二判活信号，防长阶段被 `updated_at` 单信号误杀）：

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

### C. 文件接力（SDD 6.0）

- 阶段间传**文件路径**，不往 subagent prompt 里粘贴大产物（合同/PRD/diff）
- review 用的 diff 以"派发前记录的 BASE"生成，**绝不用 HEAD~1**（多 commit 会静默截断）——用本 skill 自带脚本，不手拼：

```bash
# 派 generator/review 前记录 BASE=$(git rev-parse HEAD)
bash <skill目录>/scripts/review-package "$BASE" HEAD   # → .harness/review-<base7>..<head7>.diff(commits+stat+U10 diff 单文件)
bash <skill目录>/scripts/task-brief <PLAN文件> <N>      # → .harness/task-N-brief.md(单任务切片,喂 subagent 用路径)
```

- controller 自己不读全量 diff/合同——保持协调上下文恒定小，长跑不 compaction；万一 compaction，Step 0 台账恢复

## Step 0: 上下文装载 + 台账检查（每次进入/恢复都先做）

```bash
# 0.1 任务上下文（Brain dispatch 注入 env；前台手跑则从参数拿）
: "${HARNESS_TASK_ID:?}" "${SPRINT_DIR:?}"
BRAIN=${BRAIN_URL:-http://localhost:5221}
TASK=$(curl -s "$BRAIN/api/brain/tasks/$HARNESS_TASK_ID")
# payload 里应有：prep_prd_body（/dev 交接）、journey_id、review_required、target_environment、base_repo、gear（可选，hotfix=短流程）
HARNESS_GEAR=${GEAR:-$(echo "$TASK" | jq -r '.payload.gear // empty')}

# 0.2 台账（compaction/崩溃恢复的锚，SDD 6.0 模式）
LEDGER=".harness/progress.md"
mkdir -p .harness .harness/verdicts
# .harness 整体忽略，但 verdicts/（裁决留痕附件）放行随 PR 入库
printf '*\n!.gitignore\n!verdicts/\n!verdicts/**\n' > .harness/.gitignore
cat "$LEDGER" 2>/dev/null || echo "(新 sprint，无台账)"
```

### 0.3 前台点火防护（人工前台接管必做；Brain dispatch 注入 env 的无头跑跳过）

前台点火 = 你自己 POST 注册了 harness_initiative 任务后，本 session 直接接管当 controller（不等 Brain tick 派发）。两种分裂风险（第一种 07-06 任务 8e281976 实证）：①payload 缺 `orchestrator:"skill-relay"` 字段 → Brain executor 硬校验秒标 terminal failed（missing_orchestrator_flag），前台 session 浑然不觉继续裸跑，Brain 记账与实际执行彻底分裂；②任务停在 queued 会被下一个 tick 捡走 spawn 无头容器，与前台形成双跑。接管前必做：

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

### 0.4 恢复规则

台账里标 `done` 的阶段直接跳过；从第一个无记录阶段续跑。

**台账缺失 ≠ 新 sprint（issue 45dd6925）**：`.harness/progress.md` 是 gitignore 的本地文件，worktree 被收割/重建后必然蒸发（07-13 实证：task d063b3e5 重派时 worktree 是全新 clone，恢复 session 浑然不觉重跑了 planner+GAN，两个 session 白烧 $7+，最后还是人工收尾）。台账不存在（或为空）时**禁止直接当新 sprint 开跑**——先查外部真相，能重建台账就重建：

```bash
if [ ! -s .harness/progress.md ]; then
  # a. 找本任务的 PR（generator 阶段的外部真相；标题/正文带 task id 是 generator 约定）
  PR_HIT=$(gh pr list --state open --search "$HARNESS_TASK_ID" --json number,headRefName -q '.[0]' 2>/dev/null)
  [ -z "$PR_HIT" ] && PR_HIT=$(gh pr list --state open --search "${HARNESS_TASK_ID:0:8}" --json number,headRefName -q '.[0]' 2>/dev/null)
  # b. Brain 侧 relay-runs phase 佐证（前台跑无 initiative_run 行则为空，不阻塞）
  RUN_PHASE=$(curl -s -m 10 "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" 2>/dev/null | jq -r '.phase // empty')

  if [ -n "$PR_HIT" ]; then
    PR_BRANCH=$(echo "$PR_HIT" | jq -r .headRefName); PR_NUM=$(echo "$PR_HIT" | jq -r .number)
    git fetch origin "$PR_BRANCH" && git checkout "$PR_BRANCH"
    # c. 按 PR 分支上的产物逐阶段重建台账行（verdicts/ 附件随 PR 入库，checkout 后一并找回）
    [ -f "$SPRINT_DIR/sprint-prd.md" ] && echo "planner: done (rebuilt@$(git log -1 --format=%h -- "$SPRINT_DIR/sprint-prd.md"))" >> .harness/progress.md
    [ -f "$SPRINT_DIR/contract-draft.md" ] && echo "gan: done (rebuilt@$(git log -1 --format=%h -- "$SPRINT_DIR/contract-draft.md"))" >> .harness/progress.md
    echo "generator: done (rebuilt: pr=#$PR_NUM)" >> .harness/progress.md
    ls .harness/verdicts/evaluate-*.json >/dev/null 2>&1 && echo "evaluator: done (rebuilt: verdicts/ 附件)" >> .harness/progress.md
    echo "台账已从外部真相重建（relay-runs phase=$RUN_PHASE 佐证）："; cat .harness/progress.md
  elif [ -n "$(gh pr list --state merged --search "$HARNESS_TASK_ID" --json number -q '.[0].number' 2>/dev/null)" ]; then
    # PR 已 MERGED = planner→merge 全部完成过 → 直接进 Step 6 已合并路径（补 staging_e2e 派生）+ Step 7 report
    echo "本任务 PR 已 MERGED——跳过 planner→judge，从 merge 后半程（staging_e2e 派生 + report）续跑，禁止从头重跑"
  fi
fi
```

重建出的台账照常适用"从第一个无记录阶段续跑"；重建的 `generator: done` 行同样要过下面的 TDD 纪律核对。重建不出任何外部真相（无 PR、无 relay-runs 行）才允许按新 sprint 从 Step 1 开跑。

**恢复时 generator TDD 纪律核对**（#3540/#3542 实证：watchdog 重点火接续的跑无 (Red) commit——恢复 session 从中途接手时把"合同起草 commit"当 Red）。generator 阶段部分完成（PR 已存在但台账无 generator done 行）时，接续前先跑：

```bash
git log --grep='(Red)' --oneline <PR分支>
```

查不到 (Red) commit → **不默认通过**，派 fix 轮要求 generator 补 TDD 纪律说明（说明 Red 基线在哪个 commit / 为何缺失 + 补跑合同测试证明先红后绿），核对通过后才继续接手。

## gear=hotfix 短流程（Step 0 尾部路由，在 Step 1 之前执行）

当 `HARNESS_GEAR=hotfix` 时，**跳过 GAN（proposer/reviewer）**，由 controller 直接从 thin_prd 锚定断言组装合同产物。

```bash
if [ "$HARNESS_GEAR" = "hotfix" ]; then
  echo "[gear=hotfix] skip proposer/reviewer GAN — controller 直接组装合同"
  # 从 sprint-prd.md 的「## 锚定声明」段提取断言，生成 contract-draft.md / contract-dod.md
  # 完成后跳到 Step 3 generator（TDD），不走 Step 2 GAN 循环
fi
```

### 安全阀铁律（gear=hotfix 专属，凌驾于短流程逻辑）

**安全阀①（generator 层）**：generator 在实现过程中发现需要修改 Golden Path 断言时，**必须立即 FATAL 报错升档**，禁止顺手改——hotfix 档的锚定断言是只读输入，任何对合同基线的改动都必须升档为全流程任务（走 GAN 重新对抗）。

```
[FATAL] gear=hotfix 禁止顺手改 Golden Path 断言 — 请升档为全流程 sprint 重新对抗合同
```

**安全阀②（controller 层）**：controller 在装载 thin_prd 时，若发现 sprint-prd.md **缺锚定声明**（无 `## 锚定声明` 段或该段内容为空），**拒绝 hotfix**，立即回退全流程——将 HARNESS_GEAR 置空，回到 Step 2 GAN 正常路径。

```bash
if ! grep -q "## 锚定声明" "$SPRINT_DIR/sprint-prd.md" 2>/dev/null; then
  echo "[gear=hotfix] thin_prd 缺锚定声明 — 拒绝 hotfix，回退全流程（GAN 路径）"
  HARNESS_GEAR=""  # 清空 gear，下方流程走标准 GAN
fi
```

## gear=segmented 分叉（骨架棋盘 + 分段串行点绿，Step 0 尾部路由，在 Step 1 之前执行）

当 `HARNESS_GEAR=segmented` 时（Step 0.1 已从 `payload.gear` 解出该变量，判定方式与上面 gear=hotfix 一致），走本节接管的改写版 Step 1/2/3/4，完成后回到 Step 5 继续现行主线；其余取值（缺失/default/hotfix）本节整节不生效，不受任何段落影响。

适用场景：RPA/真机等无法一次成型的大颗粒任务，需要拆多段（task-plan.json 的 `tasks` 数组）串行落地，每段独立点绿再进下一段。

### 步骤

1. **Step 1 planner 照跑**（现行不改）：派 harness-planner，产出 sprint-prd.md，验收清单五项不变。

2. **Step 2 GAN 照跑，但派 proposer 的 prompt 里透传一行 `HARNESS_GEAR=segmented`**（proposer skill 据此输出多段 task-plan.json，非 segmented 时仍输出单段 ws1，proposer 侧逻辑不属本节改动范围）：

```
prompt: 调用 Skill(harness-contract-proposer)。上下文追加一行：
  HARNESS_GEAR=segmented
  （其余输入同现行：sprint-prd.md 路径 + 上轮 reviewer feedback 路径）
```

   GAN 循环、铁律覆盖硬检查、合同格式硬检查三项与现行 Step 2 完全一致；额外核对一项：`${SPRINT_DIR}/task-plan.json` 存在且 `tasks[]` 非空，每个 task 有 `task_id`（形如 ws1..N）、`depends_on`（ws1 唯一允许 `[]`，ws2+ 必须声明前置）——不过 → 打回 proposer 重出。

3. **GAN 通过后先派骨架 generator**（落全红棋盘）：

```
prompt: 调用 Skill(harness-generator)。CONTRACT_BRANCH=<branch> SPRINT_DIR=<dir>。
  payload.is_skeleton=true。
  本轮只落整条 golden path 的全红测试棋盘（覆盖 task-plan.json 里全部 ws1..N 的验收测试），
  commit 到 CONTRACT_BRANCH，不实现任何功能代码。
  报告：四态 + 棋盘 commit SHA + 覆盖的 ws 列表
```

   验收：commit 存在、测试棋盘跑起来全红（非报错崩溃，是断言失败）、覆盖 task-plan.json 全部段。台账 append `skeleton: done (棋盘@<sha7>, ws=N段)`。

4. **按 task-plan.json 的 tasks 数组串行循环**（ws1 → ws2 → … → wsN，按 `depends_on` 链式推进，不并发）：

   对每个 ws_i：

   a. 派 **generator**，prompt 头带 `WORKSTREAM_INDEX=<task_id>`：

```
prompt: 调用 Skill(harness-generator)。CONTRACT_BRANCH=<branch> SPRINT_DIR=<dir>。
  WORKSTREAM_INDEX=<task_id>
  只实现本段 scope（task-plan.json 该 ws 条目的 scope/files），禁碰他段实现文件；
  只点绿本段对应的棋盘测试，TDD 纪律（commit 顺序/测试不可改）与现行一致。
  报告：四态 + commit SHA + 本段点绿的测试清单
```

   b. 段验：派 **evaluator**，prompt 头带 `SEGMENT_EVAL=<task_id>`：

```
prompt: 调用 Skill(harness-evaluator)。SEGMENT_EVAL=<task_id>
  跳 final-E2E，只跑本段 [BEHAVIOR]/tests 断言 + 复跑此前已绿段的测试
  （回归棘轮：已绿段测试变红 = 本段判 FAIL，失败摘要注明回归项）。
  报告：verdict(PASS/FAIL) + 明细
```

   c. 处置：
      - PASS → 台账 append `segment: done (ws=<task_id>, verdict=PASS)`，进入下一个 ws；全部 ws 跑完进入第 5 步
      - FAIL → 重派该段 generator，prompt 附上失败摘要（同段第 2 次派发）；同一段**累计 2 次仍败** → 终局按现行「四态协议」BLOCKED/escalate 路径上报，绝不无变化第 3 次重试

   骨架棒与每段 generator/evaluator 派发同样适用横切纪律 A（台账）/B（phase-event，node=generator/evaluator，可附加 task_id 便于追踪）/C（文件接力，段间只传 task-N-brief.md 路径，不粘贴大产物）。

5. **全段绿后派现行全量 evaluator 总验**（不带 `SEGMENT_EVAL`，走完整 final-E2E，与现行 Step 4 一字不改）；总验 PASS → 台账 append `evaluator: done (总验, verdict=PASS)` → 进入现行 Step 5 judge。

6. Step 5 judge → Step 6 merge（含 staging_e2e 派生）→ Step 7 report，与现行完全一致，不再有任何 segmented 专属分叉。

### 与现行的差异边界

- Step 1 不变；Step 2 追加一行透传 + task-plan.json 多段格式核对
- 新增骨架棒（一次）+ 段循环（N 次 generator+evaluator 配对），全部在 controller 本 session 内用 Task tool 派发，不产生额外 Brain 任务，dispatcher 并发模型不受影响
- **骨架棒与全部段棒的实现 commit 都落在同一条 PR 分支**（沿用现行 harness-generator Step 2 的 PR 分支约定 `cp-$(date +%m%d%H%M)-${TASK_ID前8位}`——骨架棒首次调用建出该分支，后续每个 ws_i 的 generator 派发都在这条分支上续 commit，不为分段另开新分支）
- 总验后 Step 5-7 与现行零差异

## Step 1: Planner（写 PRD）

派 fresh subagent（Task tool，模型=标准档）：派发前后按「横切纪律 B」自报 node=planner。

```
prompt: 调用 Skill(harness-planner)。上下文：
  TASK_ID=<id> SPRINT_DIR=<dir> BRAIN_URL=<url>
  PrepPRD 全文见 task payload.prep_prd_body（你自己 curl 取）。
  产出 <SPRINT_DIR>/sprint-prd.md 并 commit。
  报告格式：status(DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED) + 产物路径 + invariant/累积FR 加载数
```

**验收清单（五项同权，任一缺 = planner 报告不实，打回重跑）**——恢复/二次点火路径下 planner 拿薄 prompt 会大面积漏项（4 跑实证：仅走完整点火链的 run1 齐全）：

1. **「## Invariant 约束」段**（harness-planner v8.12+ 自带整条 line 的 invariant 三源加载）
2. **「## 累积 FR」段**
3. **尾部两字段**：PRD 末尾含 `journey_type:` 与 `target_environment:`（proposer 选模板、evaluator 派机器都依赖它们，缺了下游全瞎）
4. **NFR 段**：含 `## NFR` 段，或显式写明"NFR: N/A"（静默缺失不算过）
5. **PRD 行数（thin-slice 上限）**：`wc -l` 校验不超 thin-slice 上限（run4 曾 278 行失守）；超限 → 打回要求裁剪或标注"不计入"理由

四态处置：见「四态协议」节。完成 → 台账 append → Step 2。

## Step 2: GAN（合同对抗，proposer × reviewer 循环）

循环（无硬轮数上限——刻意设计，禁加 MAX_ROUNDS；守护 = 预算/streak，见下）。每轮派 proposer/reviewer 前后按「横切纪律 B」各自报一对（node=proposer / node=reviewer）：

1. 派 **proposer** fresh subagent：`调用 Skill(harness-contract-proposer)`，输入 = sprint-prd.md 路径 + 上轮 reviewer feedback 文件路径（首轮无）。产出 contract-draft.md + contract-dod.md + tests/ 推到 propose 分支
2. 派 **reviewer** fresh subagent：`调用 Skill(harness-contract-reviewer)`，输入 = PRD + 合同路径。产出 rubric 打分 + verdict
3. **controller 只认结构化 verdict**：APPROVED → 出环；REVISION → feedback 落文件、回 1
4. **铁律覆盖硬检查（controller 自查，不信 reviewer 自觉）**：PrepPRD 交接的每条铁律，在 contract-dod.md 里 grep 到对应断言才算过；缺 → 作为 feedback 打回 proposer（这是"0→1 积累必须加载"的机械保证）
5. **合同格式硬检查（确定性 bash，机器卡，不靠自觉）**：铁律覆盖只查"内容有没有"，本条查"格式对不对"（run4 实证：contract-dod.md 无一条 `[BEHAVIOR]` 也通过了旧检查）。以下三项任一不过 → 打回 proposer 重出，**不许进 Step 3**：

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

任一行输出 FAIL → 把 FAIL 原文作为 feedback 落文件、回本节第 1 步重派 proposer；三项全过才允许台账记 gan done。

守护（照抄旧图语义）：proposer 连续 2 轮没 push 产物 / reviewer 连续 3 轮无 verdict / 成本超预算 → 终局 FAIL 上报。

完成 → 台账 append（含轮次、铁律覆盖 N/N）→ Step 3。

## Step 3: Generator（TDD 实现，SDD×TDD 的接点）

派 fresh subagent（模型=标准档）：派发前后按「横切纪律 B」自报 node=generator。

```
prompt: 调用 Skill(harness-generator)。CONTRACT_BRANCH=<branch> SPRINT_DIR=<dir>。
  铁律：commit 1 = 合同测试原样 checkout(Red)，commit 2+ = 实现(Green)；
  测试文件 commit 1 后不可改（由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制）；push 前自跑合同 [BEHAVIOR] 全过。
  报告：四态 + pr_url + Red/Green commit SHA
```

- generator 内部 TDD 纪律由 harness-generator skill 承载（不变）；controller 验收四件事（EVA v2 由三扩四）：**PR 真实存在**（gh pr view）、**commit 顺序含 (Red)/(Green)**、**CI 在跑**、**PR 带 task id**——第四件机械 grep 不烧 LLM：`gh pr view <pr> --json body,title | grep -q $HARNESS_TASK_ID`，不中即让 generator 在 PR body 补一行 task id。Step 0.4 的外部真相重建（`gh pr list --search $HARNESS_TASK_ID`）全靠这个约定，漏带则重建落空
- **PR 存在后立即早上报 pr_url + 台账中间态留痕（EVA v2）**（验收 `gh pr view` 成功后执行，非阻塞；端点未上线返回 400 忽略即可）：

```bash
PR_URL_EARLY=$(gh pr view --json url -q .url 2>/dev/null || echo "")
if [ -n "$PR_URL_EARLY" ]; then
  curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
    -H "Content-Type: application/json" \
    -d "{\"phase\":\"generate\",\"pr_url\":\"$PR_URL_EARLY\"}" || true
  # 台账同步 append 中间态行（EVA v2）——31e29c09 实证「开 PR→CI 绿」窗口死亡则台账止步 gan，恢复只能靠 Step 0.4 兜底
  echo "generator: pr_opened (#<num>, red=<sha7>)" >> .harness/progress.md
fi
```

  中间态行与既有「更正行不删旧行」语义一致：后续 CI 全绿完成时照常再 append 正式 `generator: done` 行，不删 pr_opened 行。

- **CI 门禁三件套 push 前自查**（N4 三跑全在 CI 才踩这些门，各浪费一轮修复——左移到此）：①contract-draft.md 含 Test Contract 表且 [BEHAVIOR] 覆盖文本与测试 it() 名称子串匹配 ②feat 改动带本 repo 约定的 smoke 脚本（按 base_repo 映射：cecelia = packages/brain/scripts/smoke/<feature>-smoke.sh 且登记 packages/quality/smoke-allowlist.txt；zenithjoy = .github/workflows/scripts/smoke/<feature>-smoke.sh 且进 smoke-baseline.txt 棘轮；其他第三方 repo 无此约定 → 本条跳过，以该 repo CI 实际门禁为准）③DoD 条目全勾 [x]。任一缺失 → 让 generator 补完再 push
- **未覆盖真实链路清单转呈（规则C配套，proposer 9.10.0）**：contract-draft.md 含 `## 未覆盖真实链路清单` 段且非 N/A → 验收时必须确认 PR 描述已原样附上该段（缺 → 让 generator `gh pr edit --body-file` 补上）。该清单是用户看见"哪些真实链路没测到"的唯一通道，禁止静默吞掉 mock 豁免
- CI 失败 → 派 fix subagent（同 skill Mode 2，带失败日志），fix 轮次计入台账，上限 20
- 完成（CI 全绿）→ 台账 append → Step 4

**CI 阻塞等待（硬约束 7 的机械做法——这是等 CI 的唯一合法方式）**

PR push 后 CI 要跑若干分钟。**禁止**输出"等待 CI 结果/等通知"然后停止——headless 下你一停进程就退出，整条 relay 死在这里（07-12 三条 run 实证，这是 relay 断链的头号死因）。必须用同步 Bash 轮询循环把自己钉在前台：

```bash
# 同步执行（绝不 run_in_background），Bash timeout 设 600000（工具上限 10 分钟）
# CI 轮询委托给共享脚本（SSOT：~/perfect21/zenithjoy-skills/scripts/ci-poll.sh）
# 退出码 0=全绿 10=有失败 11=BEHIND；BEHIND 时继续等，直到非 BEHIND 为止
CI_STATUS="PENDING"
until [ "$CI_STATUS" != "PENDING" ]; do
  bash ~/perfect21/zenithjoy-skills/scripts/ci-poll.sh "$PR_NUM" "$REPO"
  case $? in
    0) CI_STATUS="GREEN" ;;
    10) CI_STATUS="FAILED" ;;
    11) CI_STATUS="PENDING" ;;
  esac
done
if [ "$CI_STATUS" = "GREEN" ]; then echo "CI_GREEN"; else echo "CI_FAILED"; fi
```

- 单次 Bash 调用到 10 分钟超时被截断 → **不输出任何文字，立刻发起下一次同样的 Bash 调用**继续轮询（turn 不结束，进程就不会死）
- 循环退出后立刻走对应分支（绿→Step 4 / 失败→fix subagent），中间不停顿
- 同规则适用于一切外部等待：deploy 完成、审批事件、workflow run——凡是"要等"，一律 sleep 循环，绝无例外

## Step 4: Evaluator（真跑验收）

先跑**确定性双门**（不烧 LLM）：
- ARTIFACT 门：合同 [ARTIFACT] Test 命令逐条 bash 真跑，失败 → 直接判 FAIL 回 generator fix
- Contract Gate 反作弊（弱 oracle/mock 环境/exit-0 兜底红线）：命中 → `contract_invalid` 终局（责任在 GAN，不进 fix loop）

双门过 → 派 evaluator fresh subagent：`调用 Skill(harness-evaluator)`（target_environment 路由由 evaluator skill 自带）。派发前后按「横切纪律 B」自报 node=evaluator。

- **verdict 锚定 PR head SHA 记入台账**；PR 后续有新 commit → 旧 verdict 作废必须重评
- FIXED 按 PASS 归一（前科语义）；FAIL → 带 feedback 回 Step 3 fix
- **evaluator 报 unverifiable[] 非空时（T5 第三态）**：controller 必须逐条兜底——用自己掌握的跨阶段上下文核对（查合同原意/看 PR diff/必要时派 Research subagent 实测）；确认是真缺口 → 按 FAIL 处理回 Step 3；确认可放行 → 记台账后继续。**禁止不核对就当 PASS 放行**

**evaluate_verdict 上报（硬性动作，与台账 append 同时做）**——evaluator 每次出裁决（含 fix loop 重评）后立刻 best-effort 上报，让 initiative_runs.evaluate_verdict 有结构化值（cecelia#3754 起 PATCH 接住该字段；非法值 Brain 只 warn 不 400，绝不阻塞。此前该列全 NULL=裁决只活在台账文本里，机器不可读）：

```bash
curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" \
  -d '{"phase":"evaluate","evaluate_verdict":"<PASS|FAIL|FIXED>"}' || true
```

- verdict 原样发（FIXED 不用自己归一，Brain/gates 侧做归一）；写侧 COALESCE=提供即覆盖，fix loop 多轮以最后一次为准
- 前台手跑无 initiative_run 行时 404 照旧 `|| true` 吞掉（同进度上报语义）

## Step 5: Judge（独立裁判，硬门禁）

- 派发前后按「横切纪律 B」自报 node=judge。
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

- **judge_verdict 上报（硬性动作，EVA v2，与 Step 4 evaluate_verdict 对称）**——拿到 VERDICT 后立刻 best-effort 上报（DB 实证：judge_verdict 30 条仅 2 非空，病根就是此处从未上报，裁决只活在台账文本里）：

```bash
curl -s -m 10 -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"judge_verdict\":\"$VERDICT\"}" || true
```

- agent_verdict 缺省时 API 自读 `<worktree>/.brain-result.json`；可选字段：agent_verdict / agent_feedback / prompt_dir / transcript_file
- 兜底（仅 cecelia 本机直跑且 Brain API 不可达时）：`node scripts/harness-judge-cli.mjs --task-id <id> --sprint-dir <dir> --pr <url>`（CLI 保留不删，但第三方 repo 容器内不得作为主路径）
- judge FAIL → 带 feedback 回 Step 3（打回重写）；judge PASS → 台账 append（锚 sha）→ Step 6
- **禁止**：跳过 judge / 替 judge 降级 / 在 judge 前 merge

## Step 6: Review 门（仅 review_required=true）+ Merge

- merge 动作前后按「横切纪律 B」自报 node=merge。
- review_required → 起预览环境 + Bark 通知主理人（附 approve 命令），阻塞等 task_events 批准事件
- **毕业（测试入册）——judge PASS 后、SHA 锚定与 merge 前的机械步（v2.7）**。为什么插在这里：evaluator B-1 已把 e2e-verify.sh 固化进 sprint 目录（这是该脚本内容定稿的唯一时点），merge 之后没有任何阶段再碰这条 PR——所以「e2e-verify.sh 之后、merge 之前」是毕业的唯一时点；且 cecelia 已上线 test-pyramid-guard 孤儿棘轮锁 0，sprints/ 下留测试的 PR 会被 CI 直接拦红，不毕业就合不进去：

```bash
# 条件：仓库存在毕业脚本才执行（无则跳过——该 repo 未启用金字塔守卫，如 zenithjoy-workspace）
if [ -f scripts/graduate-sprint-tests.mjs ]; then
  # 搬运 sprints/<sprint>/tests/ → tests/regression/<slug>/、e2e-verify.sh → scripts/smoke/e2e/<slug>.sh（纯 rename）
  # --update-refs：同步重写根 DoD.md 里的旧路径引用，防毕业 commit 被 dod-behavior-dynamic 拦死（#3870 实证，cecelia #3874 起支持）
  node scripts/graduate-sprint-tests.mjs --sprint "$SPRINT_DIR" --update-refs
  git add -A && git commit -m "chore(quality): 毕业 sprint 测试入册永久池（纯 rename）"
  git push
  # 毕业 commit 会重触 CI——照 Step 3「CI 阻塞等待」同款 ci-poll 循环等到全绿，再继续下面的 SHA 锚定/merge
else
  echo "[毕业] 本 repo 无 scripts/graduate-sprint-tests.mjs，跳过（未启用金字塔守卫）"
fi
```

- **merge 前 SHA 锚定硬检查（确定性 bash，c66bbedc 实证：锚定后又进代码 commit、未重评直接 merge）**——"新 commit 旧 verdict 作废"不只写在 Step 4，merge 这里必须机械复核：

```bash
[ "$(gh pr view <pr> --json headRefOid -q .headRefOid)" = "$ANCHORED_SHA" ] || 回 Step 4 重评
```

  不相等 → **禁止 merge**，回 Step 4 以当前 head 重评（evaluator + judge 都要），台账 append 重评行后才可回到本步。**豁免（v2.7，与下面 update-branch 豁免对称）：head 变化仅由本步「毕业 commit」造成时**——用 `git diff --stat HEAD~1` 证明该 commit 是纯 rename 零内容变更（全部行形如 `old => new`，insertions/deletions 均为 0）——允许以毕业后的 head 直接 re-anchor，不触发 Step 4 全量重评，台账记 re-anchor 行（注明 graduation）
- merge（唯一权威路径）：evaluator PASS + judge PASS（+ 人工批准如需）→ `gh pr merge --squash --delete-branch`
  - BEHIND → `gh pr update-branch` ≤3 次；**update 改变 head sha → evaluator/judge verdict 以新 sha 重锚**（轻量 rebase 不重评，台账记 re-anchor 行）
  - CONFLICTING → 终局 FAIL 上报
- **派生 staging_e2e（merge 确认后，best-effort，绝不阻塞）**：无论是本 session 自己 `gh pr merge` 成功、还是发现 PR 已被外部合并（`gh pr view` 直接是 MERGED），只要确认 MERGED 就派生一次——这是当前 staging→production 放行层唯一的任务产生入口，漏派会让这条 PR 永远进不了 staging E2E：

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

调用 Skill(harness-report)（Phase A/B 不变：回写 Brain task 状态 → Dashboard → Notion → 飞书 → 本地备份 → Sprint 状态同步）。派发前后按「横切纪律 B」自报 node=report。合同含 `## 未覆盖真实链路清单`（非 N/A）→ 把该清单原样转呈进最终报告与通知正文（规则C配套，禁止静默吞掉 mock 豁免）。

**追加硬性动作——回写 initiative_runs 终态**（否则 Brain 巡逻把 run 误判为 Stuck at Planner 并派干预任务，N4 实证）：

```bash
curl -s -X PATCH "$BRAIN/api/brain/orchestrator/relay-runs/${HARNESS_INITIATIVE_ID}" \
  -H "Content-Type: application/json" \
  -d '{"phase":"done","verdict":"PASS","cost":<总成本USD数字>,"pr_url":"<pr_url>"}'
  # 终局失败改 {"phase":"failed","failure_reason":"<一句话>","verdict":"FAIL","cost":<总成本>,"pr_url":"<有PR则填>"}
```

**PATCH body 三个字段是硬性要求，不许只 PATCH phase**（#3540 为此加的字段，1.2.1 及以前只写 phase → dashboard verdict 全空、cost 全 0）：`verdict` = 最终裁决（PASS/FAIL）、`cost` = 成本字段（见下）、`pr_url` = PR 链接（从台账/`gh pr view --json url` 取）。

**cost 字段的诚实边界（EVA v2）**：cost 字段仍带，但 controller **无法可靠获得 subagent 真实成本**（30 条实证 29 条恒 0）——有真实数据（如 subagent 报告尾部自带 cost_usd）才填真实值，否则填 0 并在台账注明 `cost=unsettled`；Brain 侧从 session 用量结算才是正解（已立案），不要为凑数字编造成本。`evaluate_verdict` 已在 Step 4 出裁决时上报过，此处不必重发（要重发也无害，COALESCE 覆盖）。

台账 append `report: done (verdict=<v>, learnings_inserted=<N>, concerns=<无|数量>)`——**禁裸 `report: done` 行（EVA v2）**：verdict/learnings_inserted 从 harness-report 报告取，concerns 无则写"无"（a85e0582 实证裸行无从审计 report 真实产出）。确认 PR 状态 = MERGED（硬约束 6），输出最终摘要。

**收尾最后一步——自杀式 tmux 关窗**（有头前台派发的 tmux 会话跑完不会自己关窗，全靠控制会话手动 `send-keys /exit`+`kill-session`，07-08/09 T2/T3/T4 三个任务因控制会话没盯到底空转两天没人关；无头 harness dispatch 通常没有 `$TMUX`，走 else 分支直接跳过，无害）：

```bash
if [ -n "$TMUX" ]; then
  SESSION_NAME=$(tmux display-message -p '#S' 2>/dev/null)
  if [ -n "$SESSION_NAME" ]; then
    (sleep 2 && tmux kill-session -t "$SESSION_NAME") >/dev/null 2>&1 &
    disown
    echo "✅ 已安排 2 秒后自杀 tmux 会话: $SESSION_NAME（收尾完成，自动关窗）"
  else
    echo "⚠️ tmux 环境检测到但无法读取会话名，跳过自动关窗（非阻塞）"
  fi
else
  echo "ℹ️ 非 tmux 会话，跳过自动关窗步骤"
fi
```

必须是本 Step 真正最后一个动作，确保上面的最终摘要已经完整输出后再执行——延迟 2 秒 + 后台 + `disown` 就是为了不截断。session 结束。

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
