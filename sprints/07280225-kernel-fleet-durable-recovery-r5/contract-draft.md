# Sprint Contract Draft（Round 16）

## 合同 Notes

- frozen_base: `dd424a61926009ac85a915b31187124b85f0ca98`
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js`)
- context-manifest: unavailable（端点返回 404；PRD 的“累积 FR：暂无历史”作为本轮输入）
- judgment-pending-user: ⚠️ Draft PR exact-head owner approval 的授权主体与可审计签名来源
- judgment-pending-user: ⚠️ Mac-compatible single-use secret consumption receipt 的生产判定方法
- Xian `macOS 15.6.1 < 15.7.4` 与 M1 Tailscale CLI 暴露属于外部维护 blocker，只记录 blocked evidence；禁止降低 profile 或加入绕过。
- 候选 `sha256:9fc98f...`、临时 60 秒 timeout、`/tmp` copy、手工 plist/ACL/schema 扩宽均仅为 operator evidence，不是发货构件。
- 先前 proposer heads 均仅作 Red 证据；Round 16 保留 R32-R47 修正，并新增 R48：
  Reviewer 自报 APPROVED 不具权威，必须由 Controller 对 durable result-channel、七维评分、
  task-intent revision、skill/policy digest、Contract Gate 与 Red inventory 做确定性批准；
  Reviewer 无 mutation credential；当前 workstream 只能 serial single writer。
- R46-reviewer-interface: 七维 rubric key 必须字面等于
  `dod_machineability,scope_match_prd,test_is_red,internal_consistency,risk_registered,
  verification_oracle_completeness,ci_workflow_alignment`；未知、改名、缺失或低于 7 均拒绝。
- R47-target-quarantine: target exclusion 绑定
  `run_id+role+logical_cycle_id+target+failure_class` 并带 TTL/reset；每次 selection 写完整
  append-only receipt。旧 cycle 的 transport failure 不得永久毒化恢复后的 target；
  `all_execution_targets_exhausted` 是可恢复基础设施阻塞，不因重复字符串硬失败 run。
- R48-independent-oracle: verifier 自写 `--evidence-dir` JSON/stdout 一律
  `count_toward_authorization=false`。P0/P1 正控只能由不同 trust-domain observer 从真实
  append-only API/PG store 回读 receipt/raw artifact，独立重算 canonical
  receipt/artifact/predecessor digest 与 before/after effect；环境不可用必须 BLOCKED。
- R48-exact-counterfactuals: Reviewer 七键集合严格等于生产接口且每项为整数 7..10；
  fake temp JSON/stdout、13×11 duplicate/missing、binding mutation、same observer、
  predecessor reorder、invented/unknown/missing rubric key 六类均 non-authorizing。
- R48-real-target-replay: target recovery 必须在真 PG 重放
  `cycleA team4 transport fail → cycleB team3 transport fail + team5 quota →
  cycleC team4 fresh Green`，同一 run 选回 team4；禁止 mocked `decisions.push` 或空数组
  `every()`。Contract Gate 必须拒绝 R14/R15 self-attestation/permanent flat
  failed_targets/exhausted hard-fail fixture。
- R41-test-oracle: verifier stdout、fixture 自带 summary、被测模块返回 boolean/array/count/hash
  均不可单独证明 P0。每个 planned verifier 必须调用真实生产 seam，测试随后从独立
  Git object/PG/GitHub/deployment/effect store 重算；缺 planned module 只允许产生该模块一条
  精确 Red，不能由共享 dynamic import/config/SQL/env 错误把整套测试染红。
- R42-guard-authority: `packages/quality/contracts/kernel-guard-manifest.json` 只存 law；
  `guard_evidence_receipts` append-only 存 D/A/F/E。clean-home proof 只运行官方 installer
  与真实 Kernel launcher，Claude/Codex/Grok 相同 V01-V13 vector 必须得到相同
  decision/reason/effect，并由不同 observer 验 protected effect。
- merge-authority: `ci.yml` auto-merge、main-push/scheduled/Fast-Lane/manual deploy 都不得成为
  第二 authority；first/new/high-risk/authority change 只能由 versioned Controller policy
  要求 exact-head owner receipt。
- runtime-result-channel-blocker: 本次 TaskBundle 没有注入 `BRAIN_RESULT_FILE`；source checkout 的 `.brain-result.json` 不具 authority。本轮只提交合同 branch，不能凭 source result 授权 Generator；修复后必须由真实 Reviewer Attempt 产生 `attempt.result.result_channel_receipt` 且完成 durable ack。
- inventory-authority: exact main `dd424a61926009ac85a915b31187124b85f0ca98:packages/engine/regression-contract.yaml` blob `7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3` 是唯一既有 P0/P1 source inventory，exact 129/P0=66/P1=63/digest=`4fcdf146ad08ab0ba349d789084fad6d85902b0e345993fb7ddf9057899a1e5f`；`packages/quality/contracts/` 是唯一 authority boundary。
- lifecycle-proposal-provenance: Draft+CONFLICTING PR #4372 的 full source `4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13` 只是 proposed v1；分布 `0,2,2,8,6,0,1,110` 与 digest `be80793527a817611ba0698654ea858eda7c77ea9e63da937cba7b885a4d9363` 不 canonical。main migration 366 已占用；执行前重查 tree/DB 后选择未用 `>=368` 编号。
- migration-filename: 本轮 re-fetch exact origin/main `dd424a...` 确认 tree 最大编号为 366；
  依据 operator production evidence 也为 366，合同冻结候选文件
  `368_kernel_harness_authority.sql`。当前 proposer 环境的 production DB 不可达，因此
  Generator 在任何写入前必须再次同时查询 origin/main 与 production `schema_versions`；
  若 368 已占用，必须返回 authority-manifest revision 重新签名，禁止静默改号或继续执行。
- lifecycle-ssot-ref: `kernel_harness_f1_baseline/S0-S12@${PR_HEAD_SHA}`；F2 产品锚点仍是 `工厂 · F2 部署闭环/部署被证明没坏`，两者分别记录为 `product_anchor` 与 `lifecycle_ssot_ref`，F2 step 不得冒充 F1 全生命周期。
- lifecycle-matrix invariant: S0-S12 只有在 owner exact-head 批准 proposal v1 后才 canonical；
  law manifest 定义 13×11=143 requirements 但不存 state/color；同 Journey projection 保留六历史
  行全部 legacy 列与时间戳并新增九行。current state 只由 append-only cell evidence 在查询时
  派生，authority approval 不等于行为 pass。
- terminal-accounting invariant: S12 只消费从已批准 classification/applicability 动态派生且逐条验签的 exact obligations；`unreviewed=0`、rejected 已闭合、missing/pending/blocked/stale/expired/inferred/duplicate=0。固定 1161/18 已撤销，候选 unified IDs 只有 owner 冻结后才产生 obligation。
- proof-origin invariant: stage receipt 按 `brain_task_event|signed_intent_snapshot|harness_attempt|harness_attempt_quorum|harness_attempt_with_pr|github_check_suite|github_owner_review|github_merge_event|deployment_receipt|brain_atomic_accounting` 分型直查真实源，禁止把非 Agent receipt 强制过通用 Attempt 校验。
- result-channel invariant: TaskBundle 的 server-derived descriptor 由 Worker 解析为 runtime-root 内 mode-0600 路径并注入唯一 `BRAIN_RESULT_FILE`；role 直接来自 TaskBundle top-level 字段。生产尚无 `CURRENT_ROLE` env，缺该 env 不能作为 Red oracle。
- release-order invariant: `Draft exact head → CI → Evaluator/Judge → owner exact-head approval → authorized merge → US staging real E2E → production canary`；生产验证绝不早于批准/合并。
- semantic-anchor-resolved: 2026-07-28 生产只读 API 回读确认本任务 payload 已归属 `工厂 · F2 部署闭环` journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`、已交付 GP `环境模型三段常驻收尾（Cecelia+ZenithJoy）` `4e5fd7eb-3823-4c57-a817-081b7fdd2eed`、step `部署被证明没坏` `817f59f5-02ff-4a70-bd81-f7ae65f77e02`；GP 与 step 的 `journey_id` 均逐字等于该 journey。当前 TaskBundle task 固定为 `4a530430-00c5-46bc-8a4f-c0ec38025391`，current run 必须从不可变 TaskBundle 动态读取且与 task 不同；任何历史 run UUID 都不可成为成功前提。historical failed run `4bbe35de-63c1-4cfe-9b55-fea8c01a0647` 只可出现在拒绝反事实。Generator 点火前必须再次从生产回读；迁移/回读失败即 fail closed，不得创建 Map 行。
- authoritative-prd-corrected: 本轮已将权威 PRD 的顺序和锚点改成唯一可执行事实；合同不再解释或保留零行 placeholder。
- release-workflow-closure: `.github/workflows/kernel-fleet-p0-gate.yml` 是 P0 唯一授权 receipt 生产者；`brain-ci-deploy.yml`、`auto-staging-deploy.yml`、`deploy.yml`、`ci.yml` 必须消费它或 fail closed，不得保留 main-push/Fast Lane/skipped staging/title auto-merge 旁路。
- cleanup-order invariant: `confirm container absent → reverse normalize exact Runner-writable descendants → host cleanup workspace/admin → runtime/secret cleanup → state delete`；container removal 未确认则原地 `cleanup_blocked`，不得移动挂载证据。
- controller-ownership invariant: 每个 active `run_id` 只有一个通用 Kernel Controller owner；`owner_id+generation` CAS fence 覆盖 heartbeat/intent/dispatch/merge/control，PID/host 仅诊断。
- required-check invariant: P0 分类来自不可伪造的 task/PR receipt，不信可变 title/label；required exact-head check、owner signature、真实 GitHub API 回读的 run ID/check-suite ID/actor 与签名 repository-rule snapshot 必须同 head，模块返回的合成数组/布尔值不是证据。
- origin-proof invariant: Attempt origin 不得由 `exists:true` 自证；verifier 只查询现有列 `id,run_id,role,provider,provider_session_id,actual_machine_id,lease_generation,status,task_bundle,result`，contract/head 从 authenticated TaskBundle/result receipt 派生，禁止查询不存在的 `actual_machine/contract_sha/exact_head_sha`。
- activation-proof invariant: canonical applicability manifest 必须列具体 production entrypoint 和 wiring hop；required keys 由 verifier 独立读取该 manifest 生成，observed keys 只从 authenticated fire receipt bodies 派生。installer source、installed/symlink target 与 provider-neutral Kernel dispatcher 都是实现文件，不得用符号标签代替。
- aggregate-binding invariant: S12 的 legacy/family/activation/credential 聚合 receipt 必须包含原始 receipt IDs 与 canonical serialization 的 receipt-set digest；terminal verifier 从已独立验签 bodies 重算，任何 body 或 aggregate mutation 都保持 non-complete。
- contract-approval-v2 invariant: 只有 clean completed Reviewer Attempt、七个固定 rubric
  dimension 均为整数且 `>=7`、R31 durable result-channel ack、同一 frozen task-intent
  revision/digest 与 Controller 独立 Contract Gate/Red evidence 全绿，确定性 policy 才能写
  approval；model outcome/prose、completed_with_concerns、stale intent/head/skill/lease 均为拒绝。
