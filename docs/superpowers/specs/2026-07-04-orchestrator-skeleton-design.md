# Spec：orchestrator 骨架（T2：reconcile loop + 路由/门禁纯函数 + 单测）

> Initiative: harness-orchestration-redesign。Brain task: 4998c357。
> 依据：architecture.md §2.1-2.3 + routing-extraction.md（三张图路由语义提取）+ migration 312（已合并）。

## 目标

独立于 Brain 容器生命周期的 node 进程（D6：纯代码，非 LLM session），实现 reconcile loop：每跳现查外部真相 → 纯函数推导 phase/下一动作 → 经注入的 dispatcher 派 subagent → 写决策日志+心跳 → 循环。本任务只做骨架与纯函数层；真实 dispatcher 是 T3，Brain 拉起是 T4。

## 关键设计决策（本 spec 新增，对齐 D1-D10）

1. **单 sub-task 化**：现行"1 Sprint = 1 Generator = 1 PR"（task-plan 恒只有 ws1），新 orchestrator 按单任务主线建模（planning→gan→generate→evaluate→done/failed + 2 循环点），**刻意不迁移**父图的 pick_sub_task/advance 多任务串行循环（Serial merge gate 的"PR 真 merged 才算完"语义保留进 mergeGate/derive）
2. **计数不进内存**：gan_round / fix_round / requeue 等"纯 checkpoint 运行态"改为从决策日志推导——`COUNT(action) FROM orchestrator_decision_log WHERE run_id=X`。崩溃重拉后计数天然正确（UNIQUE(run_id,hop) 保证不双写）
3. **verdict 落 312 列**：evaluate_verdict/judge_verdict 写 initiative_runs（migration 312），不再只活在 graph state
4. **GAN feedback 文件接力**：上轮 reviewer feedback 落 propose 分支文件（现行为已如此），orchestrator 不在内存传递
5. **plannerOutput 不持久化**：sprint-prd.md 落盘即真相；崩溃丢失则重跑 planner（D2：一次 spawn 的代价可接受）
6. **确定性纪律**：derive/gates 纯函数禁 Date.now()/Math.random()；时钟/随机从参数注入（业界对照结论）
7. **等待原语 = 轮询**：不用 LangGraph interrupt/resume。spawn detached 后轮询（docker inspect / callback 文件 / gh pr）。harness-thread-lookup 的 callback→resume 机制被轮询替代（N3 影响面已知）
8. **selfcheck bump 312 在本任务**（T1 决策修正的承诺：首个依赖 312 列的代码负责 bump）

## 模块布局 `packages/brain/src/orchestrator/`

| 文件 | 职责 | 纯度 |
|---|---|---|
| `derive.js` | (observed) → {phase, action, reason}——routing-extraction.md 决策表的等价纯函数 | 纯（可单测全分支） |
| `gates.js` | mergeGate（evaluate PASS + judge PASS + review 门）/ serialMergedCheck（PR 真 merged）/ fix、requeue、poll 上限判断 | 纯 |
| `counters.js` | 从决策日志行数组推导 gan_round/fix_round/no_push_streak 等（输入是行数组，纯函数；查询在 ground-truth） | 纯 |
| `ground-truth.js` | 观测采集：DB run 行+decision_log 行（pg）、PR 状态（gh）、git 分支/文件存在性——全部现查不缓存 | IO（薄） |
| `decision-log.js` | appendHop(runId,hop,observed,derived_phase,gate_verdict,action,detail)——append-only | IO（薄） |
| `heartbeat.js` | 每跳 UPDATE initiative_runs SET orchestrator_heartbeat_at=NOW(),host,pid | IO（薄） |
| `loop.js` | while 循环：ground-truth→derive→gates→dispatch(注入)→log+heartbeat；terminal phase 退出 | 编排（依赖注入可测） |
| `run.js` | CLI 入口 `node run.js --task-id X [--dry-run]`；--dry-run 只观测+推导+打印不派发（F5 前台围观的雏形） | 入口 |

**dispatcher 接口（T3 实现，T2 只定义 + fake）**：`dispatch(action, ctx) → Promise<{status: 'DONE'|'DONE_WITH_CONCERNS'|'NEEDS_CONTEXT'|'BLOCKED', detail}>`（四态协议，F8 的接口面在此定义，处置分支实现归 T3）

