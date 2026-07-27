# Sprint Contract Draft（Round 3）

## 合同 Notes

- frozen_base: `dd424a61926009ac85a915b31187124b85f0ca98`
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js`)
- context-manifest: unavailable（端点返回 404；PRD 的“累积 FR：暂无历史”作为本轮输入）
- judgment-pending-user: ⚠️ Draft PR exact-head owner approval 的授权主体与可审计签名来源
- judgment-pending-user: ⚠️ Mac-compatible single-use secret consumption receipt 的生产判定方法
- Xian `macOS 15.6.1 < 15.7.4` 与 M1 Tailscale CLI 暴露属于外部维护 blocker，只记录 blocked evidence；禁止降低 profile 或加入绕过。
- 候选 `sha256:9fc98f...`、临时 60 秒 timeout、`/tmp` copy、手工 plist/ACL/schema 扩宽均仅为 operator evidence，不是发货构件。
- R6 proposer exact SHA `e1d2c5bd370892fe70517f1137c4a3f8483c5dfb` 与 R7 exact SHA `a613ea5f0d2e931966f0064cb347b74e38a66ca2` 仅作 Red 证据；Round 3 继续收紧 R8 audit，尤其禁止 evaluator 自行 merge/触发生产。
- release-order invariant: `Draft exact head → CI → Evaluator/Judge → owner exact-head approval → authorized merge → US staging real E2E → production canary`；生产验证绝不早于批准/合并。
- semantic-anchor-resolved: 2026-07-28 生产只读 API 回读确认本任务 payload 已归属 `工厂 · F2 部署闭环` journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`、已交付 GP `环境模型三段常驻收尾（Cecelia+ZenithJoy）` `4e5fd7eb-3823-4c57-a817-081b7fdd2eed`、step `部署被证明没坏` `817f59f5-02ff-4a70-bd81-f7ae65f77e02`；GP 与 step 的 `journey_id` 均逐字等于该 journey。当前 task `4a530430-00c5-46bc-8a4f-c0ec38025391` 与本次 run `4bbe35de-63c1-4cfe-9b55-fea8c01a0647` 明确不同。Generator 点火前必须再次从生产回读同一事实；迁移/回读失败即 fail closed，不得创建 Map 行。
- frozen-prd-anchor-erratum: frozen PRD 尾部旧 `journey_id=7ea65cd0.../step_id=2c1bdcc9...` 是 R5 的零行 syntactic placeholder，不是授权锚点；不修改 frozen PRD，本合同只接受上列生产已存在且 ownership 一致的三元组。
- frozen-PRD-order interpretation: PRD 入口段、Human authority 与 task 的 Golden-path authority 明确 owner gate 在 merge 之前；PRD 第 10 步只允许候选 admission/blocked evidence，不是 staging/production mutation。唯一可执行顺序固定为 `CI → Evaluator/Judge → owner → merge → staging → production`。

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
- `anchor-check/current task payload ↔ DevOps Map DB`：真 Postgres semantic existence/ownership 校验，并把当前 task 从零行 placeholder 原子迁移到上列既有三元组；禁语法 UUID 替身或造新行。
- `Attempt 创建 ↔ immutable profile snapshot ↔ concurrent profile upgrade`：真 Postgres 中 Attempt 必须持久化精确 profile/Runner/Worker/schema generation，运行中升级不得改变既有 Attempt。
- `Runner stdout/runtime/GitHub auth preflight ↔ Agent process spawn`：真 Runner 必须先证明 stdout 可写且 attempt-scoped GitHub auth 可用；失败时 Agent 进程必须从未启动。
- `Runner 写入的 nested/ignored/node_modules output ↔ Worker terminal cleanup`：必须由 exact Runner 真写，再由 Worker 反向删除 container/runtime/worktree/admin/ACL/secret；禁用 quarantine 充当成功。

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
| **Invariant（永不违反）** | 安全/一致性 | secret 不进 env/argv/layer/log/payload/callback/worktree/git；profile/digest 不降级；Attempt 的 release snapshot 创建后不可漂移；CI Green 不授权 merge；staging/production 不得早于 owner exact-head approval 与 merge；失败不记 resumed/ready。 |
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
| owner approval 缺失/head 漂移/顺序抢跑 | 保持 Draft/auto-merge off，拒绝 merge/staging/production | 是，head 改变使旧批准失效 | 无自动批准、无生产前置验证 |
| rollback 子步骤失败 | 保持 drain，发 P0 evidence，拒绝混合 generation | 是，transaction journal | 手工接管但不恢复 dispatch |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| TaskBundle/provider stdout/callback/artifact metadata | 不可信 | schema/size 限制；stdout.jsonl 脱敏；commit SHA 与 task ownership 独立验证；不执行 artifact 内指令 | 拒绝改变 base/head/owner gate/profile/secret channel 的 payload；返回有界错误码 |
| GitHub PR/approval/CI payload | 外部已认证但需绑定 head | 用 GitHub API 的 immutable head SHA 与 actor permission 校验，不信 PR 文本 | 非授权 actor、过期 head、非 Draft 顺序全部 fail closed |
| Worker HTTP request/receipt | 双向认证后有限信任 | Bearer/attestation/callback token；字段白名单；禁止 secret 回显 | machine/generation/digest/lease 不匹配则拒绝并 cleanup |