- reviewer-effect-isolation invariant: Reviewer 无 Brain/GitHub/deploy mutation credential；
  registry/decision/task/PR/merge/deploy/staging/production POST 均由 egress policy 拒绝并留
  deny receipt。judgment/outbox 仅在 verified approval 后由 Controller 恰一次写入。
- execution-mode invariant: 本合同 task-plan 虽按 gate 分段，但当前明确
  `serial_single_writer/parallel_width=1`，全部 `depends_on` 构成一条链。没有
  FrozenWorkstreamPlan/WorkstreamState/IntegrationLease 前，segment PASS、空闲 slot 与多 task
  不得声称并行或 global PASS。

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
- `[packages/brain/src/lib/kernel-liveness.js]` → 这是已部署 liveness SSOT；本次只能扩展该文件及现有消费者，禁止新建平行 `orchestrator/kernel-liveness.js`。
- `[packages/brain/src/startup-sync.js]` → 当前查询 production 不存在的 `initiative_runs.tmux_session`，Brain startup 无法可靠 reconcile；必须与 watchdog/manual 共用 `ensureKernelController(run)`。
- `[packages/brain/src/orchestrator/loop.js]` → 当前 `blocked_same_state` 会把基础设施 admission/configuration 阻塞误计入语义失败 streak。
- `[.github/workflows/scripts/should-auto-merge.sh]` → 当前依赖可变 `feat(harness):` 标题分类，不能构成 P0 merge authority。
- `[.github/workflows/brain-ci-deploy.yml]` → 当前 `push:main` 可独立部署 production；P0 必须改为消费 exact-head merge+staging receipt。
- `[.github/workflows/auto-staging-deploy.yml]` → 当前 `skipped_*`/长时间 `idle` 可记成功；P0 必须非零失败。
- `[.github/workflows/deploy.yml]` → 当前 Fast Lane/定时/手动可直达 production；P0 必须禁旁路并依赖 staging receipt。
- `[.github/workflows/ci.yml]` → 当前通用 CI 不产 P0 exact-head evidence receipt；本次补统一 gate 接线且禁止 title/label auto-merge。
- `[packages/brain/src/orchestrator/loop.js]` → 当前 `callback_result_path` 缺失时回退 `.brain-result.json`；read-only Runner 会 EROFS，source 中陈旧结果还能跨轮污染，必须改为 pre-Agent fail-closed 的 attempt runtime channel。
- `[PR #4372 / origin/cp-07271751-51836fb2@4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13]` → proposal v1 只是待审批迁移输入；其 lifecycle/family mapping 不是历史或 canonical truth。
- `[packages/brain/migrations/366_kernel_harness_failure_class.sql]` → main 已占用 migration 366；F1 baseline 必须 renumber 到 368+，执行 fresh/production-like upgrade+rollback，禁止覆盖或并行保留冲突的 366。
- `[root regression-contract.yaml]` → `kernel_harness_f1_baseline` 必须与唯一 lifecycle manifest、DB rows、runtime API/report 同源 parity；不存在的 cell 不得由文档默认补绿。
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
- `anchor-check/current TaskBundle ↔ current run/attempt/contract/head receipt ↔ DevOps Map DB`：真 Postgres semantic existence/ownership 校验并回读当前 task 已迁移的既有三元组；禁历史 run 授权、task-as-run、cross-run artifact、语法 UUID 替身或造新行。
- `Attempt 创建 ↔ immutable profile snapshot ↔ concurrent profile upgrade`：真 Postgres 中 Attempt 必须持久化精确 profile/Runner/Worker/schema generation，运行中升级不得改变既有 Attempt。
- `Runner stdout/runtime/GitHub auth preflight ↔ Agent process spawn`：真 Runner 必须先证明 stdout 可写且 attempt-scoped GitHub auth 可用；失败时 Agent 进程必须从未启动。
- `Runner 写入的 nested/ignored/node_modules output ↔ Worker terminal cleanup`：必须由 exact Runner 真写，再由 Worker 反向删除 container/runtime/worktree/admin/ACL/secret；禁用 quarantine 充当成功。
- `terminal/cancel/docker.wait/startup reconcile ↔ attempt cleanup state/quarantine journal`：必须共用串行 idempotency fence；第一份完整 append-only quarantine receipt 不得被后续 JSON-only receipt 覆盖。
- `startup-sync/watchdog/manual ↔ ensureKernelController(run) ↔ initiative_runs owner/generation lease`：真 Postgres CAS 与真实 child handshake，禁止 advisory-lock-only、mock lease 或 PID 代替 owner。
- `TaskBundle.callback_result_path ↔ Worker runtime mount/BRAIN_RESULT_FILE ↔ callback finalizer/receipt DB`：真 read-only Runner 写 attempt runtime，Controller 只读精确注入路径并验 attempt/run/role/contract/head/hash；禁 source `.brain-result.json`、stdout prose或任意 fallback。
- `kernel-harness-lifecycle manifest ↔ migration 368+ ↔ DevOps Map rows ↔ regression-contract.yaml ↔ runtime API/report`：一个 canonical manifest 驱动 13×11；真 Postgres fresh/production-like upgrade/rollback，禁第二 journey、静态 143-cell 常量或文档补绿。
- `S0 born/S1 intent ↔ S2 Planner ↔ S3 Contract GAN ↔ S4 Generator/Draft output ↔ S5-S11 receipts ↔ S12 accounting transaction`：真实 Controller/PG/GitHub receipts 逐段推进，缺前序或 typed pending 时 fail closed；禁 stage shift、boolean verified、fake SHA、单元替身充当 P0 证据。
- `KH-F1-F01..F08 legacy inventory ↔ KernelPolicyGate ↔ hooks/DevGate/watchdog/Judge/GitHub/release seams`：逐 exact legacy behavior ID 绑定真实 normal/violation/recovery fire receipt；禁 source-anchor、active declaration 或合成 receipt count 冒充等价。
- `.github/workflows/{ci,kernel-fleet-p0-gate,brain-ci-deploy,auto-staging-deploy,deploy}.yml ↔ exact-head owner/controller release receipt`：必须执行真实 workflow contract/integration，禁止只 grep YAML 或伪造 success conclusion。
- `.github/workflows/scripts/should-auto-merge.sh ↔ GitHub branch protection/ruleset/required check`：必须用真实 repository rules snapshot、run/check-suite/head/actor/signature 验证所有 merge actor，禁 title/label 分类替代。
- `kernel-guard-manifest ↔ provider-neutral Runner broker ↔ Claude/Codex/Grok real CLI ↔ guard_evidence_receipts`：D/A/F/E 必须走 clean-home 官方 installer、真实 launcher/production seam 与独立 effect observer；禁直接调用 hook、复制 settings、summary stdout 或 subject self-attestation。
- `guard_evidence_receipts ↔ guard_proof view ↔ S12 accountant`：真 Postgres append-only role/trigger 拒绝 UPDATE/DELETE；classification 未批准、receipt stale/missing/disproven、observer 与 subject 同类或缺 nearby-allow/recovery 时 coverage=0。

## 未覆盖真实链路清单

- Xian macOS/Tailscale 维护：外部 blocker；本 sprint 只产生真实探测的 blocked evidence，owner 为 Xian host operator，修复后在 `xian-mac-m4` 与 `xian-mac-m1` 重跑 admission/canary。
- owner approval：自动化只能验证 exact-head 签名与权限，不能替人批准；owner 必须在 Draft head 上显式授权后才允许 Draft→Ready/merge。
- 除上述两项外，本合同不允许 force/stub/假数据替代 Golden Path；slow-phase 与 mutation 是对真实模块注入受控故障，不是成功链路豁免。

## 接缝清单

