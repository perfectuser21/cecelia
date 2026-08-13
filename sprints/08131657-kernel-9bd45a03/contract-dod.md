---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 真身 Session Controller（每条 kernel run 一个常驻监护进程）

**范围**: `packages/brain/` Controller 守护进程生命周期（spawn 先于 Kernel / lease 续租 / 监护 fatal 分类 / 人审 push 冻结 / 终局回写）。不改 UI、不改 Kernel 状态机权威、不改 orphan-guard 收尸逻辑。
**大小**: L

> 验证机制：本 sprint 无 HTTP 端点，BEHAVIOR oracle = 真 Postgres 行状态 + 真 OS 进程存活/信号 + 真本地 git head。每条 BEHAVIOR 的 `Test:` 单行调用 generator 交付的 `packages/brain/scripts/run-controller-daemon-test.sh <name>`（解析 `$DB_URL`→DB_* env，跑 `vitest --config vitest.integration.config.js -t '<name>'`，用例失败即非 0 退出）。禁 mock 被改的边（见 contract-draft.md「禁 mock 边清单」）。

## ARTIFACT 条目

- [ ] [ARTIFACT] Controller 守护进程入口文件存在（真身，非记账 UUID）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-controller-daemon.js','utf8');if(!/runControllerDaemon/.test(c))process.exit(1)"

- [ ] [ARTIFACT] kernel-controller-lifecycle.js 导出四个新函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-controller-lifecycle.js','utf8');for(const f of ['renewControllerLease','decideKernelFatalAction','enforceHumanReviewPushFreeze','writebackControllerFinalResult'])if(!c.includes(f))process.exit(1)"

- [ ] [ARTIFACT] migration（下一空闲号，建 controller_pid/controller_host/controller_frozen_head_sha/controller_push_frozen_at 列，可空幂等）
  Test: node -e "const fs=require('fs');const d='packages/brain/migrations';const f=fs.readdirSync(d).find(x=>/controller/i.test(x)&&/frozen|pid|daemon/i.test(x)&&x.endsWith('.sql'));if(!f)process.exit(1);const c=fs.readFileSync(d+'/'+f,'utf8');for(const col of ['controller_pid','controller_host','controller_frozen_head_sha','controller_push_frozen_at'])if(!c.includes(col))process.exit(1);if(!/ADD COLUMN IF NOT EXISTS/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 新集成测试登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS（进 CI 永久回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('kernel-controller-daemon.pg.integration.test.js'))process.exit(1)"

- [ ] [ARTIFACT] INV-1 [merge权归属 e8230eb5]：Controller 只监护不自 merge — 守护进程源码不含自 merge PR 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-controller-daemon.js','utf8');if(/gh\s+pr\s+merge|mergePullRequest|merge_method|\.merge\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] INV-3 [台账出repo 933701a3]：Controller 台账 .harness/ 在 git 追踪之外，未随 PR 带入 repo
  Test: bash -c 'grep -qE "^\.harness/|^/\.harness/" .gitignore && [ -z "$(git ls-files .harness/ 2>/dev/null)" ]'

## BEHAVIOR 条目（五行剧本，真 PG + 真进程 + 真 git；禁 mock 被改的边）

- [ ] [BEHAVIOR] [L2] B-01: spawn Controller before Kernel and record ownership [接缝×2]
  动作: 用真实 launchController/launchKernel（真 child_process）驱动 _spawnKernelRuntime，各自落时间戳标记
  预期观察: 先出现活 Controller 进程（controller_pid 可 kill -0），run.controller_session_id/controller_pid 非空，Controller 就绪标记时间戳早于 Kernel launch 标记
  等待预算: 120s（超时=FAIL）
  留证: 测试输出末 20 行（含 B-01 ok）+ controller/kernel 标记时间戳对比
  Test: manual:bash -c 'bash packages/brain/scripts/run-controller-daemon-test.sh "B-01"'

- [ ] [BEHAVIOR] [L2] B-02: lease renewed across two cycles
  动作: 启动 Controller 续租循环（注入短续租周期），观测两个续租周期
  预期观察: controller_lease_expires_at 连续两次严格递增，且两周期内任意时刻 lease > NOW()
  等待预算: 120s（超时=FAIL）
  留证: 三次 lease 到期时刻（初始/第1次/第2次）打印，单调递增
  Test: manual:bash -c 'bash packages/brain/scripts/run-controller-daemon-test.sh "B-02"'