## phase 推导语义（derive.js 核心，对齐提取表）

```
observed = {run行, contracts行, prd文件存在?, pr:{url,state,ci,merged?}, decisionLog行, task行}
if run.phase ∈ {done,failed} → terminal
if !prd存在 → phase=planning, action=spawn:planner
if prd存在 && contract未approved →
    phase=gan
    // reviewerRouter 语义：verdict APPROVED→出环（contract approved 落库）；否则 proposer/reviewer 交替
    action = 上一跳是 proposer 完成 ? spawn:reviewer : spawn:proposer
    守护：budgetCap / noPushStreak(2) / noVerdictStreak(3) → failed（照抄 gan.graph 语义）
if contract approved && (!pr || ci fail/pending) →
    phase=generate
    !pr → action=spawn:generator
    ci pending → action=wait:poll_ci（含 poll 上限 20×90s→timeout 语义）
    ci fail → fix_round<20 ? action=spawn:generator-fix : failed（routeAfterFix 语义）
    ci_fail_type ∈ {container_exit,auth_failed} → 直接 fix（routeAfterCallback 语义）
if pr && ci pass && evaluate_verdict!=='PASS' →
    phase=evaluate, action=spawn:evaluator（含 ARTIFACT 门/Contract Gate 前置）
    verdict FIXED 按 PASS 归一（前科语义）；failure_class==='contract_invalid' → failed（不进 fix loop）
    evaluate PASS → action=spawn:judge（硬门禁，代码强制）
    judge FAIL → 回 generate（打回重写）
if evaluate PASS && judge PASS && review_required → phase=evaluate, action=wait:human_review
if 全门过 && !merged → action=merge_pr（mergeGate 纯函数放行；BEHIND→update-branch≤3/CONFLICTING→failed/ALREADY_MERGED 幂等——照抄 mergePrNode）
if merged → action=report → phase=done
```

已 merged 短路（routeAfterPoll 'merged'→merge 语义）：任何时刻观测到 PR 已 merged → 跳过所有 spawn 直接进 report 路径，但 **merge 动作本身永远只由 mergeGate 放行**（should-auto-merge.sh 双保险仍在，F6）。

## 测试策略

档位：**unit（纯函数全分支）+ 轻集成（loop 用 fake dispatcher/ground-truth）**。

1. `derive.test.js`：routing-extraction.md 每条路由 → 至少一个断言（error 短路/GAN 交替与出环/pending 回环/fail→fix/超上限→failed/contract_invalid→failed/FIXED 归一/merged 短路/BEHIND/review 门）——对照现有三张图测试的断言语义
2. `gates.test.js`：mergeGate 全分支（evaluate 非 PASS 拒/judge 非 PASS 拒/双 PASS 放行/review_required 未批拒）；serialMergedCheck（status 缺失+PR 实 merged→纠正放行；无终败证据 requeue<2→重跑；超 cap→terminal）
3. `counters.test.js`：从 decision_log 行数组推导各计数；空数组=0；崩溃重拉场景（同 hop 不重复计）
4. `loop.test.js`：fake dispatcher+ground-truth 走通 planning→…→done 全链；中途 kill（循环中断后用同一 observed 序列重进）→ 从外部真相续跑不重复已完成动作（F4 的单测级版本）；每跳恰好一条决策日志+一次心跳（F7/F9 接口面）
5. 确定性守卫：grep 断言 derive.js/gates.js/counters.js 不含 Date.now/Math.random/new Date(
6. selfcheck bump 312 断言（T1 遗留承诺）

TDD：commit-1 全部 failing tests（Red），commit-2+ 实现（Green）。

## 不做（后续任务）
- 真实 dispatcher（docker/codex/主机执行、账号轮换、四态处置分支）→ T3
- Brain tick 拉起/watchdog 重拉/双轨 flag 接线 → T4
- kill-resume 真进程集成测试 + 前台模式打磨 → T6
- 老三张图退休/executor.js 换驱动 → T7（对照数据后）

## 影响范围
纯新增目录 + selfcheck 一行 bump（293→312，migration 312 已在 main，deploy 顺序 migrate→selfcheck 安全）+ selfcheck.test.js/learnings-vectorize.test.js 两处地板断言同步更新（T1 已探明位置）。不改三张图/executor/routes——零现行为变更。