## Golden Path

覆盖父路 `Durable Fleet Worker bootstrap 与 Kernel 恢复闭环` 第 1-12 步

`exact Draft head` → `immutable image/release` → `Mac transaction` → `Worker admission` → `phase-aware Attempt` → `secret+artifact handoff` → `Kernel ready/recovery` → `Worker-first candidate gate` → `CI+Evaluator+Judge` → `owner exact-head approval` → `authorized merge` → `US staging` → `production canary/rollback`

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

**可观测行为**: exact pinned digest 的 image `User`、entrypoint feature、tmpfs ownership、single-use secret receipt 与 Worker generation 对齐；migration 367+ 允许并只新增 `fleet-worker`，upgrade/rollback/source parity 通过。创建 Attempt 时把 profile generation、Runner digest、Worker generation、schema capability 持久化为 immutable snapshot；并发升级 profile 后既有 Attempt 仍消费原 snapshot，新 Attempt 才消费新 generation。

**验证命令**:
```bash
bash scripts/ci/verify-fleet-release-atomic.sh "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA" "${DB_URL:?}"
```
**硬阈值**: exact digest 可复现；旧 digest/uid mutation/缺 feature/缺 enum/mismatched ref 各自非零；真 Postgres upgrade+rollback 通过；concurrent-upgrade mutation 中旧 Attempt 的四元 snapshot 0 字段漂移。

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

**可观测行为**: 鉴权 `/health` 返回与候选 exact ref 对齐的 `base_admitted=true`、`dispatch_ready=true`；health 实跑与 Attempt 相同 root/mount/ACL/UID/GID/secret/cleanup，而非模拟 JSON。stdout.jsonl 与 attempt-scoped GitHub auth 必须在 Agent spawn 前通过真实 Worker→exact Runner write/gh auth probe；任一失败返回有界 machine code、持久化 `1..2048` bytes 脱敏诊断且 Agent 未启动。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-worker-admission.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
```
**硬阈值**: authenticated semantic fields 全匹配；bad token/stale digest/private root/missing ACL/unwritable stdout/missing GitHub auth mutation 全部 fail closed；Agent-start counter=0；unwritable stdout diagnostic 为 1..2048 bytes 且 secret sentinel 0 命中；一次 disposable container 后 residue=0。

### Step 5：生产 transport 与 DevOps Map anchor 预检 fail closed
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、10 步及 R5 live Red。

**可观测行为**: remote-enabled、callback、US/Xian URL DNS/连通、immutable profiles、真实 journey/golden-path/step existence 与 ownership 全部校验；当前 task 必须原子迁移到 Notes 中的既有三元组并回读，`task_id=4a530430-00c5-46bc-8a4f-c0ec38025391` 与 `run_id` 是不同构造且分别解析。Xian 不满足时输出 blocked evidence，但不降低 profile；语法合法但零生产行的 UUID 必须失败。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" \
  "4a530430-00c5-46bc-8a4f-c0ec38025391" \
  "4bbe35de-63c1-4cfe-9b55-fea8c01a0647" \
  "2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6" \
  "4e5fd7eb-3823-4c57-a817-081b7fdd2eed" \
  "817f59f5-02ff-4a70-bd81-f7ae65f77e02"
```
**硬阈值**: US path ready；当前 task 回读的 anchor 精确等于既有三元组且 task/run 不同；GP 和 step 均真实存在并属于同一 journey；虚构 UUID、零行 UUID、错误 ownership、task/run 混用、不可达 URL、remote-disabled 各自非零；Xian 维护差距 machine-readable `blocked_external`。

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

