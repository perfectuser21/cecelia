# Spec：orchestrator 骨架（T2：reconcile loop + 路由/门禁纯函数 + 单测）v2

> Initiative: harness-orchestration-redesign。Brain task: 4998c357。
> 依据：architecture.md §2.1-2.3 + routing-extraction.md + migration 312。
> v2（2026-07-04）：吸收架构 challenger 对抗审查 12 条（3×P0 + 6×P1 + 4×P2），修订记录见文末。

## 目标

独立于 Brain 容器生命周期的 node 进程（D6：纯代码，非 LLM session），实现 reconcile loop：每跳现查外部真相 → 纯函数推导 phase/下一动作 → 经注入的 dispatcher 派 subagent → 写决策日志+心跳 → 循环。本任务只做骨架与纯函数层；真实 dispatcher 是 T3，Brain 拉起是 T4。

## 关键设计决策

1. **单 sub-task 化**：现行"1 Sprint=1 Generator=1 PR"（task-plan 恒只有 ws1），按单任务主线建模；父图 pick_sub_task/advance 多任务串行循环刻意不迁移（Serial gate 的"PR 真 merged 才算完"语义保留进 gates）
2. **在途观测（P0-1）**：observed 必含 `inflight`——`docker ps/inspect --filter label=cecelia.run_id=<run>`（dispatcher spawn 时必打 label：run_id+hop+role）+ 主机执行 pid 检查。derive 有显式 `wait:running` 分支：有在途容器 → 只写心跳不派发。**杜绝崩溃重拉双 spawn**
3. **verdict 锚定 SHA（P0-2）**：evaluate/judge verdict 的权威 = 决策日志行（action=`verdict:evaluate`/`verdict:judge`，detail={verdict, pr_head_sha}）；initiative_runs 的 verdict 列只是展示缓存。derive 判"需要 evaluate"= 当前 PR head SHA 无 PASS 记录。**judge FAIL → 显式分支：action=spawn:generator-fix**（新 commit 改 SHA，旧 verdict 天然作废，无需 reset 语义——旧图 fixDispatch reset 清单的等价物）。gates 拒绝"stale PASS + 新 commit"
4. **exit/auth 观测（P0-3）**：ground-truth 增两通道——①已退出容器的 ExitCode（docker inspect，配合 label 登记）②账号熔断 DB 状态（markAuthFailure 写的，D9 熔断经 DB 共享）+ callback 结果文件。derive 输入含 `last_agent_exit:{code, auth_failed}`，auth_failed/container_exit → 直接 fix（保留熔断换号分路）
5. **计数从决策日志+外部产物推导**：fix_round = COUNT(action='spawn:generator-fix' 的 intent hop)；gan round 权威 = propose 分支上实际存在的最大 rN（外部真相），COUNT 只作交叉校验（P2）；streak 类（no_push/no_verdict）从日志行的 (action, observed) 序列推导——每 hop 的 observed 快照就含"上一跳产物出现与否"（P1）。崩溃窗口造成的 ≤1 过计偏向安全方向（更早触发上限，不会放松）
6. **hop 协议（P1）**：hop = MAX(hop)+1；**intent-log-before-dispatch**（先 append 再派发）；UNIQUE(run_id,hop) 冲突 = 有并发 orchestrator 实例 → 本进程立即退出（singleton 守卫），交 watchdog；"记了没派"由在途观测兜底（下一跳观测不到容器与产物 → 该 intent 视为未遂，重派为新 hop）
7. **plannerOutput 不持久化**：sprint-prd.md 落盘即真相；丢失重跑 planner（D2）
8. **确定性纪律**：derive/gates/counters 纯函数禁 Date.now()/Math.random()/new Date()；时钟从参数注入
9. **selfcheck bump 312 在本任务**（T1 决策修正的承诺：首个依赖 312 列的代码负责 bump）
10. **GAN feedback 随 propose 分支 push**（P2：重拉可能换主机，本地文件会丢）——接口约定归 T3 dispatcher 实现，T2 在 action 枚举注释里写明
11. **attemptN 恒 0**：单 run 单 attempt（run 级唯一性由 run_id 承担），偏离旧 proposeBranchFor 的 attemptN 语义，声明为刻意简化