1. OrbStack 以 login user 代理访问 host bind，而 Worker 为 UID 450、Runner 为 image 声明的 runtime UID/GID：在真实 US Mac 上用 exact digest 验 mode-0600 sentinel、secret、Git object、stdout 与 cleanup；未真验只能标 `logic-done-pending`。
2. Brain→Worker→Runner→callback/commit transfer→Controller ground-truth：在真实 US Worker + staging Brain 跑一个真实 Attempt；未真验只能标 `logic-done-pending`。
3. Brain restart 后 Kernel no-session recovery：在 staging/production canary 真 Postgres 与真子进程上验唯一 replacement、fresh heartbeat、`resumed=1`；未真验只能标 `logic-done-pending`。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 凭据清理失败 | pre-Agent receipt；四终态 revoke/delete/residue=0；secret 全持久面扫描。 |
| migration rollback/schema drift | migration 367+ 真 PG upgrade/rollback，旧 transport 保留，source/schema parity。 |
| workflow bypass/auto-merge | P0 gate receipt 绑定 exact head/owner/merge；四个既有 workflow 的旁路反事实全部非零。 |
| cleanup/quarantine 存储增长或证据覆盖 | real Runner 写 411MB/921MB 类 nested/ignored 内容后，按 fenced 顺序清理；失败保留 workspace+admin+runtime+state 的首份 append-only receipt，`quarantined` 跨重启短路，永不以 quarantine 计成功。 |
| exact-head staleness | 新 commit 立即作废 owner approval 和所有后续 receipt。 |
| title/label 或 alternate actor 绕过 merge | P0 classification 使用签名 task/PR receipt；required check 与 ruleset 对 admin/automation/直接写 actor 一致生效，部署前快照并验证 repository rule。 |
| Controller 双 owner/旧 generation 写入 | DB 唯一 active run + owner/generation lease CAS；startup/watchdog/manual race 只产生一个 ready owner，旧 generation 所有写 fail closed。 |
| rollback image 仍缺 `/app/config` | rollback image 同样先做 built-image attestation；未证明自包含则保持 Kernel drained，不启动缺陷 Controller。 |
| Xian 外部 blocker | machine-readable blocked evidence，不降 profile、不加 bypass。 |
| read-only result path EROFS 或 stale source result 冒充 | pre-Agent 创建并探测 attempt-scoped runtime path；只验注入路径及绑定字段/hash，所有终态在 durable receipt 后清除。 |
| proposal Draft 分支冲突或 migration 366 重号 | 只按 full exact `4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13` 读取 proposed provenance；执行前重查 tree/DB 并选未用 368+；#4372 保持 Draft。 |
| 143-cell matrix 被 gray/null 或重复 journey 假补全 | canonical manifest schema 禁 gray/null；每 cell 必有 typed state+reason/evidence；原位升级既有 F1 rows，journey count 不增。 |
| S0/S1 或 S12 两端漏记导致中段假完成 | born/intent receipt 是 S2 前置；S12 统一事务在 production+rollback receipts 后执行，任一外部/账本/报告写缺失都保持 non-complete。 |

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能需求 | 把 Brain image、Runner/Profile/Worker/schema、Mac 安装事务、remote transport、artifact/result handoff、Kernel readiness/watchdog、Worker-first rollout/rollback 与 F1 S0-S12 生命周期收敛成单一 durable recovery 合同。 |
| **NFR（做得多好）** | 性能/可靠性 | 每 phase 有独立有界预算，总 startup budget 小于 Attempt lease/deadline；同一 idempotency key 最多一个活跃 Attempt/Kernel/provider；错误码有界且无 secret。 |
| **Invariant（永不违反）** | 安全/一致性 | secret 不进 env/argv/layer/log/payload/callback/worktree/git；profile/digest 不降级；Attempt 的 release snapshot 创建后不可漂移；CI Green 不授权 merge；staging/production 不得早于 owner exact-head approval 与 merge；失败不记 resumed/ready；143 cells 无 gray/null；S12 前不得 complete。 |
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
| result path 缺失/EROFS/symlink/oversize/绑定不符 | Agent 前或 callback finalization fail closed，持久化 bounded redacted machine code，不消耗 semantic/GAN budget | 是，attempt_id+path+hash | 禁止 source/stdout fallback |
| lifecycle cell 缺 evidence/过期/恢复失败 | append-only event 保持 `unproven|pending|blocked|failed|expired`，阻断对应 stage 与 S12 completion | 是，run+manifest+stage+cell+requirement digest | 禁止 Journey color、gray 或推断 pass |

## F1 生命周期 SSOT 与 13×11 等价矩阵

**唯一 law manifest**: `packages/quality/contracts/kernel-harness-authority-manifest.json`。
`packages/brain/config/`、Journey API、report 与 UI 只允许生成
`authoritative=false` projection，不保存当前权威状态。

**canonical stages（逐字继承 intended baseline；不得 rename/merge/split/shift/insert）**:

| Stage | 稳定 step ID | 名称 | owner | durable input → output receipt |
|---|---|---|---|---|
| S0 | `4540991e-17ca-4f31-a318-8ab18f856b31` | Task Born | Controller | signed task identity → `task_born_receipt` |
| S1 | `a5ce672f-2202-4eae-a74d-2da323dc64ff` | Intent / PrepPRD | PrepPRD owner | S0 + product/lifecycle anchors → `intent_receipt` |
| S2 | `c5bae104-da5e-483d-b5ea-c295c90a3f28` | Planner | Planner | immutable TaskBundle → signed Planner attempt + PRD artifact receipt |
| S3 | `d6dcdfaf-4b98-4717-bbe3-522f03f70757` | Contract GAN | Proposer/Reviewer | S2 PRD SHA → authenticated review verdict + `contract_approval_receipt` |
| S4 | `0cdadc1a-e3a0-46a1-8333-ebbc102883f7` | Generator | Generator/Controller | approved contract SHA → implementation commit + Draft PR exact-head receipt；Draft PR 是 S4 输出，不是 stage |
| S5 | `f12be1d5-ae65-4813-b2d8-cfde24ac5ac6` | CI | GitHub Actions | S4 Draft exact head → authenticated CI/check-suite receipt，禁止 merge |
| S6 | `1a738e05-99a7-421c-a52d-c2bb80bf19be` | Evaluator | independent Evaluator | S5 exact head → signed non-mutating behavior verdict |
| S7 | `9a8b4080-97f5-46a0-848e-6428ac881d1b` | Independent Judge | independent Judge | S6 evidence + same head → signed independent verdict |
| S8 | `de269b2e-46aa-4d5a-afea-1bc4558b0fef` | Risk-based Human Review | authorized owner | S5-S7 same-head receipts → signed owner receipt；新 push 失效 |
| S9 | `d6f3c80a-5e48-4058-b7e5-f972f1a23ee1` | Merge | Controller only | S8 receipt + rule snapshot → fenced merge receipt |
| S10 | `004993cf-01ff-422d-b45a-14328361279b` | Staging | deployment controller | S9 artifact → isolated post-merge staging receipt |
| S11 | `0e7a817c-d8ef-4f9a-8561-4300fe6b547a` | Production | deployment controller/on-call | S10 receipt → authenticated canary + rollback-anchor receipt |
| S12 | `4d0ed49c-4949-4e8b-90f3-6840d58f39fe` | Report / Learning / Complete | Controller | S11 production+rollback receipts → atomic accounting/terminal receipt |

**canonical elements（字面、顺序固定）**: `FR`、`NFR`、`Invariant`、`判定点`、`保质期`、`死亡告警`、`失败语义`、`效果确认`、`输入对抗面`、`账本保鲜`、`两轴衔接`。

每个 manifest cell 只定义 law：`stage_id`、`element_key`、`owner`、`construct`、
`requirement_digest`、`positive_oracle_id`、`violation_oracle_id`、`recovery_oracle_id`、
`required_origin`、`freshness_ttl/grace/death_alert`、`failure_semantics`、
`effect_confirmation` 与 `na_policy`。manifest 禁止存 `state/current_color/evidence_receipt_ids`。
当前状态只从 append-only evidence 表查询派生；只有未过期 `passed|na_approved` 满足 gate。

**13×11 矩阵登记（每格引用 manifest cell，禁止隐式 gray）**:

| Stage | FR | NFR | Invariant | 判定点 | 保质期 | 死亡告警 | 失败语义 | 效果确认 | 输入对抗面 | 账本保鲜 | 两轴衔接 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S0 | S0.FR | S0.NFR | S0.Invariant | S0.判定点 | S0.保质期 | S0.死亡告警 | S0.失败语义 | S0.效果确认 | S0.输入对抗面 | S0.账本保鲜 | S0.两轴衔接 |
| S1 | S1.FR | S1.NFR | S1.Invariant | S1.判定点 | S1.保质期 | S1.死亡告警 | S1.失败语义 | S1.效果确认 | S1.输入对抗面 | S1.账本保鲜 | S1.两轴衔接 |
| S2 | S2.FR | S2.NFR | S2.Invariant | S2.判定点 | S2.保质期 | S2.死亡告警 | S2.失败语义 | S2.效果确认 | S2.输入对抗面 | S2.账本保鲜 | S2.两轴衔接 |
| S3 | S3.FR | S3.NFR | S3.Invariant | S3.判定点 | S3.保质期 | S3.死亡告警 | S3.失败语义 | S3.效果确认 | S3.输入对抗面 | S3.账本保鲜 | S3.两轴衔接 |
| S4 | S4.FR | S4.NFR | S4.Invariant | S4.判定点 | S4.保质期 | S4.死亡告警 | S4.失败语义 | S4.效果确认 | S4.输入对抗面 | S4.账本保鲜 | S4.两轴衔接 |
| S5 | S5.FR | S5.NFR | S5.Invariant | S5.判定点 | S5.保质期 | S5.死亡告警 | S5.失败语义 | S5.效果确认 | S5.输入对抗面 | S5.账本保鲜 | S5.两轴衔接 |
| S6 | S6.FR | S6.NFR | S6.Invariant | S6.判定点 | S6.保质期 | S6.死亡告警 | S6.失败语义 | S6.效果确认 | S6.输入对抗面 | S6.账本保鲜 | S6.两轴衔接 |
| S7 | S7.FR | S7.NFR | S7.Invariant | S7.判定点 | S7.保质期 | S7.死亡告警 | S7.失败语义 | S7.效果确认 | S7.输入对抗面 | S7.账本保鲜 | S7.两轴衔接 |
| S8 | S8.FR | S8.NFR | S8.Invariant | S8.判定点 | S8.保质期 | S8.死亡告警 | S8.失败语义 | S8.效果确认 | S8.输入对抗面 | S8.账本保鲜 | S8.两轴衔接 |
| S9 | S9.FR | S9.NFR | S9.Invariant | S9.判定点 | S9.保质期 | S9.死亡告警 | S9.失败语义 | S9.效果确认 | S9.输入对抗面 | S9.账本保鲜 | S9.两轴衔接 |
| S10 | S10.FR | S10.NFR | S10.Invariant | S10.判定点 | S10.保质期 | S10.死亡告警 | S10.失败语义 | S10.效果确认 | S10.输入对抗面 | S10.账本保鲜 | S10.两轴衔接 |
| S11 | S11.FR | S11.NFR | S11.Invariant | S11.判定点 | S11.保质期 | S11.死亡告警 | S11.失败语义 | S11.效果确认 | S11.输入对抗面 | S11.账本保鲜 | S11.两轴衔接 |
| S12 | S12.FR | S12.NFR | S12.Invariant | S12.判定点 | S12.保质期 | S12.死亡告警 | S12.失败语义 | S12.效果确认 | S12.输入对抗面 | S12.账本保鲜 | S12.两轴衔接 |

