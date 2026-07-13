# Architecture: Harness Pipeline 编排层去 LangGraph 化（Superpowers 接力化）

> 状态：主理人已 review 通过（2026-07-04），进入拆Task/注册Brain（Mode 2 Phase 4/5）。
> 2026-07-04 增补：Superpowers 6.x（subagent-driven-development v6.0.0 重写版）零件移植清单（§2.5）+ 决策 D6-D10 + 业界对照结论（§六）。
> 来源：2026-07-03/04夜间diagnostic对话（cecelia-harness-debug + systematic-debugging定位4个具体bug并修复#3514/#3515/#3521/#3522后，主理人对整体编排架构提出质疑，逐轮讨论收敛出本方案）。

## 一、为什么要改（不是"LangGraph不好"，是"用错了地方+被Brain自身不稳定拖累"）

### 1.1 现状问题（本次对话实证，非猜测）
- 30天harness_initiative真实成功率 13.5%（17/126），14天10.9%，横盘未改善
- 当晚诊断出的4个具体bug，**全部集中在LangGraph编排层**（`harness-gan.graph.js`账号熔断未接线、`harness-initiative.graph.js` reportNode失败原因截断、`harness-task.graph.js` evaluateContractNode的merged-short-circuit与CI通用auto-merge竞态），Superpowers路径（/dev的bug/小改动路径）当晚同期没有出现同类问题
- 生产Brain容器当晚被"合并触发的auto-version重建"打挂2次（都是"杀死旧容器但没能拉起新的"），全靠人工`brain-deploy.sh`手动救回。因为LangGraph的整条编排图跑在Brain自己的Node进程里，**Brain每次自己的部署/OOM/重启，都直接打断正在跑的harness pipeline**，Postgres checkpoint只是在给这个自身不稳定的问题兜底，不是必须的架构需求
- 现在的harness天生**只能无头跑**——出问题只能靠翻`/Users/administrator/claude-output/cecelia-prompts/*.stdout`、查`callback_queue`、`docker events`做"事后法医"，没法前台围观实时发生了什么（今晚整个诊断过程就是在做这件事的笨办法）

### 1.2 关键洞察（对话逐轮收敛出的结论，逐条有honest的正反论证，非单边结论）

| 洞察 | 结论 |
|---|---|
| LangGraph checkpoint的价值是什么 | 本质是"Brain自己进程内状态"和"git/PR/DB外部真相"两份账本，checkpoint desync正是`harness-initiative-resume-checkpoint-bug.md`记录的"resume三陷阱"（stale claimed_by/deadline_at过期/contract-draft.md丢失）的根因。改成"每一跳都现查外部真相（单一账本）"，结构上不存在"两份账本对不上"这类bug |
| 路由/门禁是不是必须交给LLM判断，才算"去LangGraph化" | **不是**。"接下来该干嘛"是状态的确定性函数（PR merge没/CI绿没/裁判判了什么），不管用不用LangGraph库，都该是纯代码判断，不花LLM token、不会读错。真正花LLM钱的是各节点里干活的agent（proposer/generator/evaluator），这个两种架构下都要花，不是本次改造能省的钱 |
| 硬门禁（裁判没PASS不能merge）要不要跟着一起变灵活 | **不要**。门禁必须留代码层卡死，不管是LangGraph的if还是独立脚本的if，都一样。今晚CI抢merge那个bug（#3521）恰恰证明了"该由代码卡死的事没卡死"是根因，去LangGraph化不能反而把更多判断交给LLM自觉遵守 |
| 并发调度（多个initiative同时跑）是不是这次要丢的东西 | 实测7天15个harness任务、dispatcher大部分时间scanned=0，**现在就是串行用的**，Brain的area-scheduler公平调度能力没被用上，丢了没有实际损失。但"多pipeline之间要不要控制并发数"这件事本身不会消失，需要单独有个薄的调度层负责（见下方2.3） |
| 独立编排进程自己挂了，没有checkpoint兜底，能接受吗 | 能接受，前提是"一次sprint的产出边界"控制住（大体是"一个PR"的量级），挂了大不了这次重来，不是"前功尽弃"级别的损失 |
| 去LangGraph化是不是在"手搓"一个更糙的状态机 | 真实风险存在，但harness的真实状态形状很简单（一条主线 + 2个循环点：GAN轮次、fix轮次），不需要通用图引擎去撑，一个几十行的轻量状态脚本能力接得住，不算"过度手搓" |

