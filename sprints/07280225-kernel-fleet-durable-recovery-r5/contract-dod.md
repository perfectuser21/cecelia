---
skeleton: false
journey_type: agent_remote
target_environment: linux_server
---
# Contract DoD — Durable Fleet Worker bootstrap 与 Kernel 恢复闭环

**范围**: PRD Golden Path 第 1-12 步 + R15 result channel + R16-R20 F1 S0-S12×11 lifecycle/current-run/canonical legacy SSOT；一个 Draft PR、一个 immutable exact head、一个 fail-safe release boundary。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/Dockerfile` 将 `packages/brain/config/` 复制到 image `/app/config/`，且 built-image test 不挂 worktree。
  Test: node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!/COPY packages\\/brain\\/config\\/ \\.\\/config\\//.test(c))process.exit(1)"
- [ ] [ARTIFACT] migration 编号 ≥367，upgrade/rollback fixture 与 source enum parity test 同时存在。
  Test: node -e "const fs=require('fs');const xs=fs.readdirSync('packages/brain/migrations').filter(x=>/^36[7-9].*fleet.*\\.sql$/.test(x));if(xs.length<1)process.exit(1)"
- [ ] [ARTIFACT] migration 367+ 同时落地 `fleet-worker` transport 与 Controller owner/generation/lease/ready/diagnostic 字段、active run 唯一约束及 rollback。
  Test: node -e "const fs=require('fs');const xs=fs.readdirSync('packages/brain/migrations').filter(x=>/^(36[7-9]|3[7-9][0-9]).*\\.sql$/.test(x));const c=xs.map(x=>fs.readFileSync('packages/brain/migrations/'+x,'utf8')).join('\\n');for(const k of ['fleet-worker','controller_owner_id','controller_generation','controller_lease_expires_at','controller_ready_at'])if(!c.includes(k))process.exit(1)"
- [ ] [ARTIFACT] Brain 版本与 `packages/brain/DEFINITION.md` 同步更新，描述 readiness/Worker-first/rollback drain。
  Test: node -e "const c=require('fs').readFileSync('packages/brain/DEFINITION.md','utf8');if(!/ready.*heartbeat|heartbeat.*ready/i.test(c)||!/Worker-first/i.test(c)||!/drain/i.test(c))process.exit(1)"
- [ ] [ARTIFACT] 真实 US E2E、mutation、rollback 脚本及两个 integration test 在合同路径落地。
  Test: node -e "const fs=require('fs');for(const p of ['scripts/kernel-fleet/run-real-attempt-proof.sh','scripts/kernel-fleet/run-us-durable-recovery-canary.sh','scripts/kernel-fleet/verify-owner-gate-and-rollback.sh','packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js','packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js'])fs.accessSync(p)"
- [ ] [ARTIFACT] Sprint Red 测试库存按 realpath 去重后恰好一个文件、17 个唯一 `it()`；collector 排除 `packages/brain/sprints/**` symlink alias，保留 migration parity、workflow bypass、result channel 与 lifecycle equivalence Red。
  Test: node -e "const fs=require('fs');const p='sprints/07280225-kernel-fleet-durable-recovery-r5/tests/durable-recovery.contract.test.ts';const c=fs.readFileSync(p,'utf8'),d=fs.readFileSync('sprints/07280225-kernel-fleet-durable-recovery-r5/contract-draft.md','utf8');if((c.match(/\\bit\\(/g)||[]).length!==17||!c.includes('fleet-worker transport with production upgrade rollback and source enum parity')||!c.includes('P0 workflows enforce owner merge staging production order')||!c.includes('canonical S0-S12 by eleven elements manifest')||!c.includes('attempt scoped result channel')||!d.includes(\"--exclude 'packages/brain/sprints/**'\"))process.exit(1)"
- [ ] [ARTIFACT] P0 统一 gate 与四个现有 workflow 的 fail-closed 接线均在实现范围。
  Test: node -e "const fs=require('fs');for(const p of ['.github/workflows/kernel-fleet-p0-gate.yml','.github/workflows/ci.yml','.github/workflows/brain-ci-deploy.yml','.github/workflows/auto-staging-deploy.yml','.github/workflows/deploy.yml'])fs.accessSync(p)"
- [ ] [ARTIFACT] title heuristic auto-merge 脚本、branch protection/ruleset reconciliation 与 built-image smoke 四消费方均有 machine contract。
  Test: node -e "const fs=require('fs');for(const p of ['.github/workflows/scripts/should-auto-merge.sh','scripts/kernel-fleet/reconcile-p0-repository-rules.sh','scripts/ci/verify-brain-image-self-contained.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] canonical lifecycle manifest、migration 368+、runtime SSOT、root regression contract 与 parity smoke 共同定义 F1 S0-S12。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/config/kernel-harness-lifecycle-s0-s12.json','packages/brain/src/lib/kernel-harness-lifecycle.js','regression-contract.yaml','scripts/kernel-fleet/verify-lifecycle-s0-s12.sh'])fs.accessSync(p);const ms=fs.readdirSync('packages/brain/migrations').filter(x=>/^(36[8-9]|3[7-9][0-9]).*kernel_harness_lifecycle.*\\.sql$/.test(x));if(ms.length!==1)process.exit(1)"
- [ ] [ARTIFACT] TaskBundle/Worker/Runner/callback finalizer 共享 attempt-scoped result-channel schema，且不再把 source `.brain-result.json` 作为权威 fallback。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/scripts/fleet-worker/result-channel-proof.cjs','scripts/kernel-fleet/run-result-channel-proof.sh'])fs.accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] Golden Path Step 1 — built image self-contained profiles
  动作: 从 exact Draft head 构建候选 Brain image，在不挂 worktree/config 的容器中导入 orchestrator 并直接加载三个 profile，再运行 missing-config mutation。
  预期观察: 3 个 immutable profile 全部加载；删除 `/app/config` 后稳定失败且错误码为 `brain_profile_config_missing`。
  验证命令: Test: manual:bash bash scripts/ci/verify-brain-image-self-contained.sh "$CANDIDATE_BRAIN_IMAGE" "$PR_HEAD_SHA"
  期望: exit 0；正控与反事实均执行。

- [ ] [BEHAVIOR] [L2] Golden Path Step 2 — fleet-worker transport migration parity
  动作: 对 production-shaped 真 Postgres 执行 migration 367+ upgrade，持久化真实 `fleet-worker` receipt，再 rollback 并检查 source/schema enum parity；创建 Attempt snapshot 后并发升级 profile generation。
  预期观察: upgrade 保留旧值并接受 `fleet-worker`；rollback 恢复旧 constraint；遗漏 enum mutation 被拒；既有 Attempt 的 profile/Runner/Worker/schema snapshot 不漂移，新 Attempt 才看到新 generation。
  验证命令: Test: manual:bash bash scripts/ci/verify-fleet-release-atomic.sh "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA" "${DB_URL:?}"
  期望: exit 0；真 Postgres，非内存替身。

- [ ] [BEHAVIOR] [L3] Golden Path Step 3 — installer mutation and exact rollback
  动作: 在真实 US macOS/OrbStack 上执行 installer transaction，逐一 mutate root owner、DSCL identity、OrbStack login context、bundle ref、credential-envelope、HOME、TMPDIR 与每级 ACL，再 rollback。
  预期观察: 每个 mutation 有独立非零 machine code；rollback 只移除本次 ACL/文件并恢复 before snapshot。
  验证命令: Test: manual:bash bash -c 'ssh "$US_WORKER_SSH" "sudo -n /usr/local/libexec/cecelia/kernel-fleet-transaction-verify --candidate $CANDIDATE_BUNDLE_REF --mutations all --rollback"'
  期望: exit 0；无混合 generation。

- [ ] [BEHAVIOR] [L3] Golden Path Step 4 — authenticated Worker admission
  动作: 用 protected token 请求真实 US Worker health，并运行与真实 Attempt 相同 root/mount/ACL/UID/GID/secret/cleanup probe；在 Agent spawn 前经 Worker→exact Runner seam 真写 stdout.jsonl 并验证 attempt-scoped brokered GitHub auth。
  预期观察: `base_admitted=true`、`dispatch_ready=true`、source/profile/Runner digests 精确匹配；bad token、private root、missing ACL、stale digest、unwritable stdout 或 missing GitHub auth 均失败且 Agent-start counter=0；stdout 失败持久化 1..2048 bytes、无 secret 的 machine diagnostic。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-worker-admission.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
  期望: exit 0；cleanup residue=0。

- [ ] [BEHAVIOR] [L3] Golden Path Step 5 — production preflight and semantic anchor
  动作: 从不可变 TaskBundle 动态读取 TASK_ID/RUN_ID/ATTEMPT_ID/CONTRACT_SHA/head 与真实 anchor，用真 Postgres 验 current task、journey、golden-path、step existence+ownership；再注入 terminal historical run、task-as-run、receipt mismatch、stale round/head、cross-run artifact/result。
  预期观察: current run 精确为 `fda8bfd7-fbbc-4260-a657-ea7f3b51bd16`；task 回读 anchor 精确为 journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`、GP `4e5fd7eb-3823-4c57-a817-081b7fdd2eed`、step `817f59f5-02ff-4a70-bd81-f7ae65f77e02` 且 ownership 一致；historical failed `4bbe35de-63c1-4cfe-9b55-fea8c01a0647` 等反事实 fail closed、budget delta=0；Xian 差距显示 `blocked_external`。
  验证命令: Test: manual:bash bash -c 'bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" "${TASK_ID:?}" "${RUN_ID:?}" "${REAL_JOURNEY_ID:?}" "${REAL_GP_ID:?}" "${REAL_STEP_ID:?}" && bash scripts/kernel-fleet/verify-run-binding-counterfactuals.sh "$TASK_ID" "$RUN_ID" "${ATTEMPT_ID:?}" "${CONTRACT_SHA:?}" "${PR_HEAD_SHA:?}" "4bbe35de-63c1-4cfe-9b55-fea8c01a0647"'
  期望: exit 0；blocked evidence 含真实探测时间与 profile requirement。

- [ ] [BEHAVIOR] [L3] Golden Path Step 6 — phase-aware budgets and idempotent cancellation
  动作: 对真实 Worker 分别注入 slow mirror、slow image、slow secret，使用同一 idempotency key 重试并取消。
  预期观察: within Attempt lease/deadline 返回对应 phase timeout；active Attempt/provider/container≤1；无 orphan/residue。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-phase-budgets.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" slow-mirror slow-image slow-secret
  期望: exit 0；三个 phase code 互不混淆。

- [ ] [BEHAVIOR] [L3] Golden Path Step 7 — real Attempt secret and artifact transfer
  动作: 在 exact pinned Runner 发起真实 Codex Attempt；Docker create 前预建 exact attempt 三根和继承 ACL，完成 single-use secret receipt、gh auth/push/fetch、stdout、authenticated callback 与 canonical transfer；Runner 创建 deep umask-077 nested/ignored/node_modules/untracked output。按 container-absent→exact normalize→host workspace/admin cleanup→runtime/secret cleanup→state delete 顺序执行 success/timeout/crash/cancel，并发 terminal/cancel/docker.wait/startup-reconcile 和 legacy restart。
  预期观察: within Attempt deadline Controller 在 cleanup 前物化 SHA/branch/task ownership 均已验证的 commit；四终态 auth revoke/delete；正控所有 residual/quarantine=0。helper failure 时 Docker create=0；shared root 无 write/chown/chmod。container 未移除时原地 cleanup_blocked；normalizer 失败仍做 host cleanup，若仍失败则仅一份含 workspace/admin/runtime/state 的 append-only receipt，跨 restart/two reconcile 不覆盖。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
  期望: exit 0；private `/var/lib`、missing ACL、RO/RW、symlink/out-of-root/wrong UUID/group mismatch、absent reader、bad auth、cleanup-before-transfer、legacy/concurrency/failure-forensics counterfactual 全部有独立非零/预期 receipt。

- [ ] [BEHAVIOR] [L2] Golden Path Step 8 — rejects invalid worktree before spawn
  动作: 在真 Postgres migration 367+ 上并发创建 active run，并从 startup/watchdog/manual 同时调用同一 ensureKernelController；对坏 worktree 调真实 launcher，运行 real child lease+dependency+ownership+fenced heartbeat 正控，再让旧 generation 写入。
  预期观察: 每个 run 仅一个 owner/generation；坏路径在 spawn 前拒绝；async error/early exit/no-ready/timeout/lease_busy 失败；正控只在 heartbeat 持久化后 resolve；旧 generation 的 heartbeat/intent/dispatch/merge/control 全拒绝。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js --reporter=verbose'
  期望: exit 0；诊断≤2048 bytes 且 secret sentinel 不出现。

- [ ] [BEHAVIOR] [L2] Golden Path Step 9 — records resumed only after ready heartbeat
  动作: 用真 Postgres让 startup-sync/watchdog/manual 竞争同一 run；先制造两个 infrastructure admission/config block，再恢复 admission 并允许真实 replacement ready；真实 spawn 同机 child，kill+await 后用既有 `src/lib/kernel-liveness.js` ESRCH SSOT 判死，并运行 unknown host 反事实。
  预期观察: production 查询不再依赖 tmux_session；基础设施失败 `resumed=0`、semantic streak=0、run 不 failed；恢复后 `resumed=1`、单 owner/replacement/Attempt/event，下一次 dispatch 完成；仅本机 ESRCH 判 dead，live/unknown replacement=0。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose'
  期望: exit 0；不重置状态且时间真实流逝。

- [ ] [BEHAVIOR] [L3] Golden Path Step 10 — Draft CI Evaluator Judge are evidence-only
  动作: 用签名 task/PR P0 classification 在真实 Draft exact head 运行 unified workflow、built-image smoke 四消费方与隔离 candidate Worker；修改 title/label、提供旧 Harness green、缺 remote/callback config、未 attested rollback image。
  预期观察: 事件仅为 `ci,evaluator,judge`；required check 绑定 run/check-suite/head/actor/repository-rule snapshot；PR 仍 Draft、auto-merge off；candidate proof 前后 serving state byte-identical；所有 mutation 无 merge/staging/production/semantic Attempt。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-p0-workflow-contract.sh draft-evidence "$PR_NUMBER" "$PR_HEAD_SHA"
  期望: exit 0；Evaluator/Judge 不读取 owner approval、不 merge、不 deploy。

- [ ] [BEHAVIOR] [L3] Golden Path Step 11 — exact-head owner authorization precedes merge
  动作: 对真实 repository protection/ruleset 执行 reconcile/snapshot，运行 owner exact-head 正控，以及 CI-only、non-owner、stale-head、missing-evidence、title/label、old-green、admin/direct/automation actor mutations。
  预期观察: required P0 check、owner signature、dismiss-stale/last-push approval 对所有 actor 生效；仅 controller 可 Draft→Ready/merge exact head；所有反事实 mutation count=0。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-p0-workflow-contract.sh owner-merge-gate "$PR_NUMBER" "$PR_HEAD_SHA"
  期望: exit 0；正控顺序 `ci,evaluator,judge,owner,merge`。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12 — merge 后 staging 再 production 与 rollback
  动作: authorized merge 后先 reconcile/admit exact Worker，验证部署 SSOT remote-enabled+callback 并由真实 Runner 回调，再 publish Brain、跑 US staging、production canary/rollback；mutate main-push、Fast Lane、schedule、skipped/idle、missing receipt/config/unattested rollback。
  预期观察: 仅 `merge→worker_admitted→brain_published→staging_passed→production_canary_started→production_canary_passed` 成功；旁路在 semantic Attempt 前失败；Controller 单 owner、reverse cleanup residual/quarantine=0；rollback attestation 失败保持 drained。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-p0-workflow-contract.sh post-merge-release "$PR_NUMBER" "$PR_HEAD_SHA"
  期望: exit 0；合并前为 `logic-done-pending`，合并后真实目标通过才 done。

- [ ] [BEHAVIOR] [L3] Golden Path Step 7A — read-only Runner result channel
  动作: 在 exact pinned Runner 以 read-only source checkout 启动 reviewer，TaskBundle 指定 attempt runtime 内 `callback_result_path`，Worker 注入 `BRAIN_RESULT_FILE`；source 中预置一个旧 `.brain-result.json`，并逐个运行 missing/EROFS/wrong-attempt/wrong-run/wrong-role/wrong-contract/head/symlink/oversize/malformed mutation。
  预期观察: 正控 within Attempt deadline 写入并由 callback finalizer 验 schema+attempt/run/role/contract/head/hash；旧 source result 与 stdout prose 被忽略。所有 mutation fail closed、diagnostic≤2048 bytes，pre-Agent 不可写时 Agent-start=0、semantic/GAN budget delta=0。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/run-result-channel-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
  期望: exit 0；success/timeout/crash/cancel 在 receipt 持久化后 result/credential residual=0。

- [ ] [BEHAVIOR] [L2] Golden Path Step 12A — canonical S0-S12 x 11 manifest parity
  动作: 在 fresh 与 production-like 真 Postgres 对 migration 368+ upgrade/rollback，原位升级 F1 六步 rows；从同一 manifest 生成/回读 DB、root regression contract、runtime API/report，并运行 gray/null/second-journey/cell-missing mutations。
  预期观察: stages=13、elements=11、cells=143、gray/null=0；existing F1 journey count 不增；manifest/DB/regression/API/report SHA 完全相同；每 cell 是 pass、na_with_reason、typed_pending 或 typed_blocked，缺 evidence 不得 pass。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-lifecycle-s0-s12.sh --manifest packages/brain/config/kernel-harness-lifecycle-s0-s12.json --provenance-sha 4dc3b69a --migration-min 368 --exact-head "${PR_HEAD_SHA:?}"'
  期望: exit 0；rollback 恢复 prior rows/constraints/provenance，evidence lost=0。

- [ ] [BEHAVIOR] [L2] Golden Path Step 12A — authenticated S0-S12 receipts and hard terminal gate
  动作: 由真实 Controller/PG/GitHub seam 从 S0 task-born、S1 intent、S2 Planner、S3 Contract GAN、S4 Generator（输出 Draft PR receipt）、S5 CI、独立 S6 Evaluator、独立 S7 Judge、S8 owner、S9 merge、S10 staging、S11 production/rollback 推进到 S12 accounting；对 stable ID/name/order/promise 做 rename/merge/split/shift/insert mutation，并分别删除 production、rollback、report、external-status receipt 后重跑。
  预期观察: 每 stage 只消费上段 exact-head authenticated receipt；S6/S7 attempt_id 不同且 mutation=0；任一 S12 前置缺失时 task/run 非 complete。恢复后 task/run、Promise Map、regression result、report、learning/handoff、external status 在一事务恰一次提交。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-lifecycle-terminal-accounting.sh "$TASK_ID" "$RUN_ID" "$PR_HEAD_SHA"'
  期望: exit 0；重复调用返回 already_complete 且无重复 ledger/report/external write。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12A — canonical KH-F1-F01..F08 legacy inventory
  动作: 从 4dc3b69a provenance 读取 129 个 exact legacy IDs，以 `KernelPolicyGate(family_id,legacy_behavior_id,provider,phase,subject)` 在真实 bash-guard/main-repo-write/local-precheck、DevGate、stop/watchdog、independent Judge、GitHub rule、staging/promote/rollback seams 运行可用的 Claude/Codex/Grok normal/violation/recovery；保留 evidence_mode/assertion_ref。
  预期观察: P0=66、P1=63，family counts=`F01=0,F02=2,F03=2,F04=8,F05=6,F06=0,F07=1,F08=110`；F01/F06 是 typed gap，F08 逐 ID 重分类；source anchor/active declaration/合成 72 receipt 都不能产 pass，缺真触发保持 typed_pending。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-lifecycle-legacy-equivalence.sh "$PR_HEAD_SHA" claude codex grok
  期望: exit 0；legacy_total=129、P0=66、P1=63、family inventory digest 匹配、bulk_inferred_pass=0。

## Invariant 覆盖映射

- [ ] [BEHAVIOR] [L2] INV-1 Golden Path Step 9 — 恢复真相、外部完成、Exact Head、Merge 权限、调度真验
  动作: 运行 Kernel recovery、artifact transfer 与 owner gate integration 集合。
  预期观察: 只凭 exit/callback/CI/PID 均不能推进 canonical state；真 PR/head/artifact/heartbeat 才推进。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js packages/brain/src/orchestrator/__tests__/ground-truth.test.js packages/brain/src/orchestrator/__tests__/human-review-class.test.js --reporter=verbose'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-2 Golden Path Step 6 — 语义成功、失败分支、字段长度、时间关系、多轮扫描、重扫幂等、后台告警
  动作: 对 receipt/error/timeout/retry 运行真实模块 integration 与边界值。
  预期观察: accepted/ready/heartbeat 语义字段强制；null/false 显式失败；诊断有界；预算<lease；重复扫描不重复付费/Attempt；连续失败有告警。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/orchestrator/production-transport.test.js packages/brain/src/orchestrator/failure-persistence.test.js packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose'
  期望: exit 0。

- [ ] [BEHAVIOR] [L3] INV-3 Golden Path Step 5 — 环境路由、Payload 环境、环境假设、真环境、服务存活、Mac 常驻、Daemon 清单、人工接管
  动作: 在 linux_server→真实 US Mac 路由运行 admission/launchd/port/manifest/ACL 探测。
  预期观察: target_environment 与 payload 一致；launchctl+port 同时存活；LaunchDaemon/manifest 登记；headless 失败可进入受审计人工接管但不绕 gate。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" "${TASK_ID:?}" "${RUN_ID:?}" "${REAL_JOURNEY_ID:?}" "${REAL_GP_ID:?}" "${REAL_STEP_ID:?}"
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-4 Golden Path Step 2 — Oracle 实跑、Shell 展开、测试质量、合同表格、Red 提交、毕业门禁、Brain Smoke、共享 CI
  动作: 跑本合同 manual oracle、shell parser、targeted test、TDD order/coverage gates 与 Brain smoke allowlist。
  预期观察: 目标解释器实际启动；异步测试 await；contract mapping 命中；只暂存精确测试；共享 CI 变更有本合同授权。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-contract-quality.sh sprints/07280225-kernel-fleet-durable-recovery-r5
  期望: exit 0。

- [ ] [BEHAVIOR] [L3] INV-5 Golden Path Step 7 — 凭据安全、日志脱敏、端点鉴权、租户隔离、测试隔离
  动作: 用两个 attempt identity、bad token 与 secret sentinel 跑真实 Runner/Worker。
  预期观察: 跨 attempt/tenant 读取拒绝；endpoint 无 token 拒绝；secret 不进任何持久面；smoke 不触碰非目标生产资源。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-6 Golden Path Step 2 — Git Ref、生产自报、部署失败、跨脚本语义、消费方、表名认领
  动作: 对候选 committed ref、production self-report、migration writer/reader 与 rollout verifier 做 parity。
  预期观察: ref 用 `rev-parse --verify ref^{commit}`；production self-report 与 candidate 精确匹配；未知值 fail closed；deployment 非零失败。
  验证命令: Test: manual:bash bash scripts/ci/verify-fleet-release-atomic.sh "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA" "${DB_URL:?}"
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-7 Golden Path Step 11 — Judge 证据、Relay 心跳、点火锚点、环境继承、历史合同
  动作: 运行 exact Attempt 的 evidence/heartbeat/env/semantic anchor contract。
  预期观察: judge 顶层与逐 behavior 有 exit_code/log_tail/level；长等待持续 heartbeat；必要变量显式注入；历史断言经过当前路径重跑。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-harness-evidence.sh "$PR_HEAD_SHA" "${DB_URL:?}"
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-8 Golden Path Step 12 — 单 Slot 串行、Task Type、Scheduler、收账探针、复活核查、退役实证
  动作: 扫描本任务实际 dispatch/consumer/death history 并运行路由回归。
  预期观察: 单 attempt 仅一个实现者；未新增 task_type/cron；report 更新时间可审计；删除历史与真实消费方已核验。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-controller-accounting.sh "$PR_HEAD_SHA"'
  期望: exit 0。

- `N/A [依赖修复]`：本 sprint 不处理 dependency advisory，不新增白名单。
- `N/A [Smoke 1784808160] [Smoke 1784806023] [Smoke 1784543934] [Smoke 1783850042] [Smoke 1783693282]`：PRD 未给这些 smoke 的语义/消费模块；保留现有 smoke，不修改、不静默删除。
- `N/A [多端完整]`：不新增展示层数据模型；三机差异由既有 profile/admission evidence 表达。
- `N/A [新后台 job 消费方]`：不新增 cron/background job；watchdog 是既有真实消费方。
- `N/A [多租户测试]`：本路径按 attempt/run/lease 隔离而非 tenant_id；INV-5 用两个 attempt identity 验隔离。
