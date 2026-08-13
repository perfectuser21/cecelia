---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 真身 Session Controller（每条 kernel run 一个常驻监护进程）

**范围**: 新增 `packages/brain/src/lib/kernel-controller.js`（真身 Controller：spawn/ownership/续租/监护决策/人审冻结/终局回写）；改 `harness-skill-relay.js:_spawnKernelRuntime`（`randomUUID()`→真身身份）；扩展两份已登记 PG 集成测试；`harness-run-guard.js` / `kernel-controller-lifecycle.js` 无主收割降级为后备、不回退。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 新模块 `packages/brain/src/lib/kernel-controller.js` 导出真身/续租/决策/冻结/终局公共面
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/kernel-controller.js','utf8');for(const s of ['deriveControllerSessionId','renewControllerLease','classifyKernelFailure','decideFatalAction','isHumanReviewPushFrozen','assertControllerPushAllowed','finalizeControllerExit','CONTROLLER_SESSION_PREFIX']){if(!c.includes(s))process.exit(1)}"
  期望: exit 0

- [ ] [ARTIFACT] `harness-skill-relay.js:_spawnKernelRuntime` 用真身身份替换裸 randomUUID 记账
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!c.includes('deriveControllerSessionId'))process.exit(1);if(/controllerSessionId\s*=\s*deps\.controllerSessionId\s*\?\?\s*randomUUID\(\)/.test(c))process.exit(1)"
  期望: exit 0（不再是 `?? randomUUID()` 裸记账）

## BEHAVIOR 条目（内嵌 manual:bash 单行命令，真 PG / 真代码路径，禁 mock 被改边）

- [ ] [BEHAVIOR] [L2] B-01: Controller 续租两周期 lease 单调推进 [接缝×2]
  动作: createKernelRun 建 owned run，用同一 controllerSessionId 连续调 renewControllerLease 两次
  预期观察: 两次续租后 controller_lease_expires_at 严格递增；不匹配 session_id 续租返回 renewed:false 不推进
  等待预算: 30s
  留证: /tmp/kctl-e2e.log 中 "续租两周期" 用例输出 + psql lease 时刻
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "续租两周期" 2>&1 | tail -20'

- [ ] [BEHAVIOR] [L2] B-02: kernel-v1 直打后 controller_session_id 是真身身份且无无主活跃 run
  动作: 真 spawnSkillRelaySession（只替身最外层 launchKernel/ensureWt）建 kernel-v1 run
  预期观察: controller_session_id 匹配 ^controller: 真身前缀（非裸 UUID）；controller_session_id IS NULL 的活跃 run count=0
  等待预算: 0s
  留证: "真身 identity" 用例输出 + psql 无主 run 计数
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js -t "真身 identity" 2>&1 | tail -20'

- [ ] [BEHAVIOR] [L2] B-03: kill Kernel 进程后 run 不进入无主态（Controller ownership 存活）
  动作: createKernelRun 后对可恢复类 handleKernelProcessFatal，观测 run 归属
  预期观察: Kernel fatal 后 controller_session_id 仍等于原真身身份；无主活跃 run count=0；不静默 done
  等待预算: 15s
  留证: "Kernel fatal 后 run 不进入无主态" 用例输出
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "Kernel fatal 后 run 不进入无主态" 2>&1 | tail -20'

- [ ] [BEHAVIOR] [L3] B-04: kill -9 Controller 后 lease 过期 orphan-guard 兜底收敛 [接缝×2]
  动作: fork 真实子进程作 Controller 身份来源，SIGKILL 真杀，停续租至 lease 过期，跑 reconcileOwnerlessKernelRuns
  预期观察: 无主 run phase=failed + 结构化 ownerless_kernel_run_recovered: 前缀；健康 owned run 不被误伤（现有回归不回退）
  等待预算: 30s
  留证: "orphan-guard 兜底" 用例输出（真 fork 子进程 pid + SIGKILL 记录）
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "orphan-guard 兜底" 2>&1 | tail -20'

