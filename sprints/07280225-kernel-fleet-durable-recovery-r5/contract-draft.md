# Sprint Contract Draft（Round 1）

## 合同 Notes

- frozen_base: `dd424a61926009ac85a915b31187124b85f0ca98`
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js`)
- context-manifest: unavailable（端点返回 404；PRD 的“累积 FR：暂无历史”作为本轮输入）
- judgment-pending-user: ⚠️ Draft PR exact-head owner approval 的授权主体与可审计签名来源
- judgment-pending-user: ⚠️ Mac-compatible single-use secret consumption receipt 的生产判定方法
- Xian `macOS 15.6.1 < 15.7.4` 与 M1 Tailscale CLI 暴露属于外部维护 blocker，只记录 blocked evidence；禁止降低 profile 或加入绕过。
- 候选 `sha256:9fc98f...`、临时 60 秒 timeout、`/tmp` copy、手工 plist/ACL/schema 扩宽均仅为 operator evidence，不是发货构件。

## Response Schema（推导来源: PRD字面）

N/A — PRD 不新增独立 HTTP endpoint。真实调用链复用 Worker `/health`、`POST /harness/attempts`、Attempt callback 与 Brain 查询面；本合同只锁定它们的生产 shape、语义字段和错误码，不另造 response key。

## 已知约束（来自回归测试与累积 FR）

- `[packages/brain/src/__tests__/harness-relay-watchdog-kernel-fleet.test.js]` → recovery 必须 inspect/cancel/launch，并持久化真实 `fleet-worker` receipt。
- `[packages/brain/src/orchestrator/preflight/production-wiring.test.js]` → `base_admitted` 与 `dispatch_ready` 同时为真才可派发。
- `[packages/brain/src/orchestrator/fleet-execution-migration.test.js]` → 当前 migration 363 只允许 `local-docker|remote-bridge`，这是必须复现的 Red。
- `[packages/brain/scripts/fleet-worker/attempt-runner.test.cjs]` → 当前 Runner contract 仍以 host FIFO 与 10 秒 writer deadline 为中心，不能证明 OrbStack/Mac rendezvous。
- `[packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh]` → installer 已有 plist/rollback 基线，本次必须把 Docker-visible root、ACL、toolchain、credential-envelope 纳入同一事务。
- `[packages/brain/scripts/fleet-worker/fleet-rollout.test.sh]` → rollout 已有 drain/admit 骨架，但必须补 Worker-first publication gate 与 exact committed ref。
- `[packages/brain/src/anchor-check.js]` → 当前只做字段存在检查；本次必须升级为 journey/golden-path/step 真实存在且 ownership 一致。
- `[累积FR]` → 本 line 暂无历史。
- `api_registry/db_registry/test_registry` 可用；沿用 snake_case、Vitest `describe/it`、Postgres migration 约定，不新增平行命名。

## 真实调用方请求 shape

生产调用方为 `packages/brain/src/orchestrator/remote-bridge-transport.js`，Worker 消费方为 `packages/brain/scripts/fleet-worker/fleet-worker.cjs`：

- 认证：HTTP header `Authorization: Bearer <KERNEL_FLEET_BRIDGE_TOKEN>`；token 不得出现在 body、argv、env dump 或日志。
- 创建：`POST /harness/attempts`，`Content-Type: application/json`。
- body 关键字段逐字为 `attempt_id`、`run_id`、`lease_owner`、`lease_generation`、`target.{provider,account,model,machine,role}`、`workspace_spec.{repo,base_sha,branch,expected_head_sha,mode,run_id,attempt_id}`、`provider_spec.{provider,command,args,stdin,output}`、`credential_envelope`、`callback_url`、`callback_token`。
- accepted receipt 必须为 HTTP 202 且逐字含 `status:"accepted"`、非空 `job_id`、匹配目标的 `actual_machine_id`、可验 `attestation`；持久化值 `executionTransport` 必须为 `fleet-worker`。
- 取消：`POST /harness/attempts/:attempt_id/cancel`，body 仅含 `lease_owner`、`lease_generation`，重复调用幂等。
- callback：Runner/Worker 使用 attempt-scoped callback token；Controller 必须先验 attempt/run/lease/head ownership 再物化 artifact/commit，不能只信 `completed` 或进程 exit code。

## 禁 mock 边清单

- `packages/brain/Dockerfile ↔ /app/config/fleet-node-profiles.json ↔ node-profile.js`：built-image smoke 必须在实际候选 image 内导入和加载，禁用 worktree mount 补件。
- `harness-skill-relay.launchKernelProcess ↔ child orchestrator/run.js ↔ Postgres initiative_runs/heartbeat`：必须真实 spawn、真实 handshake、真 Postgres；不得 mock PID、child ready frame 或 heartbeat。
- `harness-relay-watchdog ↔ launchKernelProcess ↔ harness_attempts/initiative_run_events`：恢复成功计数与事件只能在真实 acknowledged readiness 后落库。
- `remote-bridge-transport ↔ fleet-worker.cjs ↔ attempt-runner.cjs ↔ exact Runner image`：必须真 HTTP、真 Docker/OrbStack、真 pinned digest；只允许在单独 mutation case 替换外部下载速度。
- `install-fleet-worker.sh ↔ macOS identity/ACL/LaunchDaemon/OrbStack`：真实 macOS transaction 验收不得 mock `dscl`、ACL、launchctl、Docker bind。
- `Fleet Worker callback/artifact transfer ↔ Controller ground-truth/Git`：必须传真实 commit/bundle、验 SHA/branch/task ownership 并在 cleanup 前物化。
- `migration 367+ ↔ production-shaped Postgres harness_attempts CHECK ↔ attempt-store`：真 Postgres upgrade/rollback，禁止内存 schema。
- `fleet-rollout.sh/CD ↔ Worker admission ↔ Brain publication`：必须用真实 rollout plan 和 publication gate，禁模拟 health JSON。
- `anchor-check ↔ DevOps Map DB`：真 Postgres semantic existence/ownership 校验，禁语法 UUID 替身。

## 未覆盖真实链路清单

- Xian macOS/Tailscale 维护：外部 blocker；本 sprint 只产生真实探测的 blocked evidence，owner 为 Xian host operator，修复后在 `xian-mac-m4` 与 `xian-mac-m1` 重跑 admission/canary。
- owner approval：自动化只能验证 exact-head 签名与权限，不能替人批准；owner 必须在 Draft head 上显式授权后才允许 Draft→Ready/merge。
- 除上述两项外，本合同不允许 force/stub/假数据替代 Golden Path；slow-phase 与 mutation 是对真实模块注入受控故障，不是成功链路豁免。

## 接缝清单

1. OrbStack 以 login user 代理访问 host bind，而 Worker 为 UID 450、Runner 为 image 声明的 runtime UID/GID：在真实 US Mac 上用 exact digest 验 mode-0600 sentinel、secret、Git object、stdout 与 cleanup；未真验只能标 `logic-done-pending`。
2. Brain→Worker→Runner→callback/commit transfer→Controller ground-truth：在真实 US Worker + staging Brain 跑一个真实 Attempt；未真验只能标 `logic-done-pending`。
3. Brain restart 后 Kernel no-session recovery：在 staging/production canary 真 Postgres 与真子进程上验唯一 replacement、fresh heartbeat、`resumed=1`；未真验只能标 `logic-done-pending`。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能需求 | 把 Brain image、Runner/Profile/Worker/schema、Mac 安装事务、remote transport、artifact handoff、Kernel readiness/watchdog、Worker-first rollout/rollback 收敛成单一 durable recovery 合同。 |
| **NFR（做得多好）** | 性能/可靠性 | 每 phase 有独立有界预算，总 startup budget 小于 Attempt lease/deadline；同一 idempotency key 最多一个活跃 Attempt/Kernel/provider；错误码有界且无 secret。 |
| **Invariant（永不违反）** | 安全/一致性 | secret 不进 env/argv/layer/log/payload/callback/worktree/git；profile/digest 不降级；CI Green 不授权 merge；失败不记 resumed/ready。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下表。 |
| **保质期（何时过期）** | 版本/证据时效 | admission、owner approval、CI/Evaluator/Judge 证据绑定同一 Draft head；Runner/Profile/Worker generation 任一变化即整体过期。 |
| **死亡告警（停了谁知道）** | 失效通知 | launch/recovery/publication/rollback 任一失败写结构化 P0/P1 evidence；owner 与 on-call 在一个 rollout phase 内获知，禁止 warning 降级。 |
| **失败语义（挂了怎么办）** | fail closed | 阻断 dispatch/publication/merge，取消进行中的 launch，幂等 cleanup；旧 Brain rollback 后 drain Kernel dispatch 直到 roll-forward。 |
| **效果确认（已发≠已生效）** | 真实生效 | Worker 需 authenticated health+admission，Attempt 需 accepted/ready/callback+canonical artifact，Kernel 需 handshake+persisted heartbeat，merge 需 exact-head owner approval。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Worker 可派发 | A. HTTP 200；B. 鉴权 health 的 `base_admitted && dispatch_ready` 且 generation/digest 匹配 | B | HTTP 200 不代表 immutable contract admitted | 错发到不兼容 Worker，丢任务或泄密 |
| ⚠️ single-use secret 已安全消费 | A. container 启动；B. authenticated consumption receipt + tmpfs `auth.json` 0600 + source 删除 + residue scan | B | 启动不能证明凭据可用或无残留 | 凭据泄漏或 Attempt 假成功 |
| ⚠️ Kernel 已就绪 | A. PID 分配；B. child ready/ownership frame + 初始 heartbeat 真 Postgres 持久化 | B | PID 可在 import 失败前产生 | watchdog 假恢复、重复 Kernel |
| ⚠️ remote planner 产物已成为 ground truth | A. callback completed；B. 签名 commit/bundle 经 SHA/branch/task ownership 校验后物化到 Controller 再 cleanup | B | callback 成功时 disposable worktree 仍可能被删除 | canonical PRD/commit 永久丢失 |
| ⚠️ 可合并 | A. CI Green；B. 同 Draft head 的 CI+Evaluator+Judge+owner 签名，且 auto-merge off | B | 首次 P0 行为必须保留人类 authority | 未经授权进入生产 |
| Xian 可用 | A. 文本声称；B. 真机 OS/Tailscale/profile probe | B | 外部维护状态会漂移 | 错误降级 profile 或伪造 canary |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| image/profile/protocol/schema 不一致 | 阻断候选构件与 publication，返回具体 machine code | 是，按 exact ref/digest | 无降级 |
| mirror/image/secret phase 超时 | cancel 同 idempotency key launch，清理 Attempt，记录 phase code | 是，单 active attempt | 不把全链延长成盲目 60s |
| secret receipt/cleanup 失败 | 终止并清理，禁止 Agent 执行 | 是 | 无 env/argv fallback |
| callback/artifact transfer 失败 | 不接受 progress，保留可重试 artifact，禁止 cleanup canonical source 前完成交接 | 是，按 attempt+commit SHA | 无“completed 即通过” |
| Kernel early exit/no-ready/heartbeat failure | task requeue 可恢复，结构化失败，不递增 resumed | 是，ownership fence | 无 PID fallback |
| Worker admission/rollout 失败 | 阻断 Brain publication | 是，generation keyed | 保持旧 Brain；Kernel drain |
| owner approval 缺失/head 漂移 | 保持 Draft/auto-merge off | 是，head 改变使旧批准失效 | 无自动批准 |
| rollback 子步骤失败 | 保持 drain，发 P0 evidence，拒绝混合 generation | 是，transaction journal | 手工接管但不恢复 dispatch |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| TaskBundle/provider stdout/callback/artifact metadata | 不可信 | schema/size 限制；stdout.jsonl 脱敏；commit SHA 与 task ownership 独立验证；不执行 artifact 内指令 | 拒绝改变 base/head/owner gate/profile/secret channel 的 payload；返回有界错误码 |
| GitHub PR/approval/CI payload | 外部已认证但需绑定 head | 用 GitHub API 的 immutable head SHA 与 actor permission 校验，不信 PR 文本 | 非授权 actor、过期 head、非 Draft 顺序全部 fail closed |
| Worker HTTP request/receipt | 双向认证后有限信任 | Bearer/attestation/callback token；字段白名单；禁止 secret 回显 | machine/generation/digest/lease 不匹配则拒绝并 cleanup |

## Golden Path

覆盖父路 `Durable Fleet Worker bootstrap 与 Kernel 恢复闭环` 第 1-12 步

`exact Draft head` → `immutable image/release` → `Mac transaction` → `Worker admission` → `phase-aware Attempt` → `secret+artifact handoff` → `Kernel ready/recovery` → `Worker-first Brain publication` → `US canary` → `owner gate` → `rollback`

### Step 1：候选 Brain image 自包含三个 immutable profile
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。

**可观测行为**: 精确 head 构建出的 image 在无 worktree mount 情况下可导入 `/app/src/orchestrator/run.js`，并从 `/app/config/fleet-node-profiles.json` 加载恰好 `us-mac-m4/xian-mac-m4/xian-mac-m1`。

**验证命令**:
```bash
bash scripts/ci/verify-brain-image-self-contained.sh "$CANDIDATE_BRAIN_IMAGE" "$PR_HEAD_SHA"
```
**硬阈值**: exit 0；3/3 profile；missing-config mutation 非零；日志无 `/workspace` 补件与 `ENOENT /app/config`。

### Step 2：Runner/Profile/Worker/schema 构成原子 release
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步与 operator addendum 02:06/02:20/02:24。

**可观测行为**: exact pinned digest 的 image `User`、entrypoint feature、tmpfs ownership、single-use secret receipt 与 Worker generation 对齐；migration 367+ 允许并只新增 `fleet-worker`，upgrade/rollback/source parity 通过。

**验证命令**:
```bash
bash scripts/ci/verify-fleet-release-atomic.sh "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA" "${DB_URL:?}"
```
**硬阈值**: exact digest 可复现；旧 digest/uid mutation/缺 feature/缺 enum/mismatched ref 各自非零；真 Postgres upgrade+rollback 通过。

### Step 3：macOS/OrbStack installer 是精确可回滚事务
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步与 addendum 02:11/02:14。

**可观测行为**: root-owned 0700 staging、DSCL 幂等身份、login-user OrbStack、shared protected root、每级最小 ACL、deterministic TMPDIR、credential-envelope/plist/scripts/toolchain 全部 journaled；rollback 只撤销本次 mutation。

**验证命令**:
```bash
ssh "$US_WORKER_SSH" "sudo -n /usr/local/libexec/cecelia/kernel-fleet-transaction-verify --candidate '$CANDIDATE_BUNDLE_REF' --mutations all --rollback"
```
**硬阈值**: 事务与每个独立 mutation 都给 exit code；rollback 后 plist/scripts/toolchain/ACL byte-for-byte/entry-for-entry 等于 before snapshot；无混合 generation。

### Step 4：Worker-first admission 使用真实 Attempt 合同
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步。

**可观测行为**: 鉴权 `/health` 返回与候选 exact ref 对齐的 `base_admitted=true`、`dispatch_ready=true`；health 实跑与 Attempt 相同 root/mount/ACL/UID/GID/secret/cleanup，而非模拟 JSON。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-worker-admission.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
```
**硬阈值**: authenticated semantic fields 全匹配；bad token/stale digest/private root/missing ACL mutation 全部 fail closed；一次 disposable container 后 residue=0。

