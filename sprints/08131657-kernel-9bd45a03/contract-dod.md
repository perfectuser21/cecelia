---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: 真身 Session Controller（每条 kernel run 一个常驻监护进程）

**范围**: Controller 真身守护进程（spawn/ownership/lease 续租）+ 监护循环（Kernel 存活 + fatal 分流 resume/结构化终止）+ human_review 期 push 冻结/解冻 + 终局 task.result 回写与退出。**不含**：Controller 执行阶段工作、改 Kernel 状态机权威、重写 orphan-guard 判据、LLM-session 化。
**大小**: L

> DB 说明：以下 [BEHAVIOR] 由 evaluator 在 target_environment=local_api 执行，`$DB_URL` 为 Fleet 注入的 attempt 级空库；driver（`packages/brain/scripts/controller-e2e-driver.mjs`）从 `DB_URL` 自建 Pool 并幂等 migrate 后驱动真身 Controller（真子进程 + 真 PG + 真 git），打印 JSON 报告并以 exit code 收敛。

## ARTIFACT 条目

- [ ] [ARTIFACT] Controller 守护进程入口新建
  Test: node -e "require('fs').accessSync('packages/brain/src/orchestrator/kernel-controller-daemon.js')"
  期望: exit 0

- [ ] [ARTIFACT] lifecycle 新增分流/续租/终局/never_started 导出
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-controller-lifecycle.js','utf8');for(const s of ['classifyControllerRecovery','isPushFrozenForRun','renewControllerLease','finalizeControllerTaskResult','CONTROLLER_NEVER_STARTED_REASON_PREFIX'])if(!c.includes(s))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] E2E driver 脚本存在且含全部 scenario 子命令
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/controller-e2e-driver.mjs','utf8');for(const s of ['scenario-ownership-lease','scenario-kill-kernel-recoverable','scenario-kill-kernel-terminate','scenario-human-review-freeze','scenario-finalize','scenario-kill-controller'])if(!c.includes(s))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] relay `_spawnKernelRuntime` 改为先 spawn Controller 守护进程再拉起 Kernel（不再裸 randomUUID 无进程记账）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!c.includes('kernel-controller-daemon'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `.harness/` 台账入 .gitignore（INV-1 台账不入库）
  Test: bash -c 'git check-ignore .harness/progress.md >/dev/null && echo OK'
  期望: OK