**source inventory 与分类 authority**：

- independent verifier 必须对 full exact commit/path/blob 做 Git object 校验并重算 exact set：
  `dd424a61926009ac85a915b31187124b85f0ca98`、
  `packages/engine/regression-contract.yaml`、
  blob `7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3`、
  129/P0=66/P1=63、digest
  `4fcdf146ad08ab0ba349d789084fad6d85902b0e345993fb7ddf9057899a1e5f`。
- `packages/quality/contracts/` 保存 append-only `source_inventory`、
  `classification_decisions`、`equivalence_obligations`。后两层只能由 owner-signed
  exact-head authority manifest 驱动。
- imported proposal full SHA
  `4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13` 的
  `0,2,2,8,6,0,1,110`/`be8079...` 必须标
  `imported_proposed_distribution`，不得成为 approved threshold。H1-001/H1-002→F08
  必须保持 unreviewed/rejected，直到逐行 owner decision。
- equivalence required exact set 仅从 `state=approved` classification 与 reviewed
  provider applicability 动态派生。终态要求 `unreviewed=0` 且所有 rejected 已由
  superseding approved 或 preserved non-equivalence 闭合；禁止固定 1161/18。
  候选 F01/F06 unified IDs 只有 authority manifest 冻结后才生效。

**R34/R35 exact fixture 与 advisory authority**：

- 历史 Journey 是 `bb8cc561-b3ee-4fec-b74d-2255694bd963`，GAN Reviewer alias 必须是
  `e2bd9263-87ef-4461-a1d5-5ff07a38b8a8`，Final E2E alias 必须是
  `a6888ef3-2482-4655-8703-cf3b9f037cb9`。六行十个 legacy 列的 exact fixture digest 是
  `d74103b146f2261c47c20ed1880830f8bd98adcdfee4c53854a9b9c5d2006cfd`。
- full 129-entry fixture 必须恰 `56518` bytes，SHA-256
  `bfcb7a7678d5a1e1e3076ca27e34f0b01978ca590780f33d7ddb551f9615914d`；advisory digest
  `a8e979f936ea1d5072d148cd3500c32231e9c3227f438d96bd4bd2258470e7b3`。
- advisory partition 必须精确为 `76 machine_recommended + 53 needs_human_review`；
  proposal F08=110 中 `66` 建议迁出、`44` 保持 unreviewed/out-of-taxonomy，完整语义字段的
  staging/promote/rollback 命中数为 0。provider-independent 候选 scope 精确为
  `ci=32,doc=2,export=5,infrastructure=1,regression=3`，仍不能越过 owner review。
- classification decision 只追加，状态仅
  `machine_recommended|needs_human_review|owner_approved|owner_rejected|superseded`；
  owner approval 前全部 `approved_family=null`、derived obligation=0。pre-authority
  receipts 只可记为 `inadmissible_pre_authority/count_toward_terminal=false`。

**R38/R39 canonical evidence storage**：

新增 append-only
`kernel_harness_manifest_versions`、`kernel_harness_origin_receipts`、
`kernel_harness_cell_evidence`、`kernel_harness_terminal_accounting`。origin receipt
idempotency key 是 locator+digest；cell evidence 绑定 run/manifest/stage/element/
requirement/oracle/evidence digest/producer/verifier/valid_until。event state 仅
`unproven|pending|blocked|failed|passed|na_requested|na_approved|expired|revoked`。
expiry 在查询时比较 `valid_until`，不靠 scheduler 才生效。NA 必须 manifest 允许，producer
只能 request，独立 reviewer 必须不同 attempt/session/principal/trust-domain 并签名完整
counterfactual；P0 默认禁 NA。

`journey_step_links`、Journey PATCH/cascade-green、eleven-elements regex、
promise-map-nightly、ledger aggregate、generic `action_receipts` 均为非权威投影或提示，
不能满足 cell。S10 必须从 `staging_e2e_results` 验至少一个 required test、FAIL=0、
required SKIP=0、deployed/tested/merge SHA 三者非空且全等及 authenticated environment
receipt。S11 必须有 deployment+health self-reported build SHA+rollback anchor receipt；
`promote_status` 或本地 version file 不可替代。

**lifecycle proposal 与安全 migration oracle**：

S0-S12 是 proposed v1。生产历史六行保持 legacy 列和时间戳 byte-for-byte；仅增加
projection 字段，在同一 Journey 上形成 4 historic backbones、2 aliases、9 new rows、
13 backbones 与 143 初始 `unverified` cells。origin kind 按 stage 分型直证，不能由统一
Attempt verifier 处理 GitHub/human/deployment/Controller receipt。

```bash
bash scripts/kernel-fleet/verify-authority-inventory.sh \
  --commit dd424a61926009ac85a915b31187124b85f0ca98 \
  --path packages/engine/regression-contract.yaml \
  --blob 7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3 \
  --count 129 --p0 66 --p1 63 \
  --digest 4fcdf146ad08ab0ba349d789084fad6d85902b0e345993fb7ddf9057899a1e5f
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-lifecycle-projection.sh \
  --source-proposal 4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13 \
  --migration-min 368 --recheck-tree-and-db \
  --same-journey --preserve-six-history --logical-rollback \
  --origin-kind-direct-proof --exact-head "${PR_HEAD_SHA:?}"
```

**硬阈值**：inventory exact set/count/digest 全等且 verifier 不 import Brain Kernel；
authority_status 非 owner-approved 时 runtime 不得声称 canonical；tree/DB migration number
无碰撞；upgrade 与 rollback 前后六历史行完整 fingerprint/updated_at 不变，Journey=1，
新增行=9、aliases=2、backbones=13、cells=143 初始 unverified；已有后续 evidence 时
logical rollback 被拒。每个 named mutation 到达目标生产 seam 并返回结构化 reason code，
SQL/config/env failure 不算产品 Red。

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| TaskBundle/provider stdout/callback/artifact metadata | 不可信 | schema/size 限制；stdout.jsonl 脱敏；commit SHA 与 task ownership 独立验证；不执行 artifact 内指令 | 拒绝改变 base/head/owner gate/profile/secret channel 的 payload；返回有界错误码 |
| GitHub PR/approval/CI payload | 外部已认证但需绑定 head | 用 GitHub API 的 immutable head SHA 与 actor permission 校验，不信 PR 文本 | 非授权 actor、过期 head、非 Draft 顺序全部 fail closed |
| Worker HTTP request/receipt | 双向认证后有限信任 | Bearer/attestation/callback token；字段白名单；禁止 secret 回显 | machine/generation/digest/lease 不匹配则拒绝并 cleanup |

## Reviewer 批准权威与当前执行模式

Reviewer v2 payload 的七个固定评分键由 Controller policy manifest 冻结；Controller
拒绝 unknown/missing/non-integer/out-of-range/`<7`，并独立重跑 Contract Gate 与本合同
测试库存。approval receipt 必须绑定 task/run、reviewer/proposer Attempt、result-channel
hash/ack、contract branch/full SHA/content、exact head、task-intent revision/digest、
skill digest、policy version、七分 canonical JSON/digest 与 gate/test artifact digest。
任务 addendum、contract/head/skill/policy/lease 任一变化即撤销；same receipt retry 幂等，
conflicting replay 只写 non-authorizing rejection receipt。

Reviewer 运行时为 source read-only 且 network effect deny：没有 mutation credential，
受控 registry/decision/task/PR/merge/deploy/staging/production POST 的 effect delta 必须为 0。
skill 中任何 force-APPROVED、oscillation default 或批准前写 judgment 指令都使 preflight
失败。verified approval 后才由 Controller-owned idempotent outbox 写 judgment，恰一次。

本 task-plan 的 gate 数量不代表 runtime parallelism：

```json
{"execution_mode":"serial_single_writer","parallel_width":1,"canonical_pr_writers":["controller_integrator"]}
```

