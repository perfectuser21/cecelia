---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 真身 Session Controller（每条 kernel run 一个常驻监护进程）

**范围**: Controller 真身进程 spawn + ownership 认领 + lease 心跳续租 + 监护循环（存活/phase/PR-CI）+ failure_class 分流恢复/终止 + human_review 冻结 PR push + 终局 task.result 回写后退出。Controller 只监护不执行任何阶段工作。
**大小**: L
**target_environment**: local_api（真 $DB_URL migrate + node 驱动真实模块 + 真子进程 + psql 断言）

> 每条 [BEHAVIOR] 的 `Test:` 命令驱动 `sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs`（连 `$DB_URL`、导入真实 orchestrator 模块、spawn 真子进程、真 PG 断言），FAIL 传播非 0 exit。等价的永久 CI 回归见 `tests/kernel-controller-runtime.pg.integration.test.js`（brain-integration job 真 PG 跑）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新模块 kernel-controller-runtime.js 导出监护运行时单元
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-controller-runtime.js','utf8');for(const s of ['renewControllerLease','classifyKernelFatal','superviseKernelFatal','guardPushDuringHumanReview','finalizeControllerExit','deriveControllerSessionId'])if(!c.includes(s))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 新 daemon 入口 kernel-controller.js 可被 spawn（含 CLI 参数解析）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-controller.js','utf8');if(!c.includes('--task-id')||!c.includes('--run-id'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] _spawnKernelRuntime 改为先 spawn Controller 真身再拉起 Kernel（controllerSessionId 不再 randomUUID 独占）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!c.includes('spawnKernelController'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] Controller 台账/日志不入 git（INV-3）——sprint 目录不含 .harness/progress.md
  Test: node -e "const{execSync}=require('child_process');const o=execSync('git ls-files sprints/08131657-kernel-9bd45a03/').toString();if(o.includes('.harness/'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，local_api 真 PG + 真子进程）

- [ ] [BEHAVIOR] [L2] B-01: createKernelRun 后存在活 Controller 进程且 controller_session_id 指向真身 [接缝×2]
  动作: 经 spawnKernelController 起一条 kernel run，driver spawn 真 Controller daemon 子进程
  预期观察: within 30s，initiative_runs.controller_session_id 形如 ctrl:<host>:<pid>（非 UUID）且该 pid kill(pid,0) 存活，Kernel orchestrator_pid 非空
  等待预算: 30s（超时=FAIL）
  留证: behavior.mjs B-01 stdout 末 5 行（含 OK: controller alive sid=...）+ psql controller_session_id 查询结果
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-01'

- [ ] [BEHAVIOR] [L2] B-02: lease 被周期续租，观测两个续租周期单调前移 [接缝×2]
  动作: Controller 存活期间以注入的短续租间隔运行，driver 采样 controller_lease_expires_at 三次
  预期观察: within 20s，采到 t1<t2<t3（两次真续租）；用错误 controller_session_id 续租被拒（不串台账）
  等待预算: 20s（超时=FAIL）
  留证: behavior.mjs B-02 stdout（含 OK: lease renewed twice t1<t2<t3）
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-02'

- [ ] [BEHAVIOR] [L2] B-03: kill -9 Kernel（可恢复类）Controller 执行 resume，run 不进入无主态 [接缝×2]
  动作: driver 起 run 后 kill -9 Kernel 进程，failure_class=infrastructure_blocked
  预期观察: within 30s，Controller 检测 pid 消失后重启 Kernel（新 orchestrator_pid），isOwnerlessRun(run)==false 且 phase!='failed'，controller_session_id+lease 仍在
  等待预算: 30s（超时=FAIL）
  留证: behavior.mjs B-03 stdout（含 OK: recoverable resume run-not-ownerless）
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-03'

- [ ] [BEHAVIOR] [L2] B-04: Kernel fatal 不可恢复类 assembly_fault 结构化终止 run failed
  动作: driver 触发 Kernel fatal，failure_class=assembly_fault（不可恢复）
  预期观察: within 15s，phase='failed' 且 failure_reason 前缀 kernel_process_fatal: 且不含凭据明文，controller_session_id 存活可回传
  等待预算: 15s（超时=FAIL）
  留证: behavior.mjs B-04 stdout（含 OK: unrecoverable terminate failure_reason=kernel_process_fatal:assembly_fault）
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-04'

- [ ] [BEHAVIOR] [L2] B-05: kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（回归不回退）[接缝×2]
  动作: driver 起 run 后 kill -9 Controller 使其停止续租，lease 过期后跑 reconcileOwnerlessKernelRuns
  预期观察: within 20s，无主 run phase='failed' 且 failure_reason 前缀 ownerless_kernel_run_recovered:；同批健康 owned run phase 与 controller_session_id 不变
  等待预算: 20s（超时=FAIL）
  留证: behavior.mjs B-05 stdout（含 OK: controller-dead lease-expired orphan-guard-reclaimed）
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-05'

- [ ] [BEHAVIOR] [L2] B-06: human_review 期间向 PR 分支 push 被 Controller 拒止 head 不漂移，裁决后解冻
  动作: driver 把 run 置为 human_review（decision-log action=wait:human_review，PR 未 merge），尝试 push；随后写入人审裁决再尝试 push
  预期观察: 冻结期间 push 尝试 rejected==true 且 tasks.payload->>'pr_head_sha' 前后一致（head 不漂移），payload->>'pr_push_frozen'='true'；裁决后 pr_push_frozen='false' 且 push 放行
  等待预算: 0s（同步观察）
  留证: behavior.mjs B-06 stdout（含 OK: push-frozen-in-review head-unchanged unfrozen-after-verdict）+ psql payload 查询
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-06'

- [ ] [BEHAVIOR] [L2] B-07: PR merged 后 Controller 回写 task.result（pr_url+merged）才退出
  动作: driver 注入 pr.merged=true 事实位，Controller 调 finalizeControllerExit 后退出
  预期观察: within 15s，tasks.result->>'pr_url' 非空且 tasks.result->'merged'=true（result 写在进程退出前落库），Controller pid 随后 kill(pid,0) 为 ESRCH（已退出）；失败终局同样结构化回写不无声消失
  等待预算: 15s（超时=FAIL）
  留证: behavior.mjs B-07 stdout（含 OK: task-result-written pr_url+merged controller-exited）+ psql tasks.result 查询
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs B-07'

- [ ] [BEHAVIOR] [L2] INV-1: 收敛后不存在无主活跃 run 残留（fail-closed 不静默放行）
  动作: B-05 收敛后 driver 统计无主活跃 run 数
  预期观察: 无主活跃残留计数==0（phase NOT IN done/failed 且 controller_session_id IS NULL 或 lease 过期 的行数为 0）
  等待预算: 0s（同步观察）
  留证: behavior.mjs INV-1 stdout（含 OK: no-ownerless-residual count=0）
  Test: manual:bash -c 'node sprints/08131657-kernel-9bd45a03/e2e/behavior.mjs INV-1'

## Invariant 覆盖（铁律逐条）

- INV-1 [无主 fail-closed]：见上方 [BEHAVIOR] INV-1 + B-05。
- INV-2 [never_started 兜底不覆盖已有 error_message/failure_reason]：N/A 直接新写 —— 本 sprint 不改 orphan-guard never_started 分支；finalizeControllerExit/handleKernelProcessFatal 均不覆盖既有非空 failure_reason（由「失败语义声明」+ B-04 controller_session_id 存活断言间接保证，B-05 覆盖 never_started 回归不回退）。
- INV-3 [controller 台账不入 git]：见上方 [ARTIFACT] 第 4 条。
- INV-4 [relay 心跳 phase-event]：N/A —— 本 sprint 为 kernel-v1（非 relay 单 session 模式），不触及 relay phase-event；Controller 存活心跳走 lease 续租（B-02）。
- INV-5 [PR 验证时钟 adoption]：N/A —— 本 sprint 不改 evaluator validation clock（Controller 只监护不执行 evaluator，PRD 范围外）。