- [ ] [BEHAVIOR] [L2] B-05: human_review 期间 push 被冻结、裁决后解冻
  动作: run phase=human_review 时 assertControllerPushAllowed；phase 迁出后再调
  预期观察: 冻结期 reject controller_push_frozen:human_review；裁决后 resolve 放行
  等待预算: 10s
  留证: "human_review push 冻结" 用例输出
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "human_review push 冻结" 2>&1 | tail -20'

- [ ] [BEHAVIOR] [L2] B-06: 终局回写 task.result 含 pr_url+merged 才允许退出
  动作: finalizeControllerExit 写 tasks.result；回写失败断言抛结构化错误
  预期观察: tasks.result->>'pr_url' 非空且 (result->>'merged')::bool=true；回写前不退出、回写失败结构化上报（禁无声消失）
  等待预算: 10s
  留证: "终局回写 task.result" 用例输出 + psql jsonb
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --root packages/brain src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "终局回写 task.result" 2>&1 | tail -20'

- [ ] [BEHAVIOR] [L1] B-07: decideFatalAction 可恢复超上限转终止（对齐 orphan_requeue_count 烧到 3）
  动作: 对纯函数 decideFatalAction 喂 recoverable+resumeCount=maxResume 与 unrecoverable
  预期观察: resumeCount 达 maxResume(3) → action=terminate；未达 → resume；unrecoverable 一律 terminate
  等待预算: 0s
  留证: node -e 断言输出 OK
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/lib/kernel-controller.js\").then(m=>{const a=m.decideFatalAction({failureClass:\"recoverable\",resumeCount:3,maxResume:3});const b=m.decideFatalAction({failureClass:\"recoverable\",resumeCount:0,maxResume:3});const c=m.decideFatalAction({failureClass:\"unrecoverable\",resumeCount:0,maxResume:3});if(a.action!==\"terminate\"||b.action!==\"resume\"||c.action!==\"terminate\")process.exit(1);console.log(\"OK\")}).catch(()=>process.exit(1))"'

## Invariant 覆盖条目（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [只监护不执行] kernel-controller.js 不触碰任何阶段执行入口
  动作: 机械 grep 新模块源码是否引用 planner/proposer/generator/evaluator/judge 派发器或 runPhase/executePhase
  预期观察: 命中阶段执行入口 = FAIL；模块公共面仅 spawn/ownership/lease/监护/人审冻结/终局回写
  等待预算: 0s
  留证: node -e grep 输出 OK
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/lib/kernel-controller.js\",\"utf8\");if(/dispatch(Planner|Proposer|Generator|Evaluator|Judge)|runPhase|executePhase/.test(c)){process.exit(1)}console.log(\"OK\")"'

- INV-2 [已有PR验时钟 validation_clock_required fail-closed]：N/A —— 本 sprint 不触及 validation clock 建立逻辑（Controller 只监护、不建 clock、不改 gear/hotfix 判据），validation_clock_required 默认 fail-closed 行为一行不动。

- INV-3 [证据窗口辨析 judge FAIL evidence_insufficient]：N/A —— 本 sprint 不触及 judge 判定路径（Controller 不执行 judge 阶段），evidence_insufficient 与实现缺陷的辨析逻辑不在改动面。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 所有 DB 触达断言走真 PG（POSTGRES_INTEGRATION_TESTS 已登记两文件，brain-integration job 起真 PG）；纯函数断言无外部依赖；真身进程真杀用真 fork 子进程 + SIGKILL，无 force_*/stub/假进程。第三方 API：本 sprint 不涉及。

## contract-gate

contract-gate: active (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在) —— 本仓为 cecelia，代码层确定性 Contract Gate 生效；本合同断言按「Contract Gate 合规惯用法速查表」书写：API 值断言随 pipeline jq -e、DB 计数断言带 5min 时间窗、无 `|| true` 吞错、psql 定点读不需时间窗。