### 1.3 唯一站得住的真实代价（对话最后收敛出的诚实清单）
1. **重写风险**：本身就是重写，会长出新的、还没见过的bug，跟对错无关，是任何架构级改造都要承担的成本
2. **不能把状态持久化实现得比现成的LangGraph checkpoint更糙**：新方案要认真设计"状态存哪、怎么保证跟git/PR/DB这份外部真相不脱节"，不能潦草了事

---

## 二、目标架构

### 2.1 总体结构：三层职责分离

```
Brain（薄调度层，只做"资源守门"）
  └─ 决定：现在该不该再开一条harness pipeline（资源/并发上限判断，轻量，可反复问不用记住上次问到哪）
       ↓ 拉起一个独立进程（不活在Brain的Node进程里）
Orchestrator（独立进程，替代原LangGraph图，负责编排一整条sprint）
  └─ 循环：现查外部真相（git分支状态/PR状态/DB任务行）→ 判断当前处于哪个阶段 → 派subagent干活 → 拿结果 → 循环
       ↓ 派发
Subagent（每个阶段一个，互相独立，isolate context）
  ├─ Planner subagent：写PRD
  ├─ GAN-Proposer / GAN-Reviewer subagent：循环直到收敛（复用/dev现有GAN模式，最多N轮）
  ├─ Generator subagent：TDD实现（复用engine-worktree/finishing-a-development-branch）
  ├─ Evaluator subagent：真跑E2E
  └─ Judge subagent：独立裁判复核（复用现有DeepSeek裁判逻辑 harness-judge.js，逻辑不变，只是调用方从LangGraph节点变成orchestrator调用）
```

### 2.2 Orchestrator内部：单一账本 + 硬门禁在代码

- **状态存哪**：不再用Postgres checkpoint序列化graph state。复用`initiative_runs`表增列（migration 312），只记录：`phase`（扩枚举：planning/gan/generate/evaluate，旧枚举 A_planning/A_contract/B_task_loop/C_final_e2e/done/failed 双轨期保留）、`round`（GAN轮次/fix轮次计数）、`pr_url`（仅 v2 语义：一 run 一 PR）、`evaluate_verdict`/`judge_verdict`（CHECK 约束含 FIXED——evaluator 前科）、`orchestrator_version`（v1/v2 双轨 flag，D7）、`orchestrator_heartbeat_at`+`orchestrator_host`+`orchestrator_pid`（D8 心跳，命名避开 292 的 tasks.driver_heartbeat_at 既有机制）——这些都是"从外部真相可以随时重新推导"的字段，不是"必须精确恢复的执行位置快照"。**contract 分支不再另存**：`initiative_contracts.propose_branch` 是唯一存储（经 contract_id 可达），再存一份 = 本次要消灭的双账本（2026-07-04 schema challenger 审查结论）
- **决策日志**：`orchestrator_decision_log` 表（append-only，禁 UPDATE/DELETE trigger 硬约束）：run_id + hop（UNIQUE(run_id,hop)，崩溃重跑不双写）+ observed 观测快照 + derived_phase + gate_verdict + action。对应 DoD F7
- **每一跳的动作**：orchestrator脚本本身是确定性代码（不是LLM决策），伪代码：
  ```
  while not done:
    state = read_ground_truth(git, github_pr, db_row)  # 现查，不信自己的内存
    if state.phase == 'planning': spawn(planner_subagent); continue
    if state.phase == 'gan' and not converged: spawn(proposer_or_reviewer_subagent); continue
    if state.phase == 'generate': spawn(generator_subagent); continue
    if state.phase == 'evaluate':
      agent_verdict = spawn(evaluator_subagent)
      if agent_verdict == 'PASS':
        judge_verdict = spawn(judge_subagent)  # 硬门禁，代码强制调用，不可跳过
        if judge_verdict != 'PASS': state.phase = 'generate'; continue  # 打回重写
      merge_if_gate_passes(state)  # 代码判断，不是LLM判断
    ...
  ```