- [ ] [BEHAVIOR] [L2] B-03: kill Kernel classified fatal action (resume / terminate / unknown-wait) [接缝×2]
  动作: 真 kill -9 被监护 Kernel 位进程；分别在可恢复类、不可恢复类(assembly_fault)、liveness=unknown 三分支下驱动监护循环
  预期观察: 可恢复类→resume 重拉 Kernel 且 run 不进无主态；不可恢复类→failure_reason=kernel_process_fatal:<code> 且 controller_session_id 未清空、run 不进无主态；unknown→无 resume/terminate、run 与 lease 不变
  等待预算: 150s（超时=FAIL）
  留证: 三分支各自 run 行 phase/failure_reason/controller_session_id 查询结果
  Test: manual:bash -c 'bash packages/brain/scripts/run-controller-daemon-test.sh "B-03"'

- [ ] [BEHAVIOR] [L2] B-04: human review push freeze rejects push and unfreezes after verdict [接缝×2]
  动作: 真本地 git（bare remote + clone），run 置 phase=review 触发冻结记录冻结 head；冻结期尝试 push 使 head 前进（含并发多次）；随后置裁决态解冻再 push
  预期观察: 冻结期 remote head 保持=冻结 SHA（push 被拒止/回滚），并发多次尝试全部被拒；解冻后同一 push 被允许、head 前进
  等待预算: 120s（超时=FAIL）
  留证: 冻结期与解冻后的 git rev-parse remote head 对比 + enforceHumanReviewPushFreeze 返回值
  Test: manual:bash -c 'bash packages/brain/scripts/run-controller-daemon-test.sh "B-04"'

- [ ] [BEHAVIOR] [L2] B-05: final writeback pr_url merged before exit (含失败终局结构化回传) [接缝×2]
  动作: 喂入 pr.merged=true 外部真相驱动终局；另一分支喂入失败终局；观测 Controller 退出前后
  预期观察: 成功终局 tasks.result 含 pr_url(非空)+merged=true+summary，且回写发生在 Controller 进程退出之前；失败终局 tasks.result 含结构化 failure_reason(脱敏无凭据明文)，禁无声消失（INV-2 收尾不跳过 e83b2f0d）
  等待预算: 120s（超时=FAIL）
  留证: tasks.result JSON 查询结果 + Controller 退出顺序标记
  Test: manual:bash -c 'bash packages/brain/scripts/run-controller-daemon-test.sh "B-05"'

- [ ] [BEHAVIOR] [L2] B-06: kill Controller lease expires orphan-guard reclaims (后备回归不回退) [接缝×2]
  动作: 真 kill -9 Controller 进程，无人续租使 lease 过期；跑既有 reconcileOwnerlessKernelRuns
  预期观察: 该 run 被判无主并 finalize failed(ownerless_kernel_run_recovered:controller_lease_expired)，健康 owned run 不被误伤、不双重接管；既有 kernel-controller-lifecycle.pg.integration 回归全绿（INV-4 无主核查 636296d4 不回退）
  等待预算: 120s（超时=FAIL）
  留证: 无主 run 与健康 run 的 phase/failure_reason 查询结果 + 既有回归套件通过行
  Test: manual:bash -c 'bash packages/brain/scripts/run-controller-daemon-test.sh "B-06"'

- [ ] [BEHAVIOR] [L2] INV-5 [验证时钟 ddca7267] N/A：本 sprint 不改 evaluator 对既有 PR 的 validation clock；Controller 全程注入统一 now（确定性纪律），不自取时间
  动作: N/A — 断言 Controller 生命周期函数签名均接受注入 now（不含裸 Date.now/new Date），验证时钟不分叉
  预期观察: kernel-controller-lifecycle.js / kernel-controller-daemon.js 生命周期函数不出现裸 Date.now()/new Date()（时间统一注入）
  等待预算: 0s（同步）
  留证: grep 扫描结果（无裸时钟）
  Test: manual:bash -c 'test -z "$(grep -nE "Date\.now\(\)|new Date\(\)" packages/brain/src/orchestrator/kernel-controller-daemon.js packages/brain/src/orchestrator/kernel-controller-lifecycle.js | grep -v "now = " | grep -v "@param")" || { echo "FAIL: 裸时钟未注入"; exit 1; }; echo OK'