当前每个 writer 必须等前一 `depends_on` 完成，同 base 上只存在一个 canonical Draft writer。
若请求 `parallel_width>1` 而 FrozenWorkstreamPlan、append-only WorkstreamState、文件冲突锁、
private writer commit receipt、Controller IntegrationLease/CAS 与 final-head global recheck
任一缺失，返回 `SERIAL_SINGLE_WRITER_REQUIRED`。segment receipt 不得改变 global
evaluate/judge/approval/merge 状态。

## Golden Path

覆盖父路 `Durable Fleet Worker bootstrap 与 Kernel 恢复闭环` 第 1-12 步

`exact Draft head` → `immutable image/release` → `Mac transaction` → `Worker admission` → `phase-aware Attempt` → `secret+artifact handoff` → `Kernel ready/recovery` → `Worker-first candidate gate` → `CI+Evaluator+Judge` → `Controller reviewer-v2 approval normalization` → `Reviewer effect isolation` → `owner exact-head approval` → `authorized merge` → `US staging` → `production canary/rollback`

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

**可观测行为**: 鉴权 `/health` 返回与候选 exact ref 对齐的 `base_admitted=true`、`dispatch_ready=true`；health 实跑与 Attempt 相同 root/mount/ACL/UID/GID/secret/cleanup，而非模拟 JSON。stdout.jsonl 与 attempt-scoped GitHub auth 必须在 Agent spawn 前通过真实 Worker→exact Runner write/gh auth probe；任一失败返回有界 machine code、持久化 `1..2048` bytes 脱敏诊断且 Agent 未启动。候选 Worker 使用隔离 LaunchDaemon/port/data-root/router/generation，pre-merge proof 前后 serving staging/production byte-identical。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-worker-admission.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
```
**硬阈值**: authenticated semantic fields 全匹配；bad token/stale digest/private root/missing ACL/unwritable stdout/missing GitHub auth mutation 全部 fail closed；Agent-start counter=0；unwritable stdout diagnostic 为 1..2048 bytes 且 secret sentinel 0 命中；一次 disposable container 后 residue=0；候选 proof 前后 production generation/digest/config 哈希完全相等。

### Step 5：生产 transport 与 DevOps Map anchor 预检 fail closed
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、10 步及 R5 live Red。

**可观测行为**: remote-enabled、callback、US/Xian URL DNS/连通、immutable profiles、真实 journey/golden-path/step existence 与 ownership 全部校验；当前 task 必须原子迁移到 Notes 中的既有三元组并回读，`task_id=4a530430-00c5-46bc-8a4f-c0ec38025391` 与 `run_id` 是不同构造且分别解析。Xian 不满足时输出 blocked evidence，但不降低 profile；语法合法但零生产行的 UUID 必须失败。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-production-preflight.sh "${PROD_BRAIN_URL:?}" \
  "${TASK_ID:?}" "${RUN_ID:?}" \
  "${REAL_JOURNEY_ID:?}" "${REAL_GP_ID:?}" "${REAL_STEP_ID:?}"
```
**硬阈值**: current `RUN_ID` 逐字等于不可变 TaskBundle 的 run_id 且无源码默认值；US path ready；当前 task 回读的 anchor 精确等于既有三元组且 task/run 不同；GP 和 step 均真实存在并属于同一 journey；terminal historical run `4bbe35de-63c1-4cfe-9b55-fea8c01a0647`、task-as-run、TaskBundle/receipt mismatch、stale contract round/head、cross-run artifact/result、虚构 UUID、零行 UUID、错误 ownership、不可达 URL、remote-disabled 各自非零且 semantic/GAN budget delta=0；Xian 维护差距 machine-readable `blocked_external`。

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

**可观测行为**: Docker-mediated single-use secret 在 Runner 自有 tmpfs 生成 0600 auth，brokered attempt-scoped GitHub auth 在 Agent 前验证并可 push/fetch；auth 的 attempt copy 在 `success|timeout|crash|cancel` 四种终态都必须 revoke+delete。Runner 可写 attempt 三目录和 stdout，但 shared roots 只读；callback 前将签名 commit/bundle 以真实 SHA/branch/task ownership 物化至 Controller，之后才 cleanup。

每个新 Attempt 在 Docker create 前，按 installer/profile SSOT 的 data-root、OrbStack owner、Worker UID/GID 预建精确 workspace/admin/runtime roots，并赋予可继承但角色分离的 ACL：RW role 仅当前 Attempt 三目录，RO role 无写权；所有路径须 realpath、no-symlink、UUID ownership 与 root containment 校验。helper 失败时 Docker side-effect=0。legacy in-flight Attempt 只在确认 container absent 后，可用 pinned digest、无网络/无 secret/drop caps/no-new-privileges normalizer 处理精确三根；out-of-root、wrong UUID、symlink、group mismatch 均 fail closed。

终态清理严格执行 `confirm container absent → normalize exact Runner-writable descendants（不碰 Worker-owned 0600 control files）→ authoritative host cleanup workspace/admin → runtime/secret cleanup → state delete`。normalizer 失败不能跳过 host cleanup；host cleanup 失败则把 workspace+admin+runtime+state 写入一份 append-only、不可覆盖的 durable quarantine receipt。`status=quarantined` 跨 Worker restart 短路 terminal/cancel/reconcile。terminal、cancel、docker.wait、startup reconcile 以同一 attempt lock/idempotency fence 串行，并发只产生一个 `clean|already_clean` 或一份 quarantine。

**验证命令**:
```bash
bash scripts/kernel-fleet/run-real-attempt-proof.sh "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" "$PR_HEAD_SHA"
```
**硬阈值**: 真实 Attempt accepted→ready→callback→canonical commit；`gh auth`/push/fetch 成功；`success|timeout|crash|cancel` 四路 `revoked=true && attempt_copy_deleted=true && residue=0`；正控 secret/workspace/admin/runtime/state/quarantine count=0；shared-root write ACL=0；pre-create helper ordering、RO/RW、private `/var/lib`、missing inherited ACL、absent reader、bad auth、unwritable stdout、cleanup-before-transfer、reverse-delete-denied、symlink/out-of-root/wrong UUID、legacy restart、concurrent cancel/wait/two reconciles 各自有独立 machine result。失败 forensics 中第一份 receipt path/size/digest 永不被第二次 reconcile 改写；container 未确认移除时 `cleanup_blocked` 且路径不 rename。

### Step 7A：Attempt-scoped result channel 在 Agent 前 ready
**来源**: `[AI_ADDED]` — R15 真 reviewer 在 read-only checkout 写默认 `/workspace/.brain-result.json` 得到 EROFS，且 branch 中陈旧文件可跨轮污染；必须把 verdict 交付纳入 Golden Path 接缝。

**可观测行为**: TaskBundle 的 `callback_result_path` 是 exact Attempt runtime root 下由 Controller 生成的 immutable、no-symlink、有界路径；Worker 在 Agent 启动前创建/清空并以可写 mount + `BRAIN_RESULT_FILE` 注入。real proof 调用必须把当前 proof Agent 的 `ATTEMPT_ID`、`CONTRACT_SHA`、`role`、`RUN_ID`、`PR_HEAD_SHA` 明确传入 Worker，callback finalizer 只读取该路径并逐字段与这些输入比较，不能接受模块自己返回的 self-consistent ID。hash 在 cleanup 前持久化；source checkout 中 `.brain-result.json`、stdout prose 和其他路径全部忽略。

**验证命令**:
```bash
bash scripts/kernel-fleet/run-result-channel-proof.sh \
  "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" \
  "${TASK_ID:?}" "${RUN_ID:?}" "${ATTEMPT_ID:?}" "${CONTRACT_SHA:?}" \
  "${PR_HEAD_SHA:?}"
```
**硬阈值**: 当前 phase 的真 Runner 写入成功，positive receipt 的 attempt/contract/run/head 与调用输入逐字相等，role 必须等于 Controller-owned TaskBundle top-level `role`；verifier 独立查询 `harness_attempts` 的生产现有列并从 `task_bundle/result` 派生 contract/head。source stale result ignored。missing descriptor、EROFS、wrong-attempt/run/role/contract/head、symlink、oversize、malformed 各自 pre-Agent 或 finalize fail closed；pre-Agent 不可写时 Agent-start=0、semantic/GAN budget delta=0；success/timeout/crash/cancel 只有 durable hash ack 后才 cleanup。

### Step 8：Kernel launch 以 handshake+heartbeat 判 ready
**来源**: `[FROM_PRD]` — PRD Golden Path 第 8 步。