- **硬门禁**：`merge_if_gate_passes()`是纯代码函数，逻辑照抄现有`harness-initiative.graph.js:1498`附近的`if (s.evaluate_verdict !== 'PASS') { 拒绝自合 }`，只是调用方从LangGraph节点变成orchestrator脚本里的一次函数调用，语义完全不变
- **CI抢merge竞态**：本次改造后，"谁能merge这个PR"这件事的唯一权威变成orchestrator自己的`merge_if_gate_passes()`，不再由CI通用auto-merge job插手——但`.github/workflows/scripts/should-auto-merge.sh`（#3521已修）作为双保险继续保留，防止未来又长出类似的第二条merge通道

### 2.3 Brain侧改动：从"扛执行"退化成"调度决策"

- Brain的tick/dispatcher不再`invoke()`一张LangGraph图，改成：判断当前并发harness数是否低于上限 → 是则拉起一个独立的orchestrator进程（类似现在`docker-executor.js`拉起proposer/generator容器的方式，只是这次拉起的是"整条编排逻辑"这个更大的独立单元）→ 记录一个轻量"正在跑"标记
- 这个调度判断本身很薄、执行很快，Brain重启对它的伤害小（不需要跨小时持久化"调度到哪了"）
- 前台/后台同一套：Brain拉起的是"无人值守版"，人也可以在交互式session里直接跑同一套orchestrator逻辑（"前台围观版"），两者是同一份skill/脚本，只是触发方式不同——这解决了"现在只能无头跑、出问题只能法医式调试"的问题

### 2.4-pre Superpowers SDD 零件移植清单（2026-07-04 增补，来源：obra/superpowers v6.0.0+ subagent-driven-development）

调研结论：superpowers 6.0 把 `subagent-driven-development` 整体重写成了"controller 接力循环 + 支撑机械"，与本方案同构。**不字面运行该 skill（见 D6），移植它的 5 个零件**：

| # | 零件 | 是什么 | 治我们什么 | 优先级 |
|---|---|---|---|---|
| P0-1 | **Progress ledger** | 每 task 评审干净后 append 一行 `Task N: complete (commits <base7>..<head7>, review clean)`；重启后信台账+git log 而非内存，从第一个无记录处续跑 | 直接落地 §2.2"从外部真相重新推导"；解 resume 三陷阱 | P0 |
| P0-2 | **四态出口协议** | subagent 只回 `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`；BLOCKED 分路处置（缺context→补料重派 / 需更强推理→升级模型 / task太大→拆 / plan错→报人）；铁律"绝不让同一模型无变化重试" | 替换现有粗粒度 DONE/FIXED/FAILED；天然接住 OOM/stream disconnect/账号熔断分路（#3520） | P0 |
| P0-3 | **单评审双裁决 + "Cannot verify from diff" 第三态** | reviewer 一次给 spec合规(✅/❌/⚠️) + 质量(带severity) 两个裁决；⚠️ 不阻塞但 orchestrator 必须自己兜底逐条解决；**orchestrator 不得替裁判预判/压低严重度** | ⚠️ 第三态治 evaluator 因断言落在未改文件误判 FAIL→FIXED/FAIL 死循环；"不得替裁判降级"呼应 #3521 | P0 |
| P1-4 | **task-brief / review-package / sdd-workspace 三脚本** | 确定性文件接力工具：task-brief 切单 task 喂 implementer；review-package 生成"commits+stat+`-U10` diff"单文件给 reviewer；**diff 必须用 dispatch 前记录的 BASE，绝不用 `HEAD~1` 或三点 diff**（多 commit 会被静默截断） | orchestrator 上下文恒定小可长跑；修 generator Step 6 现用 `origin/main...HEAD` 的 base 漂移风险。脚本 MIT 可直接拿 | P1 |
| P1-5 | **dispatch 显式声明模型** | 每次派 subagent 必须写明模型档位；机械活→便宜档、集成/判断→标准档、最终整分支评审→最强档；判据"turn count beats token price"（便宜模型多花2-3×轮次反而更贵） | 模型选择从硬编码在图里改为 dispatch 元数据 | P1 |

