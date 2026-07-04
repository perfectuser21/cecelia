# 三张 LangGraph 图的路由逻辑提取（T2 依据，2026-07-04 只读调研）

> 提取自 harness-initiative.graph.js(1889行)/harness-gan.graph.js(953行)/harness-task.graph.js(1684行)。
> 用途：新 orchestrator 路由纯函数必须逐条对齐这里的语义（DoD F2）。

## 路由决策表（新纯函数的对齐基准）

### Full Initiative Graph
- 通用 error 短路 stateHasError(s) = s.error ? 'error' : 'ok'；prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert 六节点 error→END
- routeFromPickSubTask(:1834)：error→end；idx>=tasks.length→report；否则 run_sub_task
- advance 后：error→**report**（非 END）；ok→pick_sub_task
- advanceTaskIndexNode Serial merge gate(:1729)：
  - record.status!=='merged' 时：①checkPrMerged(pr_url)===true → 纠正 merged+推进+requeue 清零 ②无终败证据(status 缺失或 queued)且 requeue<CAP(2) → 不推进+requeue++ ③否则 error{terminal}
  - 正常 merged → index+1, fix_count=0, requeue=0

### GAN Contract Graph
- proposerRouter(:828)：error→END；否则 reviewer
- reviewerRouter(:821)：error→END；verdict==='APPROVED'→END；否则回 proposer
- verdict 计算：computeVerdictFromRubric(:221) 7维度全>=7→APPROVED；rubric 权威压过 LLM 文字(:704)；两级降级提取(:714-738)；确定性 Contract Gate 命中硬红线时强制 REVISION(:780-800)
- 无硬轮数上限（刻意，勿加）；硬保护：budgetCapUsd(10)/MAX_NO_PUSH_STREAK(2)/MAX_NO_VERDICT_STREAK(3)/recursion 100

### Task Graph
- routeAfterSpawn(:954)：error→end；否则 await_callback
- routeAfterCallback(:960)：error→end；ci_status==='fail'且 ci_fail_type∈{container_exit,auth_failed}→fix；否则 parse
- routeAfterParse(:971)：error→end；!pr_url→no_pr(END)；否则 verify_generator
- routeAfterPoll(:976)：error→end；merged→merge(短路)；pass→evaluate；fail→fix；timeout→END；pending→回环 poll
- routeAfterEvaluate(:995)：status==='aborted'→end；evaluate_verdict==='PASS'→merge；failure_class==='contract_invalid'→end(责任在GAN,不进fix)；否则 fix
- routeAfterReviewGate(:902)：status==='failed'→end；否则 merge
- routeAfterMergePr(:833)：merged→end；error→end；pending→poll(BEHIND rebase 后)；否则 end
- routeAfterFix(:1634)：error→end(超 MAX_FIX_ROUNDS=20)；否则回 spawn
- fixDispatch 必 reset：fix_round++/generator_output/containerId/spawnedAt/poll_count/ci_status=pending/ci_fail_type/failed_checks/evaluate_verdict/evaluate_error；**不 reset pr_url/pr_branch**（fix 同 PR）

## merge gate 三道
1. Serial merge gate：advanceTaskIndexNode（上）
2. mergePrNode(task:755)：merged 短路/无 pr_url→failed/gh pr merge --squash --delete-branch/ALREADY_MERGED_RE 幂等/CONFLICTING→failed/BEHIND→update-branch(≤3)/前置门=evaluate_verdict PASS + review_gate 人工
3. reportNode 自合(:1492-1514)：**只有 evaluate_verdict==='PASS' 才自合**；最终 verdict = final_e2e_verdict || (全 merged?'PASS':'FAIL')

## 不可重推导的运行态（新架构必须给落点）
- GAN：round/costUsd/noPushStreak/noVerdictStreak/rubricHistory/feedback（上轮 reviewer 产出）
- Task：fix_round/poll_count/ci_status/containerId/evaluate_verdict/failure_class 等
- 父图：task_loop_fix_count/serial_gate_requeue_count/evaluate_verdict
- plannerOutput（LLM 一次性 stdout）——最硬；但 sprint-prd.md 落盘即真相，重跑 planner 代价可接受（D2）
- 新方案落点：计数类 = COUNT(orchestrator_decision_log 对应 action)；verdict 类 = initiative_runs 312 新列；feedback = 文件接力

## 执行原语清单（orchestrator 保留调用，不重写）
ensureHarnessWorktree/resolveGitHubToken/resolveAccount/spawnDockerDetached/spawnCodexBridgeDetached/executeOnHost/checkPrStatus/checkPrMerged/evaluateContractText(Contract Gate)/runJudgeGate/markAuthFailure/writeDriverHeartbeat/killInitiativeContainers/promoteToRegression/buildHandoff/syncOkrInitiativeStatus/_spawnStagingE2eTask/spawnReviewPreview+allocatePort/notifyHarnessReviewPending(Bark)
DB 写：initiative_runs/initiative_contracts/tasks/walking_skeleton_thread_lookup/cecelia_events/task_events

## 退休影响面（N3）
- executor.js:2889 compileHarnessFullGraph（唯一生产入口）
- lib/harness-thread-lookup.js:25,120（容器回调→Command(resume) 路由器——新架构改轮询后此机制被替代）
- routes/harness-interrupts.js:102 + routes/harness-pending-reviews.js:85,120（人工 resume 端点）
- workflows/index.js:12（旧 Phase A 图，低风险清理）+ harness-gan-graph.js shim
- 间接：harness-heartbeat.js（_waitForSubGraphCompletion 刷心跳→watchdog 判活）/staging-e2e-runner/harness-report spawn 链