**可观测行为**: active `run_id` 在真 Postgres 以唯一约束和 TOCTOU-safe insert/reuse 获得一个通用 Controller owner。migration 367+ 增加 `controller_owner_id`、`controller_generation`、`controller_lease_expires_at`、`controller_ready_at` 与 durable exit diagnostics；heartbeat/intent/dispatch/merge/control 写入全部由 owner+generation CAS fence。missing/relative/nonexistent/non-Git/unmounted worktree 在 spawn 前拒绝；async spawn error、early exit、no-ready、timeout/lease_busy 均结构化非成功。正控必须启动 exact built-image/`packages/brain/src/orchestrator/run.js`，并分别绑定 image digest、git commit/tree 与 run.js blob digest，禁止把 git commit SHA 当文件 bytes digest。child 真正获取 lease/generation、构造生产依赖并写入真 PG 首个 fenced heartbeat；父进程再独立查询 DB 核对 child-owned owner/generation/ready_at/heartbeat 后才 resolve。只发送 `kernel-ready` frame但没有 DB lease/dependencies/heartbeat 的 spoof child 必须 fail closed；PID/host 仅诊断。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-launch-readiness.integration.test.js --reporter=verbose
```
**硬阈值**: 正控候选 image digest、exact commit/tree、run.js blob digest 与真 PG 全部独立匹配；独立 DB 查询 owner/generation/ready_at/heartbeat 全匹配；frame-only spoof fail；并发 active run create 只得一个 run；watchdog+manual/startup race 只得一个 ready owner；pre-heartbeat crash、handshake timeout、lease_busy、old-generation write、PID reuse、7 类坏 worktree/spawn 负控均失败；诊断≤2048 bytes 且 secret sentinel 0 命中。

### Step 9：Watchdog truthful recovery 严格一次
**来源**: `[FROM_PRD]` — PRD Golden Path 第 9 步。

**可观测行为**: `startup-sync`、watchdog、manual 三路只调用同一个 `ensureKernelController(run)`，删除 production 不存在的 `initiative_runs.tmux_session` 查询，并在 Brain startup 立即 reconcile。初启与 watchdog 共用 Step 8 contract；失败不递增 `resumed`/不发 `reconcile-restarted`，仍可恢复；成功后才 `resumed=1`，仅一个 replacement/provider Attempt。扩展既有 `packages/brain/src/lib/kernel-liveness.js` SSOT 及消费者，禁止新建平行 API；测试真实 spawn child，先验同机 live，再 kill+await exit 后由真实 `kill(pid,0)` 的 ESRCH 判 dead；远端/未知 fail-open。`infrastructure_blocked|runner_failure|admission|configuration` 不消耗 semantic blocked/no-progress/GAN streak，不得触发 `blocked_same_state` hard-fail，admission Green 后一个 CAS owner 可恢复。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run packages/brain/src/__tests__/kernel-durable-recovery.integration.test.js --reporter=verbose
```
**硬阈值**: 真 PG 多轮扫描；startup/watchdog/manual race ready owner=1；Brain restart 后旧 generation 写=0；两次基础设施 block 后 semantic streak=0、run 非 failed；admission 恢复后 resumed=1、replacement=1、event=1、下一次 dispatch completed；same-host-live 与 unknown-host 两个反事实 replacement=0，kill+await 后 ESRCH 才 dead。

### Step 10：Draft exact-head CI/Evaluator/Judge 只产证据
**来源**: `[FROM_PRD]` — 修订后 PRD Golden Path 第 10 步。

**可观测行为**: 不可伪造的 task/PR P0 receipt 触发 `.github/workflows/ci.yml` 与 `.github/workflows/kernel-fleet-p0-gate.yml`；可变 title/label 不参与分类。required P0 exact-head check 必须经真实 GitHub API 回读并绑定 GHA run ID、check-suite ID、head SHA、actor、候选 image/Worker/Runner/profile/schema attestations与签名 repository-rule snapshot；新 JS 模块返回预期数组/布尔值不算 evidence。built-image smoke 同一脚本同时接入 `Smoke Glob Runner Passed`、`ci-passed real-env-smoke`、brain-deploy pre-swap、brain-rollback pre-start。在隔离 candidate LaunchDaemon/port/data-root/router/generation 上先验证 Worker-first candidate，再运行非变更型 Evaluator/Judge；任何 job 都不读取 owner approval、不切 Ready、不 merge、不 deploy，serving staging/production 前后 byte-identical。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-p0-workflow-contract.sh draft-evidence "$PR_NUMBER" "$PR_HEAD_SHA"
```
**硬阈值**: 事件精确为 `ci,evaluator,judge`；PR 仍 Draft、auto-merge off；merge/staging/production mutation count=0；title 改名/移除 label/旧 Harness green/伪造 run ID/未 attested rollback image 均 required check 非绿；candidate proof 前后 serving state byte-identical；Worker admission 或 built-config remote/callback 缺失时 Brain candidate receipt count=0。

### Step 9A：execution target 隔离只作用于当前 logical cycle
**来源**: `[AI_ADDED]` — R47 live Red 证明早期
`execution_transport_unavailable` 被永久写入 `failed_targets`，跨 logical cycle 毒化 team3/team4；
team5 quota 不可用后，重复 `all_execution_targets_exhausted` 又把可恢复 run 错标 failed。

**可观测行为**: exclusion identity 至少包含
`run_id,role,logical_cycle_id,provider,account,machine,failure_class,source_attempt_id,
observed_at,expires_at/reset_at`。transport unavailable、machine offline 与 transient probe
失败在 TTL 后 fresh reprobe；auth/quota 按 reset/TTL；product failure 不写 target health。
每次 selection receipt 自含完整 considered targets、逐 target exclusion 来源/原因/expiry、
fresh probe snapshot 与 selected target。`all_execution_targets_exhausted` 只进入有界 backoff、
reprobe/owner intervention；只有独立持久化 termination limit 或 owner terminate 才可 failed。
同一 run 的后续 cycle 可重新选择恢复后的 team4。标准恢复不修改历史 failed run，而是保留
旧 run/attempt/decision log，新建 run 并从远端 contract branch exact SHA 接续。
测试必须通过生产 capability gate/dispatcher/loop 与真 PG append-only store 重放
`cycleA team4 transport fail → cycleB team3 transport fail + team5 quota unavailable →
cycleC team4 fresh Green`；测试进程独立回读 selection receipt 与 probe artifact，禁止注入
mock `recordDecision/decisions.push`。considered/excluded 必须是非空 exact set，不能对空数组
用 `every()` 充当证明。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-execution-target-recovery.sh \
  --real-controller --real-pg --restart --all-counterfactuals \
  --task "${TASK_ID:?}" --run "${RUN_ID:?}" --contract "${CONTRACT_SHA:?}" \
  --head "${PR_HEAD_SHA:?}"
```
**硬阈值**: 正控顺序精确为 cycleA/team4 transport fail、cycleB/team3 transport fail+
team5 quota、bounded persisted backoff、cycleC/team4 fresh Green+selected；同一 run 不新建
替代 run。真实 PG receipt 至少三条且 considered/excluded 非空，逐 exclusion 的
failure_class/source_attempt/expiry|reset/observed_at 以及 probe candidate digest/signature
齐全。TTL 未到、TTL 到期、auth reset、machine offline、transient、product failure、
restart replay、persistent exhaustion cap、owner terminate 各有独立 reason；历史 failed
run byte digest 不变，新 run 的 recovery_of 与 remote contract branch full SHA 精确匹配。

### Step 10A：Controller 确定性归一化 Reviewer 合同批准
**来源**: `[AI_ADDED]` — R43 发现 Reviewer outcome/prose、concerns 状态、stale task intent 与
非权威 result path 可错误授权 Generator，必须在 owner merge gate 之前先闭合合同批准本身。

**可观测行为**: Controller 只接收 versioned reviewer-v2 envelope，验证 clean completed
Attempt、七个固定 rubric score、validation evidence、judgments_written、R31 durable
result-channel、task-intent revision/digest、contract/head、skill/policy version；锁住并重读 task，
在 frozen head 独立运行 Contract Gate 与 Red inventory 后由代码计算 verdict。任何 addendum
或 digest 漂移重派 proposer/reviewer，绝不把 run failure/concerns/低分/prose 转成批准。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-contract-approval-v2.sh \
  --real-pg --real-result-channel --controller-gate --all-counterfactuals \
  --task "${TASK_ID:?}" --run "${RUN_ID:?}" --head "${PR_HEAD_SHA:?}"
```
**硬阈值**: rubric keys 必须字面等于
`dod_machineability,scope_match_prd,test_is_red,internal_consistency,risk_registered,
verification_oracle_completeness,ci_workflow_alignment`；未知/别名/缺一维均拒绝。12 个 exact cases 中前 11 个
`completed_with_concerns,score_6,missing_dimension,prose_only,no_result_file,source_result,
callback_before_ack,task_addendum,contract_or_skill_drift,conflicting_hash,stale_lease`
全部 non-authorizing 且 semantic/GAN success delta=0；仅
`clean_completed_all_seven_gte_7` 写一份 approval。same-hash retry approval count 仍为 1；
approval receipt 的 intent/head/skill/gate/test digest 任一 bit mutation 立即 stale。

### Step 10B：Reviewer read-only 还包括 network effect isolation
**来源**: `[AI_ADDED]` — R44 证明 source readOnly 不能阻止 Reviewer 用 Brain/GitHub/deploy
credential 改 registry、decision、task、PR 或环境，skill/code approval law 也可能漂移。

**可观测行为**: Reviewer TaskBundle 不含 mutation credential，egress policy 对八类 mutation
端点做 fail-closed deny；Reviewer skill/output schema、shared Runner callback 与 Controller
policy 使用同一 versioned approval law。REVISION/stale 不写 judgment；verified approval 后
Controller outbox 恰一次写入，Reviewer 本身永不写。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-reviewer-effect-isolation.sh \
  --real-runner --brain-api --github-api --deployment-api \
  --controlled-posts registry,decision,task,pr,merge,deploy,staging,production \
  --task "${TASK_ID:?}" --run "${RUN_ID:?}" --head "${PR_HEAD_SHA:?}"
```
**硬阈值**: Reviewer mutation credential count=0；八类 POST 全部 exact deny receipt 且 effect
delta=0；secret scan=0；legacy force-approval/default-APPROVED/pre-verification judgment 指令任一
出现即 preflight 非零；REVISION/stale outbox writes=0，verified approval writes=1，retry 后仍 1。

### Step 10C：独立 authority observer 与 Contract Gate 拒绝自证
**来源**: `[AI_ADDED]` — R48 证明 R15 仍由 verifier 自写临时 JSON 并由测试直接采信，
且 Contract Gate 对 R14/R15 self-attestation 与永久 target quarantine 返回 `ok=true,hits=0`。