**可观测行为**: Docker-mediated single-use secret 在 Runner 自有 tmpfs 生成 0600 auth，brokered attempt-scoped GitHub auth 在 Agent 前验证并可 push/fetch；auth 的 attempt copy 在 `success|timeout|crash|cancel` 四种终态都必须 revoke+delete。Runner 可写 attempt 三目录和 stdout，但 shared roots 只读；callback 前将签名 commit/bundle 以真实 SHA/branch/task ownership 物化至 Controller，之后才 cleanup。exact Runner 再创建 nested ignored/node_modules/untracked output，Worker 必须反向清除 container/runtime/worktree/admin/ACL/secret，残留或 quarantine 都是失败。

**验证命令**:
```bash
bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
```
**硬阈值**: 真实 Attempt accepted→ready→callback→canonical commit；`gh auth`/push/fetch 成功；`success|timeout|crash|cancel` 四路 `revoked=true && attempt_copy_deleted=true && residue=0`；secret/residue/quarantine count=0；shared-root write ACL=0；missing read ACL/private `/var/lib`/absent reader/bad auth/unwritable stdout/cleanup-before-transfer/reverse-delete-denied 各自非零且可重试。

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

**可观测行为**: 初启与 watchdog 共用 Step 8 contract；失败不递增 `resumed`/不发 `reconcile-restarted`，仍可恢复；成功后才 `resumed=1`，仅一个 replacement/provider Attempt。测试必须真实 spawn child，先验证同机 live，再 kill+await exit 后由真实 `kill(pid,0)` 的 ESRCH 判 dead；远端/未知 liveness fail-open，不得误杀。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose
```
**硬阈值**: 真 PG 多轮扫描；失败轮 resumed=0、active=0/1 可恢复；成功轮 resumed=1、replacement=1、event=1、下一次 dispatch completed；same-host-live 与 unknown-host 两个反事实 replacement=0。

### Step 10：Worker admission 先于 Brain candidate 可发布状态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、10 步。

**可观测行为**: CD 在 Worker candidate admitted 前绝不把依赖它的 Brain 标为 publishable；该 gate 只准备合并后可发布候选，不得在 owner approval/merge 前触发 staging 或 production mutation。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-worker-first-rollout.sh "$CANDIDATE_BUNDLE_REF" "$US_WORKER_URL" "$FLEET_TOKEN_FILE"
```
**硬阈值**: journal 中 `worker_admitted` 严格早于 `brain_candidate_publishable`；admission-failure counterfactual 的 publishable count=0；pre-merge staging/production mutation count=0。

### Step 11：CI、Evaluator、Judge 与 exact-head owner gate 后才可 merge
**来源**: `[FROM_PRD]` — PRD Golden Path 第 12 步与 Human authority。