已有勿重复移植：TDD两次commit、verification-before-completion、systematic-debugging、requesting-code-review、CONTRACT IS LAW、pre-merge gate、独立judge——均已融在 generator/evaluator skill 内。

### 2.4 需要退休/改造的文件（本次改造范围，非最终定稿，供下一个session核实）

| 文件 | 现状 | 改造方向 |
|---|---|---|
| `packages/brain/src/workflows/harness-initiative.graph.js` | LangGraph图定义（顶层） | 拆解，routing逻辑保留（照抄成orchestrator脚本的判断函数），graph/Annotation/checkpointer部分退休 |
| `packages/brain/src/workflows/harness-gan.graph.js` | GAN子图 | proposer/reviewer的prompt构建逻辑保留复用，图结构退休，改成orchestrator里的循环 |
| `packages/brain/src/workflows/harness-task.graph.js` | 单task子图（含evaluateContractNode） | evaluator调用+merged-short-circuit逻辑保留（作为orchestrator一跳的实现），图结构退休 |
| `packages/brain/src/harness-judge.js` | 独立裁判 | **原样保留**，只改调用方 |
| `packages/brain/src/docker-executor.js` | 容器执行器 | **原样保留**，continues作为"派subagent干活"的execution primitive |
| `packages/brain/src/harness-watchdog.js` | deadline兜底 | 保留，配合新架构调整字段（不再依赖graph phase枚举，改用简化的phase） |

---

## 三、关键决策（供下一个session参照，避免重新纠结已经讨论过的问题）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 不做"全量LLM自由裁量"的编排，路由/门禁保持代码强制 | 今晚CI抢merge bug就是"该由代码卡死的没卡死"的实例，不能重蹈覆辙 |
| D2 | 不追求跨小时持久化恢复到精确执行位置，只追求"能从外部真相重新推导出大致该干嘛" | 一次sprint产出边界≈一个PR，重来的代价可接受 |
| D3 | 不重建并发调度机制（Brain的area-scheduler公平调度），本次范围内并发数上限判断从简 | 实测现在是串行使用，非当前瓶颈 |
| D4 | "运动员-摄像头-裁判"三权分立架构原则保留，独立裁判逻辑代码原样复用 | 这是主理人此前已拍板的架构原则，跟本次编排层改造正交，不应该被这次重写波及 |
| D5 | 本次不做"前台/后台"两套实现，同一份orchestrator脚本两种触发方式都能跑 | 直接解决"现在只能无头跑、只能事后法医式调试"的痛点，属于额外收益，不是额外成本 |
| D6 | **orchestrator 是纯 node 进程，不是"一个 Claude session 跑 SDD skill"**。superpowers SDD 只移植零件（§2.5），不字面运行——SDD 的 controller 本身是 LLM，与 D1"路由/门禁纯代码"冲突，D1 优先 | 每跳不烧 LLM token、不会漂移；前台围观 = 同一 node 脚本终端跑实时打日志。LLM 只出现在 subagent 里 |
| D7 | **双轨迁移**：任务加 `orchestrator_version` 字段 feature flag，旧 LangGraph 路径保留到对照测试（I2）完成后再执行退休清单（§2.4） | I2 需要旧版可跑作基线；一步切换无回退路径风险太大 |
| D8 | **orchestrator 心跳 + Brain watchdog 重拉**：orchestrator 每跳写心跳 timestamp（DB），Brain watchdog 检测 stale → 直接重拉进程 | 独立进程解决"Brain 重启杀 pipeline"但引入"orchestrator 自己挂了没人管"；状态从外部真相重推所以重拉无害（level-triggered 红利） |
| D9 | **orchestrator 跑在主机，spawn subagent 复用 cecelia-run.sh / docker-executor 原样**（含账号熔断、E2E 环境路由、ssh 逃逸逻辑），熔断状态经 DB 共享 | claude CLI 在主机（#3441 教训）；执行层是修过多轮的存量资产，本次只换编排层，不动执行层 |
| D10 | **本 initiative 全程手动 /dev（harness_mode:false）在本机跑，不用现有 harness pipeline 自建** | 鸡生蛋：13.5% 成功率的流水线重建它自己大概率死循环；且死规则"Brain 核心/架构必须本机 /dev" |