**可观测行为**: real seam 的 subject/issuer 只产生原始事件；另一进程和不同 principal 从
append-only server/API/PG store 回读 receipt body 与 content-addressed artifact，独立重算
canonical receipt/artifact/predecessor digest、全 lineage binding 与 before/after effect。
stdout/temp JSON 明确 non-authorizing。Controller-owned Contract Gate 在冻结 contract head
独立读取 Red inventory 和 authority receipt，拒绝 R14/R15、自证 rubric、永久 flat
failed_targets 与 exhausted→hard-failed。缺生产环境、store signature 或 observer separation
返回 BLOCKED，不能 Green。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-r48-independent-authority.sh \
  --controller-store --content-addressed-artifacts --independent-observer \
  --frozen-contract "${CONTRACT_SHA:?}" --head "${PR_HEAD_SHA:?}" \
  --task "${TASK_ID:?}" --run "${RUN_ID:?}" \
  --fixtures r14-self-attested,r15-self-attested,flat-failed-targets,exhausted-hard-fail \
  --mutations fake-temp-json,duplicate-cell,missing-cell,binding,same-observer,predecessor-order,invented-rubric,unknown-rubric,missing-rubric
```
**硬阈值**: rubric key exact set 与整数 7..10 均由 Controller 重算；九类 mutation 与四个旧
fixture 全部 `authorizing=false` 且有不同结构化 reason。任一 positive receipt 的
task/run/attempt/role/session/lease/intent/contract/head/skill/policy、issuer、observer、artifact
digest、predecessor digest、before/after effect 全匹配；同 trust-domain 或无 raw artifact
一律拒绝。独立 gate artifact digest 持久化并进入 approval receipt，verifier stdout/temp
JSON 的 `count_toward_authorization=false`。

### Step 11：exact-head owner approval 后仅 controller 可 merge
**来源**: `[FROM_PRD]` — 修订后 PRD Golden Path 第 11 步与 Human authority。

**可观测行为**: 授权 owner 对同一 head 的签名 receipt 到达后，controller 验证同 head 的 required check、GHA run/check-suite、actor 权限和 repository-rule snapshot，才可执行唯一 Draft→Ready/merge。branch protection 与 active ruleset 对 admin、automation、alternate/direct write actor 一致要求该 check 和 owner receipt；新 push 使 review/receipt 失效。`.github/workflows/scripts/should-auto-merge.sh` 不再以 title 决定 P0 权限。CI-only、非 owner、stale head、缺证据、title/label mutation、旧 Harness green、alternate actor 均保持 Draft。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-p0-workflow-contract.sh owner-merge-gate "$PR_NUMBER" "$PR_HEAD_SHA"
```
**硬阈值**: 正控 audit 顺序精确为 `ci,evaluator,judge,owner,merge` 且 merge head=`$PR_HEAD_SHA`；approving reviews≥1、dismiss stale=true、last-push approval=true、required P0 context 在 classic protection 与 ruleset 都存在；所有反事实与 direct/admin/automation actor 的 merge/staging/production count=0。

### Step 12：authorized merge 后先 US staging，再 production canary 与 rollback/drain
**来源**: `[FROM_PRD]` — 修订后 PRD Golden Path 第 12 步及完成定义。

**可观测行为**: 仅在 Step 11 authorized merge 后，先 reconcile/admit exact Worker generation，再允许 Brain publication；`auto-staging-deploy.yml` 必须真实成功（skipped/idle 均失败），随后 `deploy.yml`/`brain-ci-deploy.yml` 才可消费 staging receipt 发布 production；直接 main-push、Fast Lane、schedule 或手动旁路均失败。部署 SSOT 必须显式提供 `KERNEL_FLEET_REMOTE_ENABLED=true` 与 `KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL`，并由真实 Runner 回调验证；缺任一项在分配 semantic Attempt 前失败。Brain restart 后无会话 Kernel 恰有一个 fenced replacement、fresh heartbeat、`resumed=1`、无 `/app/config` ENOENT/重复 Attempt并正常 dispatch；rollback 恢复旧 Worker/Brain/ACL/toolchain 前先验证 rollback image attestation，否则保持 Kernel drained。reverse cleanup 的 Mac/OrbStack pre-undrain gate 覆盖新/legacy Attempt、restart-before-cleanup、RO role、failure forensics、并发清理与 residual-zero；任一失败 node 保持 drained。

**验证命令**:
```bash
bash scripts/kernel-fleet/verify-p0-workflow-contract.sh post-merge-release "$PR_NUMBER" "$PR_HEAD_SHA"
```
**硬阈值**: event 顺序精确为 `merge,worker_admitted,brain_published,staging_passed,production_canary_started,production_canary_passed`；skipped/idle staging、Fast Lane、independent main push、missing receipt、remote-disabled、missing/unreachable callback 各自非零且 semantic Attempt allocated=0；replacement=1、Controller owner=1、resumed=1、provider_attempt=1、heartbeat age≤30s、next dispatch completed≤Attempt deadline、secret scan=0；cleanup/quarantine residual=0；rollback diff=0（drain marker 除外），unattested rollback target 不启动。

### Step 12A：authority approval、append-only evidence 与独立 S12 终态收账
**来源**: `[AI_ADDED]` — R32-R39 证明 imported proposal、Journey projection、summary
boolean 与 handler report 均不是 canonical evidence。

**可观测行为**: 独立 verifier 从 exact main commit:path blob 与 full-entry fixture 重算
129/P0/P1/full digest/advisory partition；authority manifest 逐行批准
classification/applicability 后才动态派生 obligations。S0-S12 在同一 Journey append-only
投影，保留六历史行所有 legacy 列和时间戳；owner approval 只冻结 law manifest，不补
行为 pass。每 stage 按 origin_kind 直接查真实 event/Attempt/GitHub/review/merge/deployment/
Controller transaction并写 append-only origin receipt 与逐 cell evidence；Journey color、
PATCH、handler summary 均不能满足 gate。S12 独立 accountant 在 SERIALIZABLE+run advisory
xact lock 中验证 exact 143 current cells、连续 S0-S11 predecessor、
merge=staging=production SHA、strict staging、production health、rollback、report/learning/
regression/external-effect receipts，随后在同一 transaction 写 S12 evidence、terminal
accounting并完成 run/task。固定 1161/18、imported distribution、prefix unified ID、
same-module required array 均被拒。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-lifecycle-projection.sh \
  --source-proposal 4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13 \
  --migration-min 368 --recheck-tree-and-db --same-journey \
  --preserve-six-history --logical-rollback \
  --origin-kind-direct-proof --exact-head "${PR_HEAD_SHA:?}"
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-lifecycle-equivalence.sh \
  --authority-manifest packages/quality/contracts/kernel-policy-authority.json \
  --derive-obligations-from-approved-decisions \
  --require-unreviewed-zero --reject-imported-distribution-as-canonical \
  --reject-h1-001-h1-002-f08-without-owner-decision
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-terminal-accounting.sh \
  --task "${TASK_ID:?}" --run "${RUN_ID:?}" --head "${PR_HEAD_SHA:?}" \
  --serializable --direct-origin-stores --exact-cells 143 \
  --strict-staging --production-health --rollback-anchor --all-counterfactuals
```
**硬阈值**: full fixture=56518 bytes/full digest `bfcb7a...`、advisory digest
`a8e979...`、partition=76/53、F08 partition=66/44、F08 semantic hits=0；authority 未
owner-approved 时 canonical=false 且 obligation=0；六历史行 fixture/digest/updated_at
前后及 rollback 后全等，Journey=1、new rows=9、aliases=2、backbones=13、law cells=143；
S10 required tests≥1、FAIL=0、required SKIP=0、merge=deployed=tested SHA；S11
deploy+health+rollback receipts 全真。任一 Journey PATCH、expired cell、空/全 SKIP staging、
promoted-without-health、SHA drift、缺 rollback/report/effect 时 terminal=false；S12 只产生
一次 controller-fenced SERIALIZABLE transaction。

### Step 12B：provider-neutral Guard Ledger 以 D/A/F/E 证明真实激活与效果
**来源**: `[AI_ADDED]` — R40-R42 证明 exact main 的 Claude-only/手工 hook wiring、
generic `action_receipts` 与 verifier stdout 不能证明 Claude/Codex/Grok 统一策略真的生效。

**可观测行为**: authority manifest 引用已批准的 129-row classification，不复制 runtime
状态。clean-home verifier 从 `mktemp`、`env -i`、隔离 HOME/XDG/GIT/provider roots 和 bare
origin 出发，只运行官方 installer 与真实 Kernel launcher，然后通过三种 provider CLI
分别发 V01-V13 deny、nearby allow、recovery。D 证明 source/manifest digest；A 证明实际
settings/installer/installed realpath/launcher hop；F 由 production seam 发精确 policy
reason；E 由不同 observer 验 bare refs/worktree/index/log/result/callback/DB effect。
`guard_evidence_receipts` 拒绝 UPDATE/DELETE，raw artifact content-addressed；receipt 失败
使受保护动作 fail closed。Stop、Journey PATCH green、CI-only merge、queued/empty/SKIP
staging、无 health/rollback production 都不能产生通过证据。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/run-clean-home-guard-proof.sh \
  --manifest packages/quality/contracts/kernel-guard-manifest.json \
  --providers claude,codex,grok --vectors V01-V13 \
  --official-installer packages/engine/install/install-kernel-policy-guards.sh \
  --real-launcher docker/cecelia-runner/entrypoint.sh \
  --isolated-home --isolated-bare-origin \
  --require-stages D,A,F,E --require-near-allow \
  --require-exactly-once-recovery --independent-observer \
  --task "${TASK_ID:?}" --run "${RUN_ID:?}" --head "${PR_HEAD_SHA:?}"
DB_URL="${DB_URL:?}" bash scripts/kernel-fleet/verify-guard-proof.sh \
  --manifest packages/quality/contracts/kernel-guard-manifest.json \
  --derive-required-from-approved-classification \
  --derive-observed-from-append-only-receipts \
  --providers claude,codex,grok --vectors V01-V13 \
  --require-proven-fresh --reject-summary-boolean --all-counterfactuals
```
**硬阈值**: exact vector set=`V01..V13`；每个适用 behavior/provider/vector 都有 D/A/F/E
chain、deny+near-allow+exactly-once recovery，F/E 的 observer_class 与 subject_class 不同；
三 provider 对同 vector 的 decision/reason/effect 全等；UPDATE/DELETE=denied；
classification 未批准时 coverage=0；source/provider/launcher/manifest digest drift 即 stale；
任一 `ORACLE_D_*|ORACLE_A_*|ORACLE_F_*|ORACLE_E_*` failure、second merge authority、
required staging SKIP 或 production 缺 health/rollback 均使 S12 terminal=false。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: agent_remote
**target_environment**: linux_server

