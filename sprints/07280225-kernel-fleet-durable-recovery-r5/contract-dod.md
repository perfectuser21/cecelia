---
skeleton: false
journey_type: agent_remote
target_environment: linux_server
---
# Contract DoD — Durable Fleet Worker bootstrap 与 Kernel 恢复闭环

**范围**: PRD Golden Path 第 1-12 步 + R32-R45 exact inventory/advisory、append-only
classification/manifest/origin/cell evidence、同 Journey lifecycle projection、strict
staging/production/rollback、provider-neutral Guard Ledger D/A/F/E、独立 S12 accountant、
attempt-runtime result channel、Reviewer-v2 确定性批准/效果隔离、serial-single-writer
执行声明与两阶段 final E2E。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/Dockerfile` 将 `packages/brain/config/` 复制到 image `/app/config/`，且 built-image test 不挂 worktree。
  Test: node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!/COPY packages\\/brain\\/config\\/ \\.\\/config\\//.test(c))process.exit(1)"
- [ ] [ARTIFACT] migration 编号在执行前重查 tree/DB 后选择未占用的 ≥368，upgrade/rollback fixture 与 source enum parity test 同时存在。
  Test: node -e "const fs=require('fs');const xs=fs.readdirSync('packages/brain/migrations').filter(x=>/^36[7-9].*fleet.*\\.sql$/.test(x));if(xs.length<1)process.exit(1)"
- [ ] [ARTIFACT] migration 367+ 同时落地 `fleet-worker` transport 与 Controller owner/generation/lease/ready/diagnostic 字段、active run 唯一约束及 rollback。
  Test: node -e "const fs=require('fs');const xs=fs.readdirSync('packages/brain/migrations').filter(x=>/^(36[7-9]|3[7-9][0-9]).*\\.sql$/.test(x));const c=xs.map(x=>fs.readFileSync('packages/brain/migrations/'+x,'utf8')).join('\\n');for(const k of ['fleet-worker','controller_owner_id','controller_generation','controller_lease_expires_at','controller_ready_at'])if(!c.includes(k))process.exit(1)"
- [ ] [ARTIFACT] Brain 版本与 `packages/brain/DEFINITION.md` 同步更新，描述 readiness/Worker-first/rollback drain。
  Test: node -e "const c=require('fs').readFileSync('packages/brain/DEFINITION.md','utf8');if(!/ready.*heartbeat|heartbeat.*ready/i.test(c)||!/Worker-first/i.test(c)||!/drain/i.test(c))process.exit(1)"
- [ ] [ARTIFACT] 真实 US E2E、mutation、rollback 脚本及两个 integration test 在合同路径落地。
  Test: node -e "const fs=require('fs');for(const p of ['scripts/kernel-fleet/run-real-attempt-proof.sh','scripts/kernel-fleet/run-us-durable-recovery-canary.sh','scripts/kernel-fleet/verify-owner-gate-and-rollback.sh','packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js','packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js'])fs.accessSync(p)"
- [ ] [ARTIFACT] Sprint Red 测试库存按 realpath 去重后恰好一个文件、31 个唯一 `it()`；
  无共享 `loadProof` 动态 import，保留 migration/workflow/result-channel/full-fixture/
  classification/direct-origin/strict-staging/terminal-order Red。
  Test: node -e "const fs=require('fs');const p='sprints/07280225-kernel-fleet-durable-recovery-r5/tests/durable-recovery.contract.test.ts';const c=fs.readFileSync(p,'utf8');if((c.match(/^  it\\(/gm)||[]).length!==31||c.includes('loadProof(')||!c.includes('authority inventory full entry fixture and advisory partition')||!c.includes('strict staging rejects empty skip and SHA drift')||!c.includes('deterministic reviewer v2 approval rejects advisory outcomes and stale intent')||!c.includes('reviewer mutation surface is denied before verified approval')||!c.includes('current controller remains serial single writer'))process.exit(1)"
- [ ] [ARTIFACT] P0 统一 gate 与四个现有 workflow 的 fail-closed 接线均在实现范围。
  Test: node -e "const fs=require('fs');for(const p of ['.github/workflows/kernel-fleet-p0-gate.yml','.github/workflows/ci.yml','.github/workflows/brain-ci-deploy.yml','.github/workflows/auto-staging-deploy.yml','.github/workflows/deploy.yml'])fs.accessSync(p)"
- [ ] [ARTIFACT] title heuristic auto-merge 脚本、branch protection/ruleset reconciliation 与 built-image smoke 四消费方均有 machine contract。
  Test: node -e "const fs=require('fs');for(const p of ['.github/workflows/scripts/should-auto-merge.sh','scripts/kernel-fleet/reconcile-p0-repository-rules.sh','scripts/ci/verify-brain-image-self-contained.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] `packages/quality/contracts/` authority manifest、inventory fixture、classification decisions、projection manifest 与 safe migration/parity smoke 同时存在，Brain 投影标 authoritative=false。
  Test: node -e "const fs=require('fs');for(const p of ['packages/quality/contracts/kernel-policy-source-inventory.json','packages/quality/contracts/kernel-policy-authority.json','packages/quality/contracts/kernel-lifecycle-proposal-v1.json','scripts/kernel-fleet/verify-authority-inventory.sh','scripts/kernel-fleet/verify-lifecycle-projection.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] law-only manifest 与 exact fixtures 存在：full inventory=56518 bytes/
  `bfcb7a...`，history=`d74103...`，advisory=`a8e979...`；manifest 不保存 current color/state。
  Test: node -e "const fs=require('fs'),c=require('crypto');const h=x=>c.createHash('sha256').update(x).digest('hex');const i=fs.readFileSync('packages/quality/contracts/kernel-policy-source-inventory.json');if(i.length!==56518||h(i)!=='bfcb7a7678d5a1e1e3076ca27e34f0b01978ca590780f33d7ddb551f9615914d')process.exit(1);const m=JSON.parse(fs.readFileSync('packages/quality/contracts/kernel-harness-authority-manifest.json'));if(m.current_colors||m.current_state||m.cells.length!==143)process.exit(1)"
- [ ] [ARTIFACT] migration 新增四个 append-only authority/evidence/accounting 表与 derived views；
  Journey links/API/report 只作 authoritative=false projection。
  Test: node -e "const fs=require('fs'),p='packages/brain/migrations/368_kernel_harness_authority.sql',s=fs.readFileSync(p,'utf8');for(const t of ['kernel_harness_manifest_versions','kernel_harness_origin_receipts','kernel_harness_cell_evidence','kernel_harness_terminal_accounting'])if(!s.includes('CREATE TABLE '+t))process.exit(1)"
- [ ] [ARTIFACT] TaskBundle/Worker/Runner/callback finalizer 共享 attempt-scoped result-channel schema，且不再把 source `.brain-result.json` 作为权威 fallback。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/scripts/fleet-worker/result-channel-proof.cjs','scripts/kernel-fleet/run-result-channel-proof.sh'])fs.accessSync(p)"

- [ ] [ARTIFACT] lifecycle equivalence、provider activation 与 CredentialEnvelope 只从 owner-approved classification/applicability 动态派生 exact obligations，不含固定 1161/18 或 prefix unified ID。
  Test: node -e "const fs=require('fs');for(const p of ['packages/quality/contracts/kernel-policy-authority.json','scripts/kernel-fleet/verify-lifecycle-legacy-equivalence.sh','scripts/kernel-fleet/verify-provider-policy-activation.sh','scripts/kernel-fleet/verify-provider-credential-envelope.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] Claude、Codex、Grok Runner/adapter 均接入同一 provider-neutral CredentialEnvelope 边界。
  Test: node -e "const fs=require('fs');for(const p of ['packages/engine/runners/claude/runner.sh','packages/engine/runners/codex/runner.sh','packages/engine/runners/grok/runner.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] provider activation 的 installer source、installed/symlink manifest、CredentialEnvelope broker/consumer 与 Kernel dispatcher 均为具体实现文件。
  Test: node -e "const fs=require('fs');for(const p of ['packages/engine/install/install-kernel-policy-hooks.sh','packages/engine/config/kernel-policy-installed-targets.json','packages/brain/src/orchestrator/kernel-policy-gate.js','packages/brain/scripts/fleet-worker/credential-envelope-broker.cjs','packages/brain/scripts/fleet-worker/credential-envelope-consumer.cjs'])fs.accessSync(p)"
- [ ] [ARTIFACT] controller 驱动的 preapproval/postapproval final E2E 固定入口同时存在，preapproval 不 merge/deploy，postapproval 必须消费 owner receipt。
  Test: node -e "const fs=require('fs');for(const p of ['scripts/kernel-fleet/run-p0-preapproval-e2e.sh','scripts/kernel-fleet/run-p0-postapproval-e2e.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] Guard law、官方 clean-home installer、provider-neutral broker、append-only
  receipt migration/view 与独立 observer 入口均为具体文件，禁止以 direct hook verifier 替代。
  Test: node -e "const fs=require('fs');for(const p of ['packages/quality/contracts/kernel-guard-manifest.json','packages/engine/install/install-kernel-policy-guards.sh','packages/brain/src/orchestrator/kernel-guard-broker.js','scripts/kernel-fleet/run-clean-home-guard-proof.sh','scripts/kernel-fleet/verify-guard-proof.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] Reviewer-v2 approval law、Controller normalizer、Task intent revision producer、
  effect-isolation policy 与 exactly-once outbox 是具体生产文件，skill/code version 同源。
  Test: node -e "const fs=require('fs');for(const p of ['packages/quality/contracts/kernel-contract-approval-v2.json','packages/brain/src/orchestrator/contract-approval-v2.js','packages/brain/src/orchestrator/task-intent-revision.js','packages/brain/src/orchestrator/reviewer-effect-policy.js','packages/brain/src/orchestrator/approval-effects-outbox.js','scripts/kernel-fleet/verify-contract-approval-v2.sh','scripts/kernel-fleet/verify-reviewer-effect-isolation.sh'])fs.accessSync(p)"
- [ ] [ARTIFACT] task-plan 明确 serial single writer；未部署 FrozenWorkstreamPlan/IntegrationLease
  时不得宣称并行，所有 task 依赖构成单链。
  Test: node -e "const p=require('./sprints/07280225-kernel-fleet-durable-recovery-r5/task-plan.json');if(p.execution_mode!=='serial_single_writer'||p.parallel_width!==1)process.exit(1);for(const [i,t] of p.tasks.entries()){if(i===0&&t.depends_on.length!==0)process.exit(1);if(i>0&&t.depends_on.length<1)process.exit(1)}"

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

- [ ] [BEHAVIOR] [L2] Golden Path Step 8 — exact orchestrator entrypoint owns lease and heartbeat
  动作: 在真 Postgres migration 367+ 上并发创建 isolated active run，并从 startup/watchdog/manual 同时调用同一 ensureKernelController；坏 worktree 调真实 launcher；正控启动 exact built image/`packages/brain/src/orchestrator/run.js`，分别绑定 image digest、git commit/tree 与 run.js blob digest，让 child 真构造依赖、拿 owner/generation lease、写 fenced heartbeat；parent 独立查 PG。另启动只发 ready frame、无 DB lease/heartbeat 的 spoof child。
  预期观察: 每个 run 仅一个 owner/generation；image/commit/tree/blob 分别精确匹配，坏路径在 spawn 前拒绝；把 commit 当 blob digest、async error/early exit/no-ready/timeout/lease_busy/spoof frame 均失败；正控只在 DB owner/generation/ready_at/heartbeat 与 child 匹配后 resolve；旧 generation 的 heartbeat/intent/dispatch/merge/control 全拒绝。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js --reporter=verbose'
  期望: exit 0；诊断≤2048 bytes 且 secret sentinel 不出现。

- [ ] [BEHAVIOR] [L2] Golden Path Step 9 — records resumed only after ready heartbeat
  动作: 用真 Postgres让 startup-sync/watchdog/manual 竞争同一 run；先制造两个 infrastructure admission/config block，再恢复 admission 并允许真实 replacement ready；真实 spawn 同机 child，kill+await 后用既有 `src/lib/kernel-liveness.js` ESRCH SSOT 判死，并运行 unknown host 反事实。
  预期观察: production 查询不再依赖 tmux_session；基础设施失败 `resumed=0`、semantic streak=0、run 不 failed；恢复后 `resumed=1`、单 owner/replacement/Attempt/event，下一次 dispatch 完成；仅本机 ESRCH 判 dead，live/unknown replacement=0。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose'
  期望: exit 0；不重置状态且时间真实流逝。

- [ ] [BEHAVIOR] [L3] Golden Path Step 10 — Draft CI Evaluator Judge are evidence-only
  动作: 用签名 task/PR P0 classification 在真实 Draft exact head 运行 unified workflow、built-image smoke 四消费方与隔离 candidate Worker；通过 GitHub API 回读真实 run/check-suite/head/actor/签名 rules snapshot；修改 title/label、提供旧 Harness green、缺 remote/callback config、未 attested rollback image。
  预期观察: 事件仅为 `ci,evaluator,judge`；required check 的 run/check-suite/head/actor/rules snapshot 均经 GitHub API 验证，合成 JS array/boolean 被拒；PR 仍 Draft、auto-merge off；candidate proof 前后 serving state byte-identical；所有 mutation 无 merge/staging/production/semantic Attempt。
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
  动作: Controller 生成逻辑 descriptor 与 TaskBundle top-level role，Worker 只在 exact attempt runtime root 创建 mode-0600 non-symlink result path，验证 Runner UID 可写后注入唯一 `BRAIN_RESULT_FILE`；source 中预置旧 `.brain-result.json`，运行 missing/absolute/dotdot/wrong-attempt/EROFS/symlink/oversize/malformed/callback-failure mutation。
  预期观察: 正控 receipt 的 task/run/attempt/role/contract/head/lease/hash 与 server-side TaskBundle 逐字相等，role 不依赖尚未生产注入的 CURRENT_ROLE env；Brain 在 cleanup 前持久化 `attempt.result.result_channel_receipt` 并回同 hash ack。旧 source result、stdout/prose被忽略；pre-Agent 失败 Agent-start=0、semantic/GAN budget delta=0；callback/ack 失败保留证据不 cleanup。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/run-result-channel-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$TASK_ID" "$RUN_ID" "$ATTEMPT_ID" "$CONTRACT_SHA" "$PR_HEAD_SHA"
  期望: exit 0；same-hash retry 幂等，different-hash replay 冲突，durable ack 后才清理。

- [ ] [BEHAVIOR] [L2] Golden Path Step 12A — exact authority inventory、advisory 与 safe lifecycle projection
  动作: 独立从 exact main commit:path blob 与 full 56518-byte fixture 重算 P0/P1 inventory/full digest/advisory digest/partition；在 fresh 与 production-like 真 PG 验 366 collision 后动态选择未用 368+，对 Journey `bb8cc561-b3ee-4fec-b74d-2255694bd963` 投影 proposed S0-S12，运行 failure/logical rollback。
  预期观察: inventory 129/P0=66/P1=63/full digest=`bfcb7a...`、advisory=`a8e979...`、76/53、F08=66/44 且 semantic hits=0；六历史行 fixture digest=`d74103...`，Reviewer/Final E2E alias 分别为 `e2bd9263-87ef-4461-a1d5-5ff07a38b8a8`/`a6888ef3-2482-4655-8703-cf3b9f037cb9`，所有 legacy 列及 updated_at 前后/rollback 后 byte-identical；4 backbones+2 aliases+9 new、13 backbones、143 law cells，Journey 不增。
  验证命令: Test: manual:bash bash -c 'bash scripts/kernel-fleet/verify-authority-inventory.sh --commit dd424a61926009ac85a915b31187124b85f0ca98 --path packages/engine/regression-contract.yaml --blob 7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3 --count 129 --p0 66 --p1 63 --digest 4fcdf146ad08ab0ba349d789084fad6d85902b0e345993fb7ddf9057899a1e5f && DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-lifecycle-projection.sh --source-proposal 4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13 --migration-min 368 --recheck-tree-and-db --same-journey --preserve-six-history --logical-rollback --origin-kind-direct-proof --exact-head "${PR_HEAD_SHA:?}"'
  期望: exit 0；短 SHA、自证 oracle、历史 rename/reorder/promise/status/timestamp mutation 全拒绝。

- [ ] [BEHAVIOR] [L2] Golden Path Step 12A — authenticated append-only S0-S12 receipts and hard terminal gate
  动作: 由真实 Controller/PG/GitHub/deployment seam 从 S0 推进到 S12；按 stage exact origin_kind 直接查询并写 append-only origin/cell evidence。对 Journey PATCH green、expired-without-scheduler、missing cell、空/all-SKIP staging、SHA drift、promoted-without-health、missing rollback/report/effect 逐项 mutation。
  预期观察: S3 proposer+reviewer quorum、S6/S7 distinct Attempt/session；S5/S8/S9 真 GitHub API；S10 required test≥1/FAIL=0/required SKIP=0/merge=deployed=tested SHA；S11 真 deploy+health+rollback receipt；S12 SERIALIZABLE+run advisory xact lock 的一次 transaction。Journey projection、summary boolean 与 generic action receipt 不算 evidence。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-terminal-accounting.sh --task "$TASK_ID" --run "$RUN_ID" --head "$PR_HEAD_SHA" --serializable --direct-origin-stores --exact-cells 143 --strict-staging --production-health --rollback-anchor --all-counterfactuals'
  期望: exit 0；重复调用返回 already_complete 且无重复 ledger/report/external write。

- [ ] [BEHAVIOR] [L2] Golden Path Step 12A — projection 写入与 evidence expiry 不可绕权威门
  动作: 对真实 Journey API PATCH/cascade green 后直接查 canonical evidence view；不运行 scheduler 而推进 DB clock 超过 valid_until；提交 na_requested 并尝试同 principal 自批。
  预期观察: Journey/UI color 可变但 canonical satisfied delta=0；过期即时变 expired；同主体 NA 审批被拒，P0 na_allowed=false。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-authority-write-isolation.sh --real-pg --patch-journey-green --expire-without-scheduler --self-approve-na'
  期望: exit 0；三个 counterfactual 均 fail closed。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12A — approved classification-derived equivalence
  动作: 将 immutable source inventory、append-only classification decisions 与 equivalence obligations 分层验证；对 imported proposal、advisory 76/53、F08 66/44、H1-001/H1-002→F08、unreviewed/rejected、未冻结 unified ID、provider applicability mutation 逐项重验。
  预期观察: imported `0,2,2,8,6,0,1,110` 与 advisory recommendation 都不等于 approved distribution；无 owner exact-head approval 时 129 行 `approved_family=null`、canonical=false、derived obligation=0，历史 receipt 标 inadmissible_pre_authority。终态 `unreviewed=0`，rejected 由 append-only superseding owner decision 或 preserved non-equivalence 闭合；required set 只从最新有效 approved decisions/applicability 动态派生。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-lifecycle-legacy-equivalence.sh --task "$TASK_ID" --run "$RUN_ID" --contract "$CONTRACT_SHA" --head "$PR_HEAD_SHA" --authority-manifest packages/quality/contracts/kernel-policy-authority.json --derive-obligations-from-approved-decisions --require-unreviewed-zero --reject-imported-distribution-as-canonical --reject-h1-001-h1-002-f08-without-owner-decision
  期望: exit 0；required=receipt-derived observed，所有缺失/重复/推断/过期为 0。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12A — provider activation 与 CredentialEnvelope 等价
  动作: verifier 独立读取 canonical F01-F08 applicability manifest 的具体 construct+production entrypoint+providers+scenarios 生成 activation required set，经 root `.claude/settings.json`、`packages/engine/.claude/settings.json`、installer source+installed/symlink target、Kernel dispatcher 触发 branch-protect/main-repo-write、credential/bash/local、DevGate/DoD、stop/watchdog、Evaluator/Judge、GitHub rules、release seams；observed key 只从 authenticated fire receipt body 派生。在 exact Runner 为三 provider 各运行 normal+六 denial+fresh recovery。
  预期观察: activation receipt 包含完整有序 wiring hops/origin/effect/evidence，任一 settings/installer/symlink/dispatcher mutation 使 exact-set mismatch。Credential obligations 只由 owner-approved provider applicability 派生；denial redacted+effect=0，recovery 链接 violation+fresh envelope，旧 envelope 不可复用；secret persistence=0。
  验证命令: Test: manual:bash bash -c 'bash scripts/kernel-fleet/verify-provider-policy-activation.sh --task "$TASK_ID" --run "$RUN_ID" --contract "$CONTRACT_SHA" --head "$PR_HEAD_SHA" --authority-manifest packages/quality/contracts/kernel-policy-authority.json --derive-required-from-approved-applicability --derive-observed-from-fire-receipts && bash scripts/kernel-fleet/verify-provider-credential-envelope.sh --task "$TASK_ID" --run "$RUN_ID" --contract "$CONTRACT_SHA" --head "$PR_HEAD_SHA" --authority-manifest packages/quality/contracts/kernel-policy-authority.json --derive-required-from-approved-applicability --verify-origin-kinds-directly'
  期望: exit 0；activation/credential required=receipt-derived observed，无 secret 泄露。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12B — clean-home 三 provider Guard activation
  动作: 从 mktemp+env -i 的 HOME/XDG/GIT/Claude/Codex/Grok roots 与隔离 bare origin 出发，只运行官方 installer 和真实 Kernel launcher，分别通过三种 provider CLI 发送 V01-V13。
  预期观察: effective config/argv/realpath/provider binary/launcher digest 的完整有序 hop 被 attested；手工 settings、direct hook、Codex disabled hooks、Grok always-approve 均不能产生 A/F/E；三 provider 同 vector decision/reason/effect 全等。
  验证命令: Test: manual:bash DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/run-clean-home-guard-proof.sh --manifest packages/quality/contracts/kernel-guard-manifest.json --providers claude,codex,grok --vectors V01-V13 --official-installer packages/engine/install/install-kernel-policy-guards.sh --real-launcher docker/cecelia-runner/entrypoint.sh --require-stages D,A,F,E --independent-observer
  期望: exit 0；clean-home 前后 Merkle、realpath/digest 与 provider version 均有独立原始证据。

- [ ] [BEHAVIOR] [L2] Golden Path Step 12B — Guard receipts append-only 且 D/A/F/E 不可自证
  动作: 在真 Postgres 写 deny/near-allow/recovery 的 D→A→F→E chain，尝试 UPDATE/DELETE、同 subject observer、自报 stdout、缺 predecessor、digest drift 与 receipt-store failure。
  预期观察: UPDATE/DELETE 被 DB role/trigger 拒绝；F/E observer_class!=subject_class 且 E 引用同-vector F；receipt-store failure 阻断动作；classification 未 owner-approved coverage=0；drift 立即 stale。
  验证命令: Test: manual:bash DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-guard-proof.sh --manifest packages/quality/contracts/kernel-guard-manifest.json --derive-required-from-approved-classification --derive-observed-from-append-only-receipts --require-proven-fresh --reject-summary-boolean --all-counterfactuals
  期望: exit 0；guard_proof 仅为 SQL view/pure query，无持久化 pass boolean。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12B — V01-V13 deny nearby-allow recovery 与独立 effect
  动作: 逐 exact vector 发 protected write/shell/checkout/secret input+output/push/PR/merge/Stop/staging/rollback 反事实，每个只修一个前置条件运行 nearby allow，再运行 exactly-once recovery。
  预期观察: exact vector set=V01..V13；deny reason 为 R42 列出的 `KH_G01_*..KH_G08_*` 精确 enum；nearby allow 为 `KH_ALLOW_POLICY_SATISFIED`；recovery 为 `KH_RECOVERY_PRECONDITION_SATISFIED`；独立 observer 证明 refs/files/log/result/callback/DB/production SHA 符合 effect。
  验证命令: Test: manual:bash DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-guard-vectors.sh --providers claude,codex,grok --vectors V01-V13 --deny --near-allow --recovery --independent-effect
  期望: exit 0；缺/重/改名 vector、错误 reason、永久 deny、重复 recovery、secret egress、remote ref 前移或 production SHA 变化均失败。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12B — single merge staging production authority
  动作: 在真实 GitHub/rules/deployment store 对 title-based auto-merge、alternate actor、main-push、scheduled、Fast-Lane/manual deploy、queued/empty/all-SKIP staging、Stop completion 和 Journey PATCH green 逐项尝试旁路。
  预期观察: 只有 exact-head Controller policy 可 merge；S10 必须 required>0/FAIL=0/SKIP=0 且 merge=deployed=tested SHA；S11 必须 deploy+production self-reported health SHA+rollback drill；所有旁路 effect=0 且 S12 non-complete。
  验证命令: Test: manual:bash DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-single-release-authority.sh --github-api --deployment-store --all-bypasses --task "$TASK_ID" --run "$RUN_ID" --head "$PR_HEAD_SHA"
  期望: exit 0；单一 merge mutation、单一 staging consumer、单一 production authority 与真实 effect receipt。

- [ ] [BEHAVIOR] [L2] Golden Path Step 10A — deterministic Reviewer-v2 approval
  动作: 用真 PG、真实 attempt-runtime result channel 与 Controller-owned Contract Gate 运行 clean
  正控及 concerns/低分/缺维度/prose/source result/no ack/task addendum/head-skill drift/hash replay/stale lease。
  预期观察: 前 11 个 mutation 全部 non-authorizing、budget delta=0；仅 clean completed 且七维
  都≥7、intent/head/result/gate/test 同一 frozen snapshot 时写一份 approval，same-hash 重试不增量。
  验证命令: Test: manual:bash DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-contract-approval-v2.sh --real-pg --real-result-channel --controller-gate --all-counterfactuals --task "${TASK_ID:?}" --run "${RUN_ID:?}" --head "${PR_HEAD_SHA:?}"
  期望: exit 0；每个拒绝有独立 reason code 与 durable non-authorizing receipt。

- [ ] [BEHAVIOR] [L3] Golden Path Step 10B — Reviewer network effect isolation
  动作: 在真实 read-only Reviewer Runner 对 registry/decision/task/PR/merge/deploy/staging/production
  发受控 mutation POST，并分别运行 REVISION、stale 与 verified approval outbox。
  预期观察: Reviewer mutation credential=0，八类 effect delta=0 且有 deny receipt；前两种
  outbox write=0，verified approval 恰一次；skill 含 force-approve/default 或 pre-verify write 即 preflight fail。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-reviewer-effect-isolation.sh --real-runner --brain-api --github-api --deployment-api --controlled-posts registry,decision,task,pr,merge,deploy,staging,production --task "${TASK_ID:?}" --run "${RUN_ID:?}" --head "${PR_HEAD_SHA:?}"
  期望: exit 0；secret scan=0，retry 后 outbox count=1。

- [ ] [BEHAVIOR] [L2] Golden Path contract execution — current Controller stays serial single writer
  动作: 把本合同 task-plan 交给真实 Controller scheduler preflight，注入四个 ready label、
  `parallel_width=4`、cycle、unknown dep、overlap、canonical-branch writer 与 segment global-pass mutation。
  预期观察: 当前能力广告固定 `serial_single_writer/1`，同时只分配一个 writer；所有并行/计划
  mutation 返回 `SERIAL_SINGLE_WRITER_REQUIRED` 或结构化 plan error；segment PASS 不改变 global state。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-workstream-execution-mode.sh --real-controller --plan sprints/07280225-kernel-fleet-durable-recovery-r5/task-plan.json --all-counterfactuals
  期望: exit 0；Draft PR count=1、canonical writer=controller、merge receipt count≤1。

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