## 模块布局 `packages/brain/src/orchestrator/`

| 文件 | 职责 | 纯度 |
|---|---|---|
| `derive.js` | (observed) → {phase, action, reason} | 纯 |
| `gates.js` | mergeGate / staleVerdict 拒绝 / fix、poll、streak、budget、**MAX_HOPS(200)** 上限 | 纯 |
| `counters.js` | 从决策日志行数组 +外部产物快照推导各计数/streak | 纯 |
| `ground-truth.js` | 观测采集：DB（run/contracts/task/decision_log/熔断状态）、gh（PR state/ci/head SHA）、git（分支 rN/文件）、docker（inflight/ExitCode）、callback 文件 | IO 薄 |
| `decision-log.js` | appendHop（intent-before-dispatch；schema：observed 快照必含上跳产物出现性） | IO 薄 |
| `heartbeat.js` | 每跳 UPDATE initiative_runs SET orchestrator_heartbeat_at/host/pid | IO 薄 |
| `loop.js` | ground-truth→derive→gates→dispatch(注入)→log+heartbeat；四态返回最小语义（见下）；terminal 退出 | 编排（DI 可测） |
| `run.js` | CLI `node run.js --task-id X [--dry-run]`；--dry-run 只观测+推导+打印（F5 前台雏形） | 入口 |

**action 枚举（T3 认领清单，防漏项）**：`spawn:planner / spawn:proposer / spawn:reviewer(feedback 随分支 push) / spawn:generator / spawn:generator-fix / spawn:evaluator(前置 ARTIFACT 门+Contract Gate) / spawn:judge / wait:running / wait:poll_ci / wait:human_review(副作用=Bark 通知+spawnReviewPreview+allocatePort，归 T3) / merge_pr(含 BEHIND update-branch≤3/CONFLICTING→failed/ALREADY_MERGED 幂等) / report(六步链 promoteToRegression/buildHandoff/syncOkrInitiativeStatus/_spawnStagingE2eTask/killInitiativeContainers，归 T3)`

**dispatcher 接口**：`dispatch(action, ctx) → Promise<{status:'DONE'|'DONE_WITH_CONCERNS'|'NEEDS_CONTEXT'|'BLOCKED', detail}>`。
**loop 四态最小语义（T2 定义，T3 细化分路）**：DONE/DONE_WITH_CONCERNS → 记 detail 继续；NEEDS_CONTEXT/BLOCKED → 记 detail 不推进，**连续 2 次同态 → failed**（"绝不同模型无变化重试"铁律的骨架版）

## phase/action 推导语义（derive.js，对齐提取表 + 修订）

```
observed = {run行, contracts行, task行, prd存在?, pr:{url,state,ci,merged,head_sha}, decisionLog行,
            inflight:{containers[], host_pids[]}, last_agent_exit:{code,auth_failed}, 熔断状态, propose分支rN}

0. run.phase ∈ {done,failed} OR task.status ∈ {aborted,cancelled} → terminal（P2 修订）
0.5 inflight 非空 → phase 不变, action=wait:running（P0-1）
0.6 counters.hops >= MAX_HOPS(200) → failed reason='hop_cap'（P2）
1. !prd存在 → phase=planning, action=spawn:planner
2. prd存在 && contract 未 approved → phase=gan
   守护：budgetCap / no_push_streak>=2 / no_verdict_streak>=3 → failed（照抄 gan 语义）
   action = 最新 rN 合同存在且无本轮 verdict ? spawn:reviewer : spawn:proposer
   （rN 从 propose 分支现查，非内存；reviewer APPROVED → contract approved 落库出环）
3. contract approved:
   3a. !pr:
       generator 从未派过 → action=spawn:generator
       generator 已退出且无 PR（no_pr）→ 计入 fix_round；<20 → spawn:generator-fix，>=20 → failed（修订：旧图 no_pr 直接终局，新语义=可重试入上限，声明偏离）
   3b. pr && ci pending → action=wait:poll_ci；poll 超限(20×90s) → failed reason='ci_timeout'（修订：旧 timeout→END，新=failed 终局，语义等价声明）
   3c. pr && ci fail → fix_round<20 ? spawn:generator-fix : failed
   3d. last_agent_exit.auth_failed 或 container_exit → 直接 fix 分路（P0-3；熔断状态给 T3 换号）
4. pr && ci pass:
   4a. 当前 head_sha 无 evaluate PASS 记录 → phase=evaluate, action=spawn:evaluator（FIXED 归一为 PASS；failure_class='contract_invalid' → failed 不入 fix loop）
   4b. evaluate PASS(本 sha) && 无 judge 记录(本 sha) → action=spawn:judge（硬门禁，代码强制）
   4c. judge FAIL(本 sha) → phase=generate, action=spawn:generator-fix（P0-2 显式分支）
   4d. evaluate+judge 双 PASS(本 sha) && review_required && 未批准 → action=wait:human_review
   4e. 全门过 && !merged → action=merge_pr（gates.mergeGate 放行；唯一 merge 权威，F6 双保险仍在）
5. merged → action=report → phase=done
merged 短路：任何时刻 pr.merged=true → 跳过所有 spawn 直入 5（routeAfterPoll merged 语义）
```