```bash
#!/bin/bash
set -euo pipefail

: "${E2E_PHASE:?preapproval|postapproval}" "${PR_NUMBER:?}" "${PR_HEAD_SHA:?}"
: "${CANDIDATE_BRAIN_IMAGE:?}" "${CANDIDATE_BRAIN_IMAGE_DIGEST:?}"
: "${CANDIDATE_RUNNER_REF:?}" "${CANDIDATE_BUNDLE_REF:?}"
: "${US_WORKER_URL:?}" "${US_WORKER_SSH:?}" "${FLEET_TOKEN_FILE:?}"
: "${PROD_BRAIN_URL:?}" "${DB_URL:?}" "${TASK_ID:?}" "${RUN_ID:?}"
: "${ATTEMPT_ID:?}" "${CONTRACT_SHA:?}" "${TASK_BUNDLE_PATH:?}"
: "${REAL_JOURNEY_ID:?}" "${REAL_GP_ID:?}" "${REAL_STEP_ID:?}"

test "$TASK_ID" = "4a530430-00c5-46bc-8a4f-c0ec38025391"
test "$TASK_ID" != "$RUN_ID"
jq -e --arg task "$TASK_ID" --arg run "$RUN_ID" --arg attempt "$ATTEMPT_ID" \
  '.task_id==$task and .run_id==$run and .attempt_id==$attempt' "$TASK_BUNDLE_PATH"

test "$(git rev-parse HEAD)" = "$PR_HEAD_SHA"
test "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" = "$PR_HEAD_SHA"

if [ "$E2E_PHASE" = preapproval ]; then
  test "$(gh pr view "$PR_NUMBER" --json isDraft --jq .isDraft)" = "true"
  test "$(gh pr view "$PR_NUMBER" --json autoMergeRequest --jq '.autoMergeRequest == null')" = "true"
  bash scripts/kernel-fleet/run-authoritative-final-e2e.sh \
    --phase preapproval --pr "$PR_NUMBER" --head "$PR_HEAD_SHA" \
    --task "$TASK_ID" --run "$RUN_ID" --attempt "$ATTEMPT_ID" \
    --contract "$CONTRACT_SHA" --brain-image "$CANDIDATE_BRAIN_IMAGE" \
    --brain-digest "$CANDIDATE_BRAIN_IMAGE_DIGEST" \
    --runner "$CANDIDATE_RUNNER_REF" --bundle "$CANDIDATE_BUNDLE_REF" \
    --worker "$US_WORKER_URL" --token-file "$FLEET_TOKEN_FILE" \
  --authority packages/quality/contracts/kernel-harness-authority-manifest.json \
  --guard-manifest packages/quality/contracts/kernel-guard-manifest.json \
  --guard-providers claude,codex,grok --guard-vectors V01-V13 \
  --approval-policy packages/quality/contracts/kernel-contract-approval-v2.json \
  --require-reviewer-result-channel --require-reviewer-effect-isolation \
  --require-target-quarantine-recovery --require-real-pg-selection-replay \
  --require-selection-receipts --require-independent-authority-observer \
  --reject-self-attested-evidence --require-independent-contract-gate \
  --execution-mode serial_single_writer --parallel-width 1 \
  --expect-order draft,ci,evaluator,judge,reviewer_v2_verified \
  --expect-serving-mutations 0 \
    --expect-terminal false
  exit 75
fi

test "$E2E_PHASE" = postapproval
: "${OWNER_APPROVAL_RECEIPT:?}" "${MERGE_AUTHORITY_TOKEN_FILE:?}"
bash scripts/kernel-fleet/run-authoritative-final-e2e.sh \
  --phase postapproval --pr "$PR_NUMBER" --head "$PR_HEAD_SHA" \
  --task "$TASK_ID" --run "$RUN_ID" --attempt "$ATTEMPT_ID" \
  --contract "$CONTRACT_SHA" --owner-receipt "$OWNER_APPROVAL_RECEIPT" \
  --merge-token-file "$MERGE_AUTHORITY_TOKEN_FILE" \
  --worker "$US_WORKER_URL" --worker-ssh "$US_WORKER_SSH" \
  --production "$PROD_BRAIN_URL" --db "$DB_URL" \
  --authority packages/quality/contracts/kernel-harness-authority-manifest.json \
  --guard-manifest packages/quality/contracts/kernel-guard-manifest.json \
  --approval-policy packages/quality/contracts/kernel-contract-approval-v2.json \
  --require-verified-reviewer-v2 --execution-mode serial_single_writer \
  --require-target-quarantine-recovery --require-real-pg-selection-replay \
  --require-selection-receipts --require-independent-authority-observer \
  --reject-self-attested-evidence --require-independent-contract-gate \
  --expect-order owner,merge,staging,production,rollback,s12 \
  --strict-staging --require-production-health --require-rollback-anchor \
  --require-guard-proof proven,fresh --reject-second-merge-authority \
  --require-exact-cells 143 --expect-terminal true
```

**两阶段授权规则**：`preapproval` 只允许 Evaluator/Judge 产证据，固定以 75 表示等待 owner；
controller 收到同 head 的签名 owner receipt 后才以独立 postapproval Attempt 运行第二阶段。
`postapproval` 的固定入口内部必须执行 controller-only merge、Worker-first admit、
US staging、production canary、rollback anchor 与 S12，且所有 origin Attempt/role 独立查 PG。
任何直接调用 postapproval、复用 proposer/reviewer Attempt、缺 owner receipt 或阶段乱序均非零。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| P0 durable recovery（唯一收集项） | `tests/durable-recovery.contract.test.ts` | 34 个 `it()` 的字面测试名（由下方库存命令直接提取） | 34 个唯一 `it()`；授权正控必须由独立 observer 直接读 append-only authority store/raw artifact；禁止共享动态 import helper、proof summary boolean、temp JSON authority 与 duplicate collection。 |

**测试库存硬阈值**: 唯一文件数 = 1；总数 = 34；不得重复收集。migration parity、
workflow bypass、result channel、full fixture/advisory/classification、projection/direct origin、
manifest/evidence schema、strict staging、terminal-order、clean-home D/A/F/E、V01-V13 exact
set、single merge authority、Reviewer-v2 approval、Reviewer effect isolation 与
execution-target logical-cycle quarantine/recovery、
serial-single-writer Red 必须保留。

**测试库存验证命令**:
```bash
TEST_ROOT="sprints/07280225-kernel-fleet-durable-recovery-r5/tests"
UNIQUE_FILES=$(find "$TEST_ROOT" -name '*.test.ts' -print0 | xargs -0 realpath | sort -u | wc -l | tr -d ' ')
IT_COUNT=$(rg -c '^[[:space:]]*it\(' "$TEST_ROOT/durable-recovery.contract.test.ts")
[ "$UNIQUE_FILES" -eq 1 ] && [ "$IT_COUNT" -eq 34 ]
# packages/brain/sprints 是指向根 sprints 的 symlink；真实 collector 必须显式排除，
# 否则同一 realpath 会被 Vitest 以两个逻辑路径执行两次。
npx vitest run --exclude 'packages/brain/sprints/**' \
  "$TEST_ROOT/durable-recovery.contract.test.ts" --reporter=verbose
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
  'semantic anchor resolves journey golden-path step ownership' \
  'P0 workflows enforce owner merge staging production order' \
  'attempt scoped result channel' \
  'authority inventory full entry fixture and advisory partition' \
  'classification decisions are append only and pre-authority creates zero obligations' \
  'owner approval binds full proposal head manifest bytes and signature' \
  'lifecycle migration preserves exact production history fixture' \
  'origin kind uses direct authority queries not module booleans' \
  'canonical manifest contains law only and exact 143 requirement cells' \
  'append only evidence schema derives expiry and independent NA review' \
  'journey projection writes cannot satisfy canonical cell gates' \
  'strict staging rejects empty skip and SHA drift' \
  'merge report cannot complete before staging production rollback and S12' \
  'S12 serializable accountant consumes exact current evidence chain' \
  'guard manifest references approved source inventory without runtime state' \
  'clean home official installer activates provider neutral guard for three providers' \
  'V01 through V13 produce append only D A F E receipts with independent effects' \
  'single merge staging production authority cannot be bypassed' \
  'deterministic reviewer v2 approval rejects advisory outcomes and stale intent' \
  'reviewer mutation surface is denied before verified approval' \
  'execution target quarantine replays real PG cycles and writes complete selection receipts' \
  'independent authority observer rejects temp self attestation and malformed rubric evidence' \
  'Controller Contract Gate rejects R14 R15 and permanent target poisoning fixtures' \
  'current controller remains serial single writer'
do
  grep -F "$COVER" "$TEST_ROOT/durable-recovery.contract.test.ts" >/dev/null
done
```