**可观测行为**: PR 始终 Draft 且 auto-merge off；CI、Evaluator、Judge 证据全绑定 exact Draft head，之后授权 owner 才能作 exact-head approval 和 Draft→Ready/merge。CI-only、非 owner、stale head、缺任一评估证据均保持 Draft；审批前禁止 staging/production。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh gate-only "$PR_NUMBER" "$PR_HEAD_SHA" "" "$US_WORKER_SSH"
```
**硬阈值**: audit 顺序精确为 `ci,evaluator,judge,owner,merge`；反事实 merge count=0、staging count=0、production count=0；授权后 merge head 恰为 `$PR_HEAD_SHA`。

### Step 12：authorized merge 后先 US staging，再 production canary 与 rollback/drain
**来源**: `[FROM_PRD]` — PRD Golden Path 第 10-11 步及完成定义。

**可观测行为**: 仅在 Step 11 authorized merge 后，由 controller 真实 US staging 发布 candidate，Brain restart 后无会话 Kernel 恰有一个 replacement、fresh heartbeat、`resumed=1`、无 `/app/config` ENOENT/重复 Attempt并正常 dispatch；staging 通过后才启动 production canary。rollback 恢复旧 Worker/Brain/ACL/toolchain并保持 Kernel drained。Evaluator 阶段只验证这些动作尚未发生和入口 fail closed。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh pre-merge-no-production "$PR_NUMBER" "$PR_HEAD_SHA" "" "$US_WORKER_SSH"
```
**硬阈值**: pre-merge 当前 staging/production mutation count=0；controller 后续 event 顺序必须精确为 `merge,staging_passed,production_canary_started,production_canary_passed`；replacement=1、resumed=1、provider_attempt=1、heartbeat age≤30s、next dispatch completed≤Attempt deadline、secret scan=0；rollback diff=0（预期 drain marker 除外），roll-forward 前 dispatch fail closed。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: agent_remote
**target_environment**: linux_server

```bash
#!/bin/bash
set -euo pipefail

: "${PR_NUMBER:?}"
: "${PR_HEAD_SHA:?}"
: "${CANDIDATE_BRAIN_IMAGE:?}"
: "${CANDIDATE_RUNNER_REF:?}"
: "${CANDIDATE_BUNDLE_REF:?}"
: "${US_WORKER_URL:?}"
: "${US_WORKER_SSH:?}"
: "${FLEET_TOKEN_FILE:?}"
: "${PROD_BRAIN_URL:?}"
: "${DB_URL:?}"

CURRENT_TASK_ID="4a530430-00c5-46bc-8a4f-c0ec38025391"
CURRENT_RUN_ID="4bbe35de-63c1-4cfe-9b55-fea8c01a0647"
REAL_JOURNEY_ID="2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6"
REAL_GP_ID="4e5fd7eb-3823-4c57-a817-081b7fdd2eed"
REAL_STEP_ID="817f59f5-02ff-4a70-bd81-f7ae65f77e02"

test "$(git rev-parse HEAD)" = "$PR_HEAD_SHA"
test "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" = "$PR_HEAD_SHA"
test "$(gh pr view "$PR_NUMBER" --json isDraft --jq .isDraft)" = "true"
test "$(gh pr view "$PR_NUMBER" --json autoMergeRequest --jq '.autoMergeRequest == null')" = "true"

bash scripts/ci/verify-brain-image-self-contained.sh "$CANDIDATE_BRAIN_IMAGE" "$PR_HEAD_SHA"
bash scripts/ci/verify-fleet-release-atomic.sh "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA" "$DB_URL"
ssh "$US_WORKER_SSH" "sudo -n /usr/local/libexec/cecelia/kernel-fleet-transaction-verify --candidate '$CANDIDATE_BUNDLE_REF' --mutations all --rollback"
bash scripts/kernel-fleet/verify-worker-admission.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
bash scripts/kernel-fleet/verify-production-preflight.sh \
  "$PROD_BRAIN_URL" "$CURRENT_TASK_ID" "$CURRENT_RUN_ID" "$REAL_JOURNEY_ID" "$REAL_GP_ID" "$REAL_STEP_ID"
bash scripts/kernel-fleet/verify-phase-budgets.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" slow-mirror slow-image slow-secret
bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
DB_URL="$DB_URL" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose
bash scripts/kernel-fleet/verify-worker-first-rollout.sh "$CANDIDATE_BUNDLE_REF" "$US_WORKER_URL" "$FLEET_TOKEN_FILE"

# 严格发布门：本脚本是 Evaluator/Judge 的 pre-merge final-e2e，只产生候选证据。
# owner approval、Draft→Ready、merge、staging、production 属 controller 的后续 ws11/ws12；
# evaluator 无权消费 OWNER_APPROVAL_ID、执行 merge 或触碰 staging/production。
bash scripts/kernel-fleet/verify-exact-head-evidence.sh \
  "$PR_NUMBER" "$PR_HEAD_SHA" ci evaluator judge
bash scripts/kernel-fleet/verify-owner-gate-and-rollback.sh \
  pre-merge-no-production "$PR_NUMBER" "$PR_HEAD_SHA" "" "$US_WORKER_SSH"
bash scripts/kernel-fleet/verify-release-sequence.sh \
  --observed "$PR_HEAD_SHA" ci evaluator judge \
  --required-future owner merge staging production

test "$(gh pr view "$PR_NUMBER" --json isDraft --jq .isDraft)" = "true"
test "$(gh pr view "$PR_NUMBER" --json autoMergeRequest --jq '.autoMergeRequest == null')" = "true"

echo "OK: pre-merge CI→Evaluator/Judge exact-head evidence complete; owner→merge→staging→production remains controller-gated"
```