## 测试策略

unit（纯函数全分支）+ 轻集成（loop 用 fake dispatcher/ground-truth）：

1. `derive.test.js`：上表每条规则+每个守护 ≥1 断言，重点新增：**inflight → wait:running 不重复 spawn**（P0-1）/ **judge FAIL → generator-fix**（P0-2）/ **stale PASS+新 sha → 重新 evaluate**（P0-2）/ auth_failed 分路（P0-3）/ no_pr 入 fix 上限 / timeout→failed / aborted→terminal / merged 短路 / GAN 交替与守护
2. `gates.test.js`：mergeGate 全分支（evaluate 非 PASS 拒/judge 非 PASS 拒/**sha 不匹配拒**/review 未批拒/双 PASS 放行）/ MAX_HOPS / 各上限
3. `counters.test.js`：fix_round=COUNT(intent)；gan round 以分支 rN 为权威、COUNT 交叉校验不一致时取分支；streak 从 (action,observed) 序列推导（清零语义：产物出现即断）；空日志=0
4. `loop.test.js`：fake 走通 planning→done 全链；**崩溃在 log 与 dispatch 之间**（intent 有记录无容器无产物 → 重派新 hop）；四态返回控制流（BLOCKED×2→failed）；每跳恰一条日志+一次心跳；UNIQUE 冲突→进程退出（singleton）
5. 确定性守卫测试：断言 derive.js/gates.js/counters.js 源码不含 Date.now/Math.random/new Date(
6. selfcheck '312' 断言 + T1 两处地板断言同步更新

TDD：commit-1 全 failing tests（Red），commit-2+ 实现（Green）。

## 不做（归属声明，challenger P1 补全）
- 真实 dispatcher 的全部 action 实现（docker/codex/主机执行、账号轮换换号、ARTIFACT 门执行、review 预览+Bark、merge 执行、report 六步链、staging_e2e 派生、feedback 随分支 push）→ **T3**
- Brain tick 拉起/watchdog stale 心跳重拉（**重拉换主机时 GAN 本地文件约束见决策 10**）/双轨 flag 接线 → **T4**
- 真进程 kill-resume 集成测试 + 前台模式打磨 → **T6**
- 三张图退休/executor.js:2889 换驱动/harness-thread-lookup 与两个 interrupt routes 的替代 → **T7**（对照数据后）

## 影响范围
纯新增目录 + selfcheck 一行（293→312）+ 两处地板断言更新。不改三张图/executor/routes——零现行为变更。

## v2 修订记录（challenger 12 条全吸收）
P0-1 在途观测+wait:running+label 登记 / P0-2 verdict SHA 锚定+judge FAIL 分支+stale 拒绝 / P0-3 exit/auth 观测通道 / P1 timeout·no_pr 语义声明 / P1 streak 从序列推导+observed 契约 / P1 hop 协议+singleton / P1 副作用归属清单 / P1 四态最小语义 / P2 rN 权威+attemptN=0 / P2 MAX_HOPS / P2 aborted / P2 feedback 随分支