---

## 四、测试策略

- Orchestrator的路由/门禁逻辑是纯代码，**必须单元测试**（照抄现有`harness-initiative.graph.js`/`harness-gan.graph.js`/`harness-task.graph.js`已有测试的断言，验证同样的路由决策在新实现下行为不变）
- 独立进程的"状态从外部真相重新推导"能力，需要至少一个集成测试：模拟"orchestrator中途被kill，重新拉起后能正确判断当前该干嘛"的场景（对应原来checkpoint resume测试覆盖的场景，但测的是新机制）
- 至少一次真实End-to-end sprint对照跑（2026-07-04 修订统计口径）：**新版跑 3 次记成功率/耗时/是否需人工排查；旧版不再真跑，用 30 天历史数据（126 次、13.5%）作基线**——旧版单次跑大概率失败，"各跑一次"得不出结论且浪费钱
- 确定性纪律：orchestrator 路由代码内禁用 `Date.now()`/`Math.random()` 等非确定性调用，时间戳/随机数从外部注入（否则"从外部真相重放推导"会漂移）
- **DB 迁移提醒**：ledger/心跳字段的 migration 生产要跑 hk-vps + mmv 两台（各自独立 postgres），别漏

---

## 五、暂缓事项（本次不做，需要另外决策）

- ~~具体的Task拆分 + Brain注册（Mode 2 Phase 4/5）~~：主理人 2026-07-04 已 review 通过，Phase 4/5 启动
- Brain侧area-scheduler公平调度机制是否需要重建：留到真实出现并发需求时再做（D3）
- watchdog_overdue（17%失败占比）是否需要针对新架构重新设计：待新架构跑出真实数据后再判断

## 六、业界对照（2026-07-04 调研结论，防下个session重新怀疑方向）

- "每一跳现查外部真相"在基础设施领域是十年验证的成熟范式，即 K8s 的 **edge-triggered notification + level-triggered logic**（事件只负责唤醒，reconcile 逻辑永远重读 ground truth）。收益：漏事件下一轮自愈、重复事件无害、崩溃后无需专门恢复代码。设计对话用词直接采用 reconcile loop / desired-state(spec) vs status 分离
- 三真相源可能互相矛盾（PR 已 merge 但 DB 还是 running）：**PRD/contract = spec（只读意图），git/PR 实测 = status（永远以实际观测覆写），DB 行只是缓存视图不是真相**
- **不引入 Temporal/Restate/DBOS**：durable execution 解决的是"journal 每步、崩溃后 replay 恢复内存态"，而本方案不持有需要恢复的内存态。用 Temporal 替 LangGraph 是横向平移问题，reconcile loop 是取消问题
- 参照系：Anthropic Claude Code Workflows（控制流即代码/journaling-resume/禁非确定性调用）、Open SWE（独立 Reviewer 过了才开 PR + 外部 ID 锚定工作单元 + safety-net 兜底防绕过门禁）、OpenHands（event-sourced 状态）。没有 turnkey 库为"AI dev pipeline"打包这套——正解是借范式+自写轻量 reconcile 脚本
- 唯一值得补的增强：三真相源之上加一层 **append-only 决策日志**（记"第N跳观测到什么、门禁判了什么、派了谁"），不为恢复态，为可审计+debug（治"我以为X结果Y"定位难题），实现成本 = 往一张表 append