### Step 5：生产 transport 与 DevOps Map anchor 预检 fail closed
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、10 步及 R5 live Red。

**可观测行为**: remote-enabled、callback、US/Xian URL DNS/连通、immutable profiles、真实 journey/gp/step ownership 全部校验；Xian 不满足时输出 blocked evidence，但不降低 profile。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" "${REAL_JOURNEY_ID:?}" "${REAL_GP_ID:?}" "${REAL_STEP_ID:?}"
```
**硬阈值**: US path ready；虚构 UUID、错误 ownership、不可达 URL、remote-disabled 各自非零；Xian 维护差距 machine-readable `blocked_external`。

### Step 6：phase-aware transport 只创建一个 Attempt
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步与 addendum 02:15/02:17。

**可观测行为**: accepted/startup lease 先返回；mirror/image/secret 分阶段预算均小于 Attempt lease/deadline；timeout/cancel 后无重复或 orphan Attempt/provider/container。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-phase-budgets.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" slow-mirror slow-image slow-secret
```
**硬阈值**: 每个 mutation 有不同非敏感 phase code；每个 idempotency key active count≤1；cleanup residue=0；所有 phase 预算和 < lease。

### Step 7：Mac-compatible secret、Git auth、stdout 与 canonical artifact handoff
**来源**: `[FROM_PRD]` — PRD 第 7 步与 addendum 02:22、R5 live Red。