### 合并后受权执行合同（不由 Evaluator 运行）

`ws11` 由 controller 验证授权 owner 对 `$PR_HEAD_SHA` 的明确批准并执行唯一 Draft→Ready/merge；
`ws12` 只有在 merge commit 包含该 exact head 后，才按固定入口依次执行
`run-us-durable-recovery-canary.sh staging`、`run-us-durable-recovery-canary.sh production`、
`verify-owner-gate-and-rollback.sh rollback-only`。任一步缺少 owner/head/merge 前序证据必须非零退出。
本段是后续 controller 状态机合同，不放入 E2E bash 块，避免 evaluator 拼接后越权执行。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| P0 durable recovery（唯一收集项） | `tests/durable-recovery.contract.test.ts` | `built image self-contained profiles`; `immutable per-attempt profile snapshot across concurrent upgrade`; `real Worker Runner seam before Agent execution`; `GitHub auth on success timeout crash and cancel`; `fleet-worker transport with production upgrade rollback and source enum parity`; `ownership frame plus persisted heartbeat`; `authenticated callback commit before Worker cleanup`; `reverse cleanup removes real Runner nested and ignored output`; `ESRCH-only local liveness death`; `CI-only authorization and stale exact-head owner approval`; `semantic anchor resolves journey golden-path step ownership` | 11 个唯一 `it()`；每个覆盖名都是对应 `it()` 名的字面子串。collector 按 realpath 去重后文件数必须为 1。现状分别缺 built-image contract、snapshot、真实 stdout seam、四终态 auth cleanup、migration 367+ parity、readiness、artifact transfer、reverse cleanup、ESRCH dead、owner gate、semantic anchor，因此产生 Red。 |

**测试库存硬阈值**: `find tests -name '*.test.ts' -print0 | xargs -0 realpath | sort -u` 的唯一文件数 = 1；上述覆盖名各自只映射一个唯一 `it()`，总数 = 11；不得把同一路径通过 sprint glob 与显式路径重复计数。migration `fleet-worker` enum parity Red 必须保留。

**测试库存验证命令**:
```bash
TEST_ROOT="sprints/07280225-kernel-fleet-durable-recovery-r5/tests"
UNIQUE_FILES=$(find "$TEST_ROOT" -name '*.test.ts' -print0 | xargs -0 realpath | sort -u | wc -l | tr -d ' ')
IT_COUNT=$(rg -c '^[[:space:]]*it\(' "$TEST_ROOT/durable-recovery.contract.test.ts")
[ "$UNIQUE_FILES" -eq 1 ] && [ "$IT_COUNT" -eq 11 ]
rg -q 'fleet-worker transport with production upgrade rollback and source enum parity' \
  "$TEST_ROOT/durable-recovery.contract.test.ts"
for COVER in \
  'built image self-contained profiles' \
  'immutable per-attempt profile snapshot across concurrent upgrade' \
  'real Worker Runner seam before Agent execution' \
  'GitHub auth on success timeout crash and cancel' \
  'fleet-worker transport with production upgrade rollback and source enum parity' \
  'ownership frame plus persisted heartbeat' \
  'authenticated callback commit before Worker cleanup' \
  'reverse cleanup removes real Runner nested and ignored output' \
  'ESRCH-only local liveness death' \
  'CI-only authorization and stale exact-head owner approval' \
  'semantic anchor resolves journey golden-path step ownership'
do
  grep -F "$COVER" "$TEST_ROOT/durable-recovery.contract.test.ts" >/dev/null
done
```
