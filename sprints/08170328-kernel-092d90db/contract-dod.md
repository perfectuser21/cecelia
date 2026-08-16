---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: gan_no_push_streak 误判修复（提案 remote 兜底 + 观测门控 + 建单回填）

**范围**: packages/brain/src/orchestrator/{ground-truth.js,derive.js,counters.js,constants.js} + packages/brain/src/work-routing-store.js + 版本四处同步
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] ground-truth.js 导出 resolveProposalRemote 且用 repo 兜底（parseBaseRepo(...repo)）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!/resolveProposalRemote/.test(c)||!/parseBaseRepo\([^)]*repo/.test(c))process.exit(1)"

- [ ] [ARTIFACT] derive.js 含 proposal_remote_unresolved 与 proposal_observation_mismatch 两个独立 reason
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('proposal_remote_unresolved')||!c.includes('proposal_observation_mismatch'))process.exit(1)"

- [ ] [ARTIFACT] constants.js 导出 MAX_OBSERVATION_MISMATCH_STREAK=3
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/constants.js','utf8');if(!/MAX_OBSERVATION_MISMATCH_STREAK\s*=\s*3/.test(c))process.exit(1)"

- [ ] [ARTIFACT] work-routing-store.js createRoutedTask 回填 base_repo（规范 github URL）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/work-routing-store.js','utf8');if(!/base_repo/.test(c)||!/github\.com/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本，[L2] 服务端真验；wait 预算 0s = 同步 vitest）

- [ ] [BEHAVIOR] [L2] B-01: ground-truth 提案 remote base_repo→repo 兜底、禁退 origin、皆空则 unresolved
  动作: 调 resolveProposalRemote({base_repo:null,repo:'cecelia'}) 与 resolveProposalRemote({base_repo:null,repo:null})
  预期观察: 前者 remote 含 https://github.com/perfectuser21/cecelia.git 且不为 origin；后者 unresolved===true 且不出 remote
  等待预算: 0s
  留证: /tmp/dod-b01.log（vitest 输出末 5 行含 passed）
  Test: manual:bash -c 'npx vitest run sprints/08170328-kernel-092d90db/tests/ground-truth-proposal-remote.test.js --reporter=basic 2>&1 | tee /tmp/dod-b01.log | grep -Eq "Test Files.*passed" && ! grep -Eq "Test Files.*failed" /tmp/dod-b01.log'

- [ ] [BEHAVIOR] [L2] B-02: derive gan_no_push_streak 只在 crossCheckMismatch===false 触发；mismatch=true 未满 3 次不判 gan_no_push_streak
  动作: 构造 gan 阶段 observed（noPushStreak>=MAX），分别 crossCheckMismatch=false / true 调 derive
  预期观察: false 分支 reason=gan_no_push_streak；true 分支 reason=proposal_observation_mismatch 且 phase 非 failed（重新观测）
  等待预算: 0s
  留证: /tmp/dod-b02.log
  Test: manual:bash -c 'npx vitest run sprints/08170328-kernel-092d90db/tests/derive-observation-gate.test.js --reporter=basic 2>&1 | tee /tmp/dod-b02.log | grep -Eq "Test Files.*passed" && ! grep -Eq "Test Files.*failed" /tmp/dod-b02.log'

- [ ] [BEHAVIOR] [L2] B-03: derive proposalRemoteUnresolved=true → mark_failed reason=proposal_remote_unresolved（不复用 gan_no_push_streak）；mismatch 连续 3 次 → proposal_observation_mismatch 终局
  动作: 构造 observed.proposalRemoteUnresolved=true 调 derive；构造 observationMismatchStreak=MAX_OBSERVATION_MISMATCH_STREAK 调 derive
  预期观察: 前者 action=mark_failed reason=proposal_remote_unresolved；后者 phase=failed reason=proposal_observation_mismatch；两者均不等于 gan_no_push_streak
  等待预算: 0s
  留证: /tmp/dod-b03.log（同 B-02 文件，含独立 failure_reason 两用例）
  Test: manual:bash -c 'npx vitest run sprints/08170328-kernel-092d90db/tests/derive-observation-gate.test.js --reporter=basic 2>&1 | tee /tmp/dod-b03.log | grep -Eq "Test Files.*passed" && ! grep -Eq "Test Files.*failed" /tmp/dod-b03.log'

- [ ] [BEHAVIOR] [L2] B-04: 建任务口缺 base_repo 回填规范 URL 落库 tasks.payload
  动作: createRoutedTask 传 coding_mutation 请求（repo 解析为 cecelia、不带 base_repo），捕获 INSERT INTO tasks 的 payload 参数
  预期观察: 落库 payload.base_repo === https://github.com/perfectuser21/cecelia.git（短名/别名规范化为完整 .git URL）
  等待预算: 0s
  留证: /tmp/dod-b04.log
  Test: manual:bash -c 'npx vitest run sprints/08170328-kernel-092d90db/tests/work-routing-base-repo-backfill.test.js --reporter=basic 2>&1 | tee /tmp/dod-b04.log | grep -Eq "Test Files.*passed" && ! grep -Eq "Test Files.*failed" /tmp/dod-b04.log'

- [ ] [BEHAVIOR] [L2] B-05: 回归夹具复现 run 7a8e5319——空 base_repo+repo=cecelia+假 ls-remote（URL 返两分支/origin 返空）→ 新代码 proposeBranchRn===1
  动作: 用 run 7a8e5319 短 id 构造提案分支名与 fake execCmd，调 collectGroundTruth
  预期观察: observed.proposeBranchRn===1（旧代码退 origin→0，红）；ls-remote 命令串含 github URL；proposalRemoteUnresolved===false
  等待预算: 0s
  留证: /tmp/dod-b05.log
  Test: manual:bash -c 'npx vitest run sprints/08170328-kernel-092d90db/tests/regression-run-7a8e5319-rn.test.js --reporter=basic 2>&1 | tee /tmp/dod-b05.log | grep -Eq "Test Files.*passed" && ! grep -Eq "Test Files.*failed" /tmp/dod-b05.log'

- [ ] [BEHAVIOR] [L2] B-06: 受影响 brain 模块零回归 + 版本四处同步（含 crossCheckMismatch=false 原 gan_no_push_streak 语义保留）
  动作: 跑 derive/ground-truth/counters/constants 现有单测 + check-version-sync.sh
  预期观察: brain 单测无 failed；check-version-sync.sh 退出码 0（四处版本一致）
  等待预算: 0s
  留证: /tmp/dod-b06.log
  Test: manual:bash -c 'npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js packages/brain/src/orchestrator/__tests__/ground-truth.test.js packages/brain/src/orchestrator/__tests__/counters.test.js packages/brain/src/orchestrator/__tests__/constants.test.js --reporter=basic 2>&1 | tee /tmp/dod-b06.log | grep -Eq "Test Files.*passed" && ! grep -Eq "Test Files.*failed" /tmp/dod-b06.log && bash scripts/check-version-sync.sh'

## Invariant 覆盖（controller 注入铁律逐条映射）

- INV-1 [generator_retry_identity] N/A：本单不触碰 Generator 基础设施失败重试路由（不改 dispatcher 派发动作）。
- INV-2 [planner_role_branch] N/A：本单不改 planner workspace / planner_branch checkout 逻辑。
- INV-3 [fleet_brain_url_authority] N/A：本单不改 HARNESS_BRAIN_URL 注入 / 预检。
- INV-4 [evaluator_validation_clock] N/A：本单不改 validation_clock / hotfix 共享 clock 逻辑。