**可观测行为**: Docker-mediated single-use secret 在 Runner 自有 tmpfs 生成 0600 auth，Brokered GitHub auth 可 push/fetch；Runner 可写 attempt 三目录和 stdout，但 shared roots 只读；callback 前将签名 commit/bundle 物化至 Controller，之后才 cleanup。

**验证命令**:
```bash
bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
```
**硬阈值**: 真实 Attempt accepted→ready→callback→canonical commit；`gh auth`/push/fetch 成功；secret/residue scan=0；missing read ACL/private `/var/lib`/absent reader/bad auth/cleanup-before-transfer 各自非零且可重试。

### Step 8：Kernel launch 以 handshake+heartbeat 判 ready
**来源**: `[FROM_PRD]` — PRD Golden Path 第 8 步。

**可观测行为**: missing/relative/nonexistent/non-Git/unmounted worktree 在 spawn 前拒绝；async spawn error、early exit、no-ready、timeout 均结构化失败；诊断有界脱敏；只有 ownership ready frame 和真 PG 初始 heartbeat 后 resolve。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js --reporter=verbose
```
**硬阈值**: 正控真 child+真 PG 通过；7 个负控各自 Red→Green；诊断≤2048 bytes 且 secret sentinel 0 命中。

### Step 9：Watchdog truthful recovery 严格一次
**来源**: `[FROM_PRD]` — PRD Golden Path 第 9 步。

**可观测行为**: 初启与 watchdog 共用 Step 8 contract；失败不递增 `resumed`/不发 `reconcile-restarted`，仍可恢复；成功后才 `resumed=1`，仅一个 replacement/provider Attempt。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose
```
**硬阈值**: 真 PG 多轮扫描；失败轮 resumed=0、active=0/1 可恢复；成功轮 resumed=1、replacement=1、event=1、下一次 dispatch completed。