- [ ] [ARTIFACT] 新增 PG 集成测试登记进 vitest.config.js（永久回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('kernel-controller-daemon.pg.integration.test.js'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，evaluator 直接跑）

- [ ] [BEHAVIOR] [L2] B-01: createKernelRun 后真身 Controller 存活且取得 ownership（GP Step1）
  动作: 空库 migrate 后经 driver spawn 真身 Controller 守护进程（child_process detach），Controller 写 controller_session_id=自身真实身份后拉起 Kernel
  预期观察: within 20s，initiative_runs.controller_session_id 非空且绑定存活进程，Controller pid kill -0 可达
  等待预算: 20s
  留证: driver JSON 输出（ownership_ok/controller_pid/controller_session_id）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-ownership-lease | tee /dev/stderr | grep -q "\"ownership_ok\":true"'

- [ ] [BEHAVIOR] [L2] B-02: Controller 周期续租 lease 跨 ≥2 续租周期（GP Step2）[接缝×2]
  动作: 观测 controller_lease_expires_at 连续采样三次（注入小续租周期 CONTROLLER_LEASE_RENEW_INTERVAL_MS）
  预期观察: within 15s，controller_lease_expires_at 出现 ≥2 次严格递增
  等待预算: 15s
  留证: driver JSON 输出 lease_renewals 计数 + 三次 lease 时间戳
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-ownership-lease | tee /dev/stderr | grep -q "\"lease_renewals\":[2-9]"'

- [ ] [BEHAVIOR] [L2] B-03a: kill -9 Kernel（可恢复类）→ Controller resume，run 有主不无主（GP Step3）[接缝×2]
  动作: 读 orchestrator_pid，kill -9 Kernel 子进程（failure_class=可恢复）
  预期观察: within 30s，Controller 重启 Kernel resume，出现新的 orchestrator_pid，run 仍活跃且 controller_session_id 非空
  等待预算: 30s
  留证: driver JSON（resumed=true + 旧/新 orchestrator_pid）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-kill-kernel-recoverable | tee /dev/stderr | grep -q "\"resumed\":true"'

- [ ] [BEHAVIOR] [L2] B-03b: kill -9 Kernel（不可恢复类）→ 结构化终止且不无主（GP Step3）[接缝×2]
  动作: 读 orchestrator_pid，kill -9 Kernel 子进程（failure_class=assembly_fault/合同失效）
  预期观察: within 30s，run.phase=failed 且 failure_reason 以 kernel_process_fatal: 开头，controller_session_id 仍非空（不进无主态）
  等待预算: 30s
  留证: driver JSON（structured_terminate=true + failure_reason + controller_session_id 非空）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-kill-kernel-terminate | tee /dev/stderr | grep -q "\"structured_terminate\":true"'

- [ ] [BEHAVIOR] [L2] B-04: kill -9 Controller → lease 过期 → orphan-guard 兜底 fail-closed（GP Step6 边界/回归）
  动作: kill -9 Controller 进程后触发既有 reconcileOwnerlessKernelRuns
  预期观察: within 30s，run 被判无主 → phase=failed 且 failure_reason 以 ownerless_kernel_run_recovered: 开头（现有回归不回退）
  等待预算: 30s
  留证: driver JSON（orphan_recovered=true + failure_reason）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-kill-controller | tee /dev/stderr | grep -q "\"orphan_recovered\":true"'

- [ ] [BEHAVIOR] [L2] B-05: human_review 期 push 冻结判据 true→裁决后 false，真 git push 验拒止/恢复（GP Step4）[接缝×2]
  动作: 置真 run 为 awaiting_human_review，向 PR 分支真 git push；人审裁决后再 push
  预期观察: 冻结期 isPushFrozenForRun=true 且 push 被拒/回滚；裁决后 =false 且 push 成功
  等待预算: 20s
  留证: driver JSON（freeze_ok=true + 冻结期 push 拒止退出码 + 解冻后成功）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-human-review-freeze | tee /dev/stderr | grep -q "\"freeze_ok\":true"'

- [ ] [BEHAVIOR] [L2] B-06: 守到 PR merged → 回写 task.result(pr_url+merged+summary) 后 Controller 退出（GP Step5）
  动作: driver 驱动 run 至 merged 终局，等待 Controller 回写 task.result 后进程退出
  预期观察: within 30s，tasks.result 含 pr_url 且 (result->>'merged')::boolean=true，Controller pid 已退出（禁无声消失）
  等待预算: 30s
  留证: driver JSON（result_written=true + task_id）+ psql 回读 result
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-finalize | tee /dev/stderr | grep -q "\"result_written\":true"'

- [ ] [BEHAVIOR] [L2] INV-2 [never_started 兜底]: Controller 从未启动 → never_started 分类，不覆盖已有 error_message/failure_reason
  动作: 构造从未成功启动 Controller 的 run（预置 error_message），触发兜底
  预期观察: failure_reason 以 controller_never_started: 开头，且既有 error_message/failure_reason 不被覆盖
  等待预算: 10s
  留证: driver JSON（never_started=true + 既有字段保持）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-never-started | tee /dev/stderr | grep -q "\"never_started_preserved\":true"'

- [ ] [BEHAVIOR] [L2] INV-3 [会话独享路径]: Controller 台账/临时句柄路径含 runId，非共享 /tmp 固定名
  动作: spawn Controller 后检查其台账/句柄文件路径
  预期观察: 路径含该 run 的 runId（会话独享），无共享固定文件名互踩
  等待预算: 20s
  留证: driver JSON（session_scoped_path=true + 实际路径含 runId）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-ownership-lease | tee /dev/stderr | grep -q "\"session_scoped_path\":true"'

- [ ] [BEHAVIOR] [L2] INV-4 [PR CONFLICTING]: CONFLICTING（CI 静默）时监护循环短路不空等
  动作: 置 run 关联 PR 为 CONFLICTING，运行监护循环一轮
  预期观察: within 15s，监护循环短路（不按 CI 卡死空等），走人审/收敛路径
  等待预算: 15s
  留证: driver JSON（conflicting_short_circuit=true）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-pr-conflicting | tee /dev/stderr | grep -q "\"conflicting_short_circuit\":true"'

- [ ] [BEHAVIOR] [L2] INV-5 [phase-event] N/A：Controller 只监护不执行，phase-event 仍由 Kernel 派发链调用；断言 Controller 代码不拦截/不改该端点调用
  动作: 静态核验 Controller 守护进程代码未拦截/改写 phase-event 记账链
  预期观察: kernel-controller-daemon.js 不出现对 phase-event 的拦截/短路（Controller 不执行阶段）
  等待预算: 0s
  留证: grep 输出（无拦截）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/orchestrator/kernel-controller-daemon.js\",\"utf8\");process.exit(/phase-event/.test(c)&&/(intercept|block|skip).{0,30}phase-event/i.test(c)?1:0)" && echo OK'

## 已知约束回归（不得回退）

- [ ] [BEHAVIOR] [L2] 既有 kernel-controller-lifecycle 集成回归全绿（Kernel fatal 隔离 + 无主 fail-closed + 脱敏 + 健康 run 不误伤）
  动作: 运行既有 lifecycle 集成测试（brain-integration job / driver 复用同底层函数）
  预期观察: 既有 4 个 it 全过，健康 owned run 不被 reconciler 误收
  等待预算: 60s
  留证: driver JSON（regression_green=true）
  Test: manual:bash -c 'node packages/brain/scripts/controller-e2e-driver.mjs scenario-regression-green | tee /dev/stderr | grep -q "\"regression_green\":true"'
