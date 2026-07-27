---
skeleton: false
journey_type: agent_remote
target_environment: linux_server
---
# Contract DoD — Durable Fleet Worker bootstrap 与 Kernel 恢复闭环

**范围**: PRD Golden Path 第 1-12 步；一个 Draft PR、一个 immutable exact head、一个 fail-safe release boundary。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/Dockerfile` 将 `packages/brain/config/` 复制到 image `/app/config/`，且 built-image test 不挂 worktree。
  Test: node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!/COPY packages\\/brain\\/config\\/ \\.\\/config\\//.test(c))process.exit(1)"
- [ ] [ARTIFACT] migration 编号 ≥367，upgrade/rollback fixture 与 source enum parity test 同时存在。
  Test: node -e "const fs=require('fs');const xs=fs.readdirSync('packages/brain/migrations').filter(x=>/^36[7-9].*fleet.*\\.sql$/.test(x));if(xs.length<1)process.exit(1)"
- [ ] [ARTIFACT] Brain 版本与 `packages/brain/DEFINITION.md` 同步更新，描述 readiness/Worker-first/rollback drain。
  Test: node -e "const c=require('fs').readFileSync('packages/brain/DEFINITION.md','utf8');if(!/ready.*heartbeat|heartbeat.*ready/i.test(c)||!/Worker-first/i.test(c)||!/drain/i.test(c))process.exit(1)"
- [ ] [ARTIFACT] 真实 US E2E、mutation、rollback 脚本及两个 integration test 在合同路径落地。
  Test: node -e "const fs=require('fs');for(const p of ['scripts/kernel-fleet/run-real-attempt-proof.sh','scripts/kernel-fleet/run-us-durable-recovery-canary.sh','scripts/kernel-fleet/verify-owner-gate-and-rollback.sh','packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js','packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js'])fs.accessSync(p)"
- [ ] [ARTIFACT] Sprint Red 测试库存按 realpath 去重后恰好一个文件、11 个唯一 `it()`，且保留 migration `fleet-worker` enum parity Red。
  Test: node -e "const fs=require('fs');const p='sprints/07280225-kernel-fleet-durable-recovery-r5/tests/durable-recovery.contract.test.ts';const c=fs.readFileSync(p,'utf8');if((c.match(/\\bit\\(/g)||[]).length!==11||!c.includes('fleet-worker transport with production upgrade rollback and source enum parity'))process.exit(1)"

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
  动作: 请求真实 Brain/Worker/Xian 网络探测并用真 Postgres 验证 current task、journey、golden-path、step existence+ownership；回读 task `4a530430-00c5-46bc-8a4f-c0ec38025391` 已迁移的既有三元组，同时独立解析 run `4bbe35de-63c1-4cfe-9b55-fea8c01a0647`。
  预期观察: task 回读 anchor 精确为 journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`、GP `4e5fd7eb-3823-4c57-a817-081b7fdd2eed`、step `817f59f5-02ff-4a70-bd81-f7ae65f77e02` 且 GP/step ownership 同属 journey；task_id 与 run_id 不同；语法合法但零行 UUID、虚构锚、错误 ownership、task/run 混用、remote-disabled、不可达 URL fail closed；Xian 差距显示 `blocked_external` 而非降 profile。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" "4a530430-00c5-46bc-8a4f-c0ec38025391" "4bbe35de-63c1-4cfe-9b55-fea8c01a0647" "2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6" "4e5fd7eb-3823-4c57-a817-081b7fdd2eed" "817f59f5-02ff-4a70-bd81-f7ae65f77e02"
  期望: exit 0；blocked evidence 含真实探测时间与 profile requirement。

- [ ] [BEHAVIOR] [L3] Golden Path Step 6 — phase-aware budgets and idempotent cancellation
  动作: 对真实 Worker 分别注入 slow mirror、slow image、slow secret，使用同一 idempotency key 重试并取消。
  预期观察: within Attempt lease/deadline 返回对应 phase timeout；active Attempt/provider/container≤1；无 orphan/residue。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-phase-budgets.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" slow-mirror slow-image slow-secret
  期望: exit 0；三个 phase code 互不混淆。