### Step 10：Worker admission 先于 Brain publication
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、10 步。

**可观测行为**: CD 在 Worker candidate admitted 前绝不发布依赖它的 Brain；ordering mutation 明确阻断。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-worker-first-rollout.sh "$CANDIDATE_BUNDLE_REF" "$US_WORKER_URL" "$FLEET_TOKEN_FILE"
```
**硬阈值**: journal 中 `worker_admitted` 严格早于 `brain_published`；admission-failure counterfactual 的 publication count=0。

### Step 11：真实 US staging + production canary 完成 restart/recovery/dispatch
**来源**: `[FROM_PRD]` — PRD Golden Path 第 10 步及完成定义。

**可观测行为**: staged Brain restart 后无会话 Kernel 恰有一个 replacement、fresh heartbeat、`resumed=1`、无 `/app/config` ENOENT/重复 Attempt，随后正常 dispatch；证据绑定 exact head/digests。

**验证命令**:
```bash
bash scripts/kernel-fleet/run-us-durable-recovery-canary.sh "$PROD_BRAIN_URL" "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$PR_HEAD_SHA"
```
**硬阈值**: replacement=1、resumed=1、provider_attempt=1、heartbeat age≤30s、next dispatch completed≤Attempt deadline、secret scan=0。

### Step 12：Draft exact-head owner gate 与 rollback/drain
**来源**: `[FROM_PRD]` — PRD Golden Path 第 11-12 步。

**可观测行为**: PR 始终 Draft、auto-merge off；CI/Evaluator/Judge/owner approval 全绑定 exact head，授权 owner 才可 Ready/merge。rollback 恢复旧 Worker/Brain/ACL/toolchain 并保持 Kernel drained。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh "$PR_NUMBER" "$PR_HEAD_SHA" "$OWNER_APPROVAL_ID" "$US_WORKER_SSH"
```
**硬阈值**: 非 owner/旧 head/仅 CI Green 均 merge count=0；rollback diff=0（预期 drain marker 除外），dispatch blocked，roll-forward 后才解除 drain。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: agent_remote  
**target_environment**: linux_server

```bash
#!/bin/bash
set -euo pipefail

: "${PR_NUMBER:?}"
: "${PR_HEAD_SHA:?}"
: "${OWNER_APPROVAL_ID:?}"
: "${CANDIDATE_BRAIN_IMAGE:?}"
: "${CANDIDATE_RUNNER_REF:?}"
: "${CANDIDATE_BUNDLE_REF:?}"
: "${US_WORKER_URL:?}"
: "${US_WORKER_SSH:?}"
: "${FLEET_TOKEN_FILE:?}"
: "${PROD_BRAIN_URL:?}"
: "${DB_URL:?}"
: "${REAL_JOURNEY_ID:?}"
: "${REAL_GP_ID:?}"
: "${REAL_STEP_ID:?}"

test "$(git rev-parse HEAD)" = "$PR_HEAD_SHA"
test "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" = "$PR_HEAD_SHA"
test "$(gh pr view "$PR_NUMBER" --json isDraft --jq .isDraft)" = "true"
test "$(gh pr view "$PR_NUMBER" --json autoMergeRequest --jq '.autoMergeRequest == null')" = "true"

bash scripts/ci/verify-brain-image-self-contained.sh "$CANDIDATE_BRAIN_IMAGE" "$PR_HEAD_SHA"
bash scripts/ci/verify-fleet-release-atomic.sh "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA" "$DB_URL"
ssh "$US_WORKER_SSH" "sudo -n /usr/local/libexec/cecelia/kernel-fleet-transaction-verify --candidate '$CANDIDATE_BUNDLE_REF' --mutations all --rollback"
bash scripts/kernel-fleet/verify-worker-admission.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
bash scripts/kernel-fleet/verify-production-preflight.sh "$PROD_BRAIN_URL" "$REAL_JOURNEY_ID" "$REAL_GP_ID" "$REAL_STEP_ID"
bash scripts/kernel-fleet/verify-phase-budgets.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" slow-mirror slow-image slow-secret
bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
DB_URL="$DB_URL" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose
bash scripts/kernel-fleet/verify-worker-first-rollout.sh "$CANDIDATE_BUNDLE_REF" "$US_WORKER_URL" "$FLEET_TOKEN_FILE"
bash scripts/kernel-fleet/run-us-durable-recovery-canary.sh "$PROD_BRAIN_URL" "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$PR_HEAD_SHA"
bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh "$PR_NUMBER" "$PR_HEAD_SHA" "$OWNER_APPROVAL_ID" "$US_WORKER_SSH"

echo "OK: exact-head durable recovery E2E completed; PR remains Draft pending authorized transition"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Brain image | `tests/durable-recovery.contract.test.ts` | built image self-contained profiles | Dockerfile 未复制 config，失败 |
| Atomic release/schema | `tests/durable-recovery.contract.test.ts` | fleet-worker transport migration parity | migration 363 缺 `fleet-worker`，失败 |
| Kernel readiness | `tests/durable-recovery.contract.test.ts` | rejects invalid worktree before spawn | readiness validator 未实现，失败 |
| Watchdog truth | `tests/durable-recovery.contract.test.ts` | records resumed only after ready heartbeat | shared readiness receipt 未实现，失败 |
| Artifact handoff | `tests/durable-recovery.contract.test.ts` | materializes authenticated commit before cleanup | canonical transfer 未实现，失败 |
| Owner gate | `tests/durable-recovery.contract.test.ts` | rejects CI-only merge authorization | unified owner gate 未实现，失败 |