- [ ] [BEHAVIOR] [L3] Golden Path Step 7 — real Attempt secret and artifact transfer
  动作: 在 exact pinned Runner 发起真实 Codex Attempt，先完成 Docker-mediated single-use secret receipt，再做 gh auth/push/fetch、stdout 写入、authenticated callback 与 canonical commit transfer；分别走 success、timeout、crash、cancel 四个终态；Runner 创建 nested ignored/node_modules/untracked output 后由 Worker 反向 cleanup。
  预期观察: within Attempt deadline Controller 在 cleanup 前物化 SHA/branch/task ownership 均已验证的 commit；brokered GitHub auth 在 Agent 前已验证，四终态均 revoke+delete attempt copy；mode-0600 auth 仅在 tmpfs；secret residue=0；container/runtime/worktree/admin/ACL/secret residual=0、quarantine=0，shared roots 无新增 write/chown/chmod。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
  期望: exit 0；private `/var/lib`、missing ACL、absent reader、bad auth、cleanup-before-transfer counterfactual 全部非零。

- [ ] [BEHAVIOR] [L2] Golden Path Step 8 — rejects invalid worktree before spawn
  动作: 在真 Postgres integration test 中对 missing、relative、nonexistent、non-Git、unmounted worktree 调真实 launcher，并运行 real child 的 ready/ownership+heartbeat 正控。
  预期观察: 所有坏路径在 spawn 前拒绝；async error/early exit/no-ready/timeout 失败；正控只在 heartbeat 持久化后 resolve。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js --reporter=verbose'
  期望: exit 0；诊断≤2048 bytes 且 secret sentinel 不出现。

- [ ] [BEHAVIOR] [L2] Golden Path Step 9 — records resumed only after ready heartbeat
  动作: 用真 Postgres 连续运行 watchdog 多轮：先制造 early launch failure，再修复并允许真实 replacement ready；另真实 spawn 同机 child，先验 live，kill 并 await exit 后再验 ESRCH dead，同时运行 unknown remote host 反事实。
  预期观察: 失败轮 `resumed=0` 且无 `reconcile-restarted`；成功轮 `resumed=1`、一个 replacement/Attempt/event，下一次 dispatch 完成；kill 后仅本机 ESRCH 判 dead，kill 前 live 与 unknown 均 replacement=0。
  验证命令: Test: manual:bash bash -c 'DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose'
  期望: exit 0；不重置状态且时间真实流逝。

- [ ] [BEHAVIOR] [L3] Golden Path Step 10 — Worker-first gate blocks Brain candidate publication
  动作: 执行真实 rollout transaction，并在一轮 mutation 中让 Worker admission 失败；检查 owner approval/merge 前无 staging/production mutation。
  预期观察: 正控 journal 为 worker installed→health→admitted→Brain candidate publishable；反事实 publishable count=0，pre-merge staging/production count=0。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-worker-first-rollout.sh "$CANDIDATE_BUNDLE_REF" "$US_WORKER_URL" "$FLEET_TOKEN_FILE"
  期望: exit 0；失败不得 warning 降级。

- [ ] [BEHAVIOR] [L3] Golden Path Step 11 — exact-head owner authorization precedes merge
  动作: 在 Evaluator/Judge 阶段只验证 Draft exact-head gate，运行 CI-only、non-owner、stale-head 与 missing-evidence mutations；本条禁止消费 owner approval 或执行 merge。
  预期观察: mutations 均保持 Draft、auto-merge off、merge/staging/production count=0；审计规则要求未来只有完整 `CI→Evaluator/Judge→owner` 序列才允许 exact-head merge。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh gate-only "$PR_NUMBER" "$PR_HEAD_SHA" "" "$US_WORKER_SSH"
  期望: exit 0；当前仍为 Draft，merge/staging/production count=0。

- [ ] [BEHAVIOR] [L3] Golden Path Step 12 — merge 后 staging 再 production 与 rollback
  动作: 在 owner 批准前只验证 post-merge canary/rollback 的 admission 条件与“尚未运行”反事实；真实 US staging、production canary 与 rollback 仅由 controller 在 authorized merge 后执行，Evaluator 无权执行。
  预期观察: 当前 staging/production mutation count=0；缺 owner/merge 或顺序颠倒时 canary fail closed；controller 后续规定顺序为 `merge→staging_passed→production_canary_started→production_canary_passed`。
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh pre-merge-no-production "$PR_NUMBER" "$PR_HEAD_SHA" "" "$US_WORKER_SSH"
  期望: exit 0；当前无 staging/production mutation；真实 post-merge 验证状态为 `logic-done-pending`。

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
  验证命令: Test: manual:bash bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" "4a530430-00c5-46bc-8a4f-c0ec38025391" "4bbe35de-63c1-4cfe-9b55-fea8c01a0647" "2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6" "4e5fd7eb-3823-4c57-a817-081b7fdd2eed" "817f59f5-02ff-4a70-bd81-f7ae65f77e02"
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
