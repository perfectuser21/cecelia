# Sprint PRD — Durable Fleet Worker bootstrap 与 Kernel 恢复闭环

## OKR 对齐

- **对应 KR**：未解析（Brain context 未返回活跃 KR）
- **当前进度**：未解析
- **本次推进预期**：交付首个可由精确 Draft PR head、真实生产证据和 owner gate 共同判定的 P0 闭环

## 背景

当前 Fleet Worker 启动、Mac-compatible single-use secret delivery、Docker-visible roots、Runner/profile/Worker/schema compatibility、Brain image 自包含、Kernel launch/watchdog readiness 之间存在分裂合同。已观察到镜像缺配置、PID 假就绪、非共享目录与 ACL/UID 不兼容、FIFO 跨 OrbStack 不相遇、超时覆盖错误阶段、Runner digest 不支持 Worker 协议、回执枚举无法持久化等失败。本 sprint 将这些接缝收敛为一个 fail-closed、可回滚、Worker-first 的 durable recovery 发布边界。

## Golden Path（核心场景）

范围锚点：Durable Fleet Worker bootstrap, Mac-compatible single-use secret delivery, protected Docker-visible roots, atomic Runner/profile/Worker/schema compatibility, self-contained Brain image, truthful Kernel launch/watchdog, Worker-first staged production proof.

运维者从基于 `dd424a61926009ac85a915b31187124b85f0ca98` 的 Draft PR 出发，严格经过 `CI → 非变更型 Evaluator/Judge → exact-head owner approval → controller merge → 合并后 US staging E2E → production canary`。CI、Evaluator、Judge 都只能产证据；owner 批准前 PR 保持 Draft、auto-merge 关闭，任何 staging/production mutation 都被拒绝。

具体：
1. CI 构建 Brain image，并在该镜像内直接导入 orchestrator、加载 `/app/config/fleet-node-profiles.json` 中三个不可变 profile；任何 worktree 补件均不得使检查变绿。
2. CI 对同一不可变 Runner digest、profile、Worker 协议及数据库 transport 枚举做原子兼容验证；缺 single-use secret 能力、UID/GID/tmpfs 所有权错误、digest/ref 不一致或缺 `fleet-worker` 枚举时 fail closed。
3. 安装/升级事务在真实 macOS + OrbStack 身份边界上建立受保护且 Docker 可见的数据根、最小只读/遍历 ACL、确定性 TMPDIR 与可回滚的 Worker plist/scripts/toolchain/credential-envelope；每个变更都有独立反事实与精确回滚。
4. CI 在隔离的候选 Worker 上验证鉴权 `/health`、`base_admitted`、`dispatch_ready`；health 使用与真实 Attempt 完全相同的数据根、挂载、ACL、UID/GID、secret channel 和 cleanup 合同，但此时不改变 staging/production。
5. CI 验证 Worker-first publication gate；remote-enabled、callback、Xian URL 可解析/可达和 immutable profile 均须预检，失败阻断远端派发与 Brain publication。
6. Controller 以 idempotency key 和分阶段有界预算获得 accepted/startup lease，再等待 ready receipt；慢 mirror、慢 image start、慢 secret handoff、取消或超时均只产生一个 Attempt，且不留孤儿。
7. Runner 在无关初始化前完成 Docker-mediated、Mac-compatible 的单次 secret 消费，在自有 tmpfs 中生成 mode 0600 凭据并返回认证回执；secret 不进入 env、argv、layer、日志、payload、callback、worktree 或 git，所有终态清除源文件及运行痕迹。
8. Kernel 启动先拒绝缺失、相对、非 Git、未挂载或不存在 worktree，再捕获有界脱敏诊断；只有 ready/ownership handshake 与初始 heartbeat 已持久化才返回成功，异步 spawn error、早退、无 ready frame 和超时均失败。
9. Watchdog 与初次启动复用同一 readiness 合同；失败保持可恢复并写结构化错误，成功后才 `resumed=1` 和 `reconcile-restarted`，Brain 重启后恰有一个 replacement、无重复 Kernel/provider Attempt，并能正常完成下一次 dispatch。
10. CI、Evaluator 与 Judge 全部锚定同一个 Draft PR head；Evaluator/Judge 只读证据且不得读取 owner approval、切 Ready、merge 或 deploy。CI Green 不授权 merge，auto-merge 始终关闭。
11. 授权 owner 对同一 exact head 明确批准后，仅 controller 可将 Draft 置 Ready 并合并；非 owner、旧 head、缺证据或旁路 workflow 全部 fail closed。
12. 合并后先在真实 US Worker staging 验证，再做 production canary；回滚恢复旧 Worker plist/scripts/toolchain/ACL 与 Brain image，并因旧 Brain packaging defect drain Kernel dispatch 直至 roll-forward。Xian OS/Tailscale 差距只输出 blocked evidence，不降低 profile、不加绕过。

## 边界情况

- 缺镜像配置、坏 worktree、child 早退、无 ready frame、诊断含 secret、bundle ref 不一致、遗漏模块或 schema 枚举不一致均必须给出非敏感机器错误码并 fail closed。
- 缺中间 ACL、私有/non-shared root、错误 host/container UID、tmpfs 所有权错误、secret reader 缺失或被取消时，不得假成功、重复 Attempt 或残留 workspace/admin/runtime/secret/state。
- slow mirror、slow image start、slow secret handoff 分别使用独立预算；总预算必须小于 Attempt lease/deadline，超时会取消仍在运行的 launch。
- rollback 中任一步失败不得留下混合 generation；恢复旧版本后保持 Kernel dispatch drained。
- `brain-ci-deploy.yml` 的 main-push production、`auto-staging-deploy.yml` 的 skipped/idle success、`deploy.yml` Fast Lane 和 `ci.yml` title/label auto-merge 均不得绕过统一 P0 gate。

## 范围限定

**在范围内**：Brain image 自包含；Kernel readiness/watchdog；Fleet Worker、Runner、profile、transport schema 原子兼容；Mac/OrbStack 数据根、ACL、UID/GID、secret channel；分阶段 transport；Worker-first CD；真实 US staging、production canary、回滚与 owner gate。

**不在范围内**：降低 immutable profile；把 operator `/tmp` copy、手工 plist、wrapper shim、手工 Worker module 或临时 60 秒超时固化为发布方案；修复 Xian 外部 OS/Tailscale 维护项；自动合并。

## 假设

- [ASSUMPTION: 当前活跃 KR 与进度未由 Brain context 返回，controller 需在收账时补齐对齐关系。]
- [ASSUMPTION: profile 中登记的 release Runner digest 是唯一发货依据；`sha256:9fc98f...` 仅为 operator canary evidence。]
- [ASSUMPTION: PR 可按构件/安装事务、transport/Kernel、Worker-first rollout 三组提交组织，但必须作为一个 Draft PR 的闭合 fail-safe 合同验收，不得分组宣称 Golden Path 完成。]

## 预期受影响文件

- `packages/brain/config/fleet-node-profiles.json`: 三个 immutable profile 与 Runner/Worker 原子发布锚点
- `packages/brain/Dockerfile`: Brain image 配置自包含
- `packages/brain/src/orchestrator/run.js`: Kernel readiness、初始 heartbeat 与 watchdog 共用合同
- `packages/brain/src/`: remote bridge、receipt persistence、版本与发布门
- `packages/brain/migrations/`: execution transport CHECK 的向前/回滚兼容
- `packages/engine/`: Fleet Worker、Runner 协议与安装/回滚事务
- `packages/engine/runners/{claude,codex,grok}/`: provider-neutral CredentialEnvelope 与真实 originating Attempt 适配
- `scripts/`: rollout、health、canary、mutation 与 rollback 验证
- `.github/workflows/kernel-fleet-p0-gate.yml`: Draft exact-head CI/Evaluator/Judge 证据与 owner/controller merge gate
- `.github/workflows/brain-ci-deploy.yml`: P0 Brain main-push 必须消费统一 gate receipt，禁止独立 production
- `.github/workflows/auto-staging-deploy.yml`: P0 staging 不得把 skipped/idle 当成功
- `.github/workflows/deploy.yml`: P0 禁用 Fast Lane/定时旁路，production 必须依赖 staging receipt
- `.github/workflows/ci.yml`: P0 禁止 title/label 启用 auto-merge，输出 exact-head CI receipt
- `packages/brain/DEFINITION.md`: Brain 行为与版本更新

## 完成定义

- [ ] 内建镜像 smoke 在精确 image 内导入真实模块并加载三个 profile，缺配置反事实稳定失败。
- [ ] 精确 pinned Runner digest 完成 single-use secret、UID/GID、tmpfs、cleanup 正反验证，旧/缺能力 digest 被拒。
- [ ] 安装事务的 root、ACL、identity、OrbStack context、bundle ref、credential-envelope、TMPDIR 每项均有 mutation 与精确 rollback。
- [ ] 真实 Attempt 与 health 共享相同 root/mount/ACL/secret 合同，并返回有界非敏感错误码。
- [ ] Kernel 初启与 watchdog 只在 handshake + heartbeat 后成功，恢复严格一次且无重复 Attempt。
- [ ] Worker-first ordering 的反事实能阻断 Brain publication，真实 US Worker canary 证明 admission、digests、cleanup 与正常 dispatch。
- [ ] rollback 恢复全部旧构件并 drain Kernel dispatch；Xian 外部差距作为 blocked evidence。
- [ ] Draft PR、auto-merge off、exact-head evidence 与 owner 明确批准门均可审计。
- [ ] workflow mutation 证明 CI-only、stale approval、Fast Lane、main-push production、skipped staging 与 title-heuristic auto-merge 都无法绕过统一门。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 凭据副本或 tmpfs/宿主残留 | Agent 前验证 broker receipt；success/timeout/crash/cancel 全终态 revoke、delete、residue=0。 |
| migration 367+ 回滚破坏旧 transport | production-shaped 真 Postgres upgrade/rollback，保留 `local-docker`/`remote-bridge` 并做 source/schema parity。 |
| workflow 旁路、Fast Lane 或 auto-merge 提前发布 | 单一 `kernel-fleet-p0-gate.yml` receipt；四个既有 workflow 均 fail closed 消费 exact merge/head/staging receipt。 |
| reverse cleanup quarantine 累积 | exact Runner 创建 nested ignored/node_modules 后由 Worker 清理；workspace/admin/runtime/quarantine/secret/state residual 全为 0，否则 admission/canary 失败。 |
| owner approval 对旧 head 生效 | approval 绑定 immutable head SHA；任何新 commit 使批准过期并把 PR 保持 Draft。 |
| Xian macOS/Tailscale 外部 blocker | 记录 machine-readable `blocked_external`，不降低 immutable profile、不以 US 成功替代 Xian。 |

## 运行时 ID 注入合同

Controller 必须从本次不可变 TaskBundle 把 `TASK_ID`、`RUN_ID`、`ATTEMPT_ID`、`CONTRACT_SHA`、`PR_HEAD_SHA`、`REAL_JOURNEY_ID`、`REAL_GP_ID`、`REAL_STEP_ID` 分别注入 CI/Evaluator/Judge 与合并后 controller job；脚本以 `${VAR:?}` fail closed，不使用历史 UUID 或源码默认值。本次 `TASK_ID=4a530430-00c5-46bc-8a4f-c0ec38025391`、`RUN_ID=fda8bfd7-fbbc-4260-a657-ea7f3b51bd16`，两者必须不同；已终态失败的 run `4bbe35de-63c1-4cfe-9b55-fea8c01a0647` 仅是不可变 Red evidence，永远不能授权当前 Generator、review、merge 或 release。语义锚点固定为生产既有且 ownership 一致的 journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`、golden path `4e5fd7eb-3823-4c57-a817-081b7fdd2eed`、step `817f59f5-02ff-4a70-bd81-f7ae65f77e02`；不得创建占位行。terminal historical run、task-as-run、TaskBundle/receipt run mismatch、stale contract round/head、cross-run artifact/result 全部 fail closed，且不消耗当前 semantic/GAN budget。

## 权威库存、分类决策与生命周期投影（R32-R33）

唯一已建立的 legacy P0/P1 库存权威是 exact main
`dd424a61926009ac85a915b31187124b85f0ca98:packages/engine/regression-contract.yaml`，
其 Git blob 必须为 `7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3`。独立 verifier
递归提取具有字符串 `id` 且 `priority ∈ {P0,P1}` 的对象、按 ID 去重后，必须得到
129 个 ID（P0=66、P1=63），排序后的 `"id:priority\n"` SHA-256 必须为
`4fcdf146ad08ab0ba349d789084fad6d85902b0e345993fb7ddf9057899a1e5f`。
verifier 禁止 import 任何 `packages/brain` Kernel Harness 实现。权威边界只在
`packages/quality/contracts/`；Brain runtime/config/report 均为 `authoritative=false`
投影，authority manifest 的每次变更都要 exact-head owner 签名。

11 元素的来源是 exact main
`dd424a61926009ac85a915b31187124b85f0ca98:packages/brain/src/lib/eleven-elements-ledger.js`
blob `e4e3bb5b4b5cbbf26ad16b4048b2c3e6228f3d09`，顺序严格为：
`FR,NFR,Invariant,判定点,保质期,死亡告警,失败语义,效果确认,输入对抗面,账本保鲜,两轴衔接`。
测试 oracle 必须从冻结 authority fixture 独立读取，禁止一边 import 被测模块一边复制相同 literal 自证。

Draft+CONFLICTING PR #4372 的 full exact proposal
`4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13` 只是一份待审批迁移输入。
其 family 分布 `0,2,2,8,6,0,1,110` 与 mapping digest
`be80793527a817611ba0698654ea858eda7c77ea9e63da937cba7b885a4d9363`
是 `imported_proposed_distribution`，不是 canonical/approved invariant 或终态阈值。
已知 H1-001/H1-002 被错误提议映射到 F08；在逐行审批前它们必须保持
`unreviewed|rejected`，绝不能产生 F08 pass。

权威数据分三层 append-only 保存：

1. `source_inventory`：原始 ID、priority、source commit/blob/path、extraction 与 digest。
2. `classification_decisions`：每个 legacy ID 的 proposal revision、proposed family、
   `unreviewed|approved|rejected|superseded`、approved family、逐 provider applicability、
   basis refs 与 owner review receipt。
3. `equivalence_obligations`：只能从已批准分类与已审 provider applicability 派生。

终态前 `unreviewed_count=0`；rejected 必须由 superseding approved decision 或显式保留
non-equivalence 关闭。固定 1161/18 阈值已撤销：只有在 129 行分类与适用性获 exact-head
owner 批准后，才从 authority manifest 动态派生 obligation exact set。F01/F06 仍保留
零 legacy mapping 的来源事实，但 unified behavior IDs 尚未建立；候选
`KH-F1-F01-U-001`、`KH-F1-F06-U-001` 只有在 owner 冻结 manifest 后才生效，禁止 prefix
regex 或预设 18 条。CredentialEnvelope 的 provider/scenario obligations 同样从已批准
manifest 派生，不信 summary count。

S0-S12 是 proposal v1，不是历史真相。main `dd424a...` 的生产历史是同一 Journey 的六行：
Planner `c5bae104-da5e-483d-b5ea-c295c90a3f28`、GAN Proposer
`d6dcdfaf-4b98-4717-bbe3-522f03f70757`、GAN Reviewer
`e2bd9263-87ef-4461-a1d5-5ff07a38b8a8`、Generator
`0cdadc1a-e3a0-46a1-8333-ebbc102883f7`、Evaluator
`1a738e05-99a7-421c-a52d-c2bb80bf19be`、Final E2E
`a6888ef3-2482-4655-8703-cf3b9f037cb9`。新 migration 必须在执行前同时重查 origin/main
与 production，选择未被 tree/DB 使用的编号 `>=368`；不得复用已被
`366_kernel_harness_failure_class.sql` 占用且 migrate.js 会静默跳过的 366。
本合同依据 exact origin/main 与 operator production schema-version evidence 冻结候选
`368_kernel_harness_authority.sql`；Generator 写入前必须再次查询两端。若 368 已占用，
必须回到 authority-manifest/owner receipt 修订，禁止静默改号或让 migrate.js 跳过。

升级在同一 Journey 上追加 lifecycle projection，不重写历史。六行的
`id,notion_id,name,description,step_number,status,promise,backbone_version,created_at,updated_at`
逐字节不变，只允许新增
`lifecycle_stage,lifecycle_order,lifecycle_name,lifecycle_promise,lifecycle_status,
is_backbone,mapping_status,mapping_reason,canonical_step_id,projection_version`。
Planner/GAN Proposer/Generator/Evaluator 可投影为 S2/S3/S4/S6 backbone；
GAN Reviewer 与 Final E2E 是绑定 S3/S6 的 legacy alias。新增恰九个缺失 canonical rows，
技术 step number 不冲突；API 按 `lifecycle_order 0..12` 排序。只有 13 backbone
projections 生成 143 cells，全部初始 `unverified`，不得冒充完成。

upgrade precondition 与 pre-commit oracle 必须在一个真 PG transaction 内验证：
Journey=1、六 UUID 全在、所有保留列的独立 baseline hash 匹配、九新 UUID 不在、
migration 编号 tree/DB 均未占；提交前历史 fingerprint 和 `updated_at` 不变、Journey=1、
13 backbones/order 0..12、4 historic backbones+2 aliases+9 new rows、143 unique cells、
endpoint 不变。logical rollback 若已有后续 evidence 必须拒绝自动回滚；否则只删除九个
exact projection rows/links、清空六旧行的本 migration projection 字段并复核完整历史 hash。
fresh DB、production-like upgrade、failure rollback 与 logical rollback 都必须真跑。

owner exact-head approval 只能把 proposed stage manifest 提升为 canonical v1，不能替代
行为等价证明。每 stage 的 `origin_kind` 严格为：
S0 `brain_task_event`；S1 `signed_intent_snapshot`；S2 `harness_attempt`；
S3 `harness_attempt_quorum`；S4 `harness_attempt_with_pr`；S5 `github_check_suite`；
S6/S7 `harness_attempt`；S8 `github_owner_review`；S9 `github_merge_event`；
S10/S11 `deployment_receipt`；S12 `brain_atomic_accounting`。
验证器须按 kind 直接查真实 Attempt 行、GitHub API、deployment receipt 或 Controller
generation/transaction；禁止通用 `exists/*Matches/*Verified` 布尔自证。

Result channel 必须由 server-derived TaskBundle descriptor 贯穿
`execution-contract → dispatcher → remote transport → Worker → attempt-runner →
docker/cecelia-runner/entrypoint.sh → callback → attempt-store`。Worker 只在 exact attempt
runtime root 解析路径，创建 mode-0600 non-symlink bounded file，验证 Runner UID 可写后才
启动 Agent，并注入唯一 `BRAIN_RESULT_FILE`；角色来自 TaskBundle top-level `role`，当前生产
尚无 `CURRENT_ROLE` env，因此不得把缺 env 的 module-load error 当产品 Red。callback 在清理
前校验 task/run/attempt/role/contract/head/lease/hash、持久化
`attempt.result.result_channel_receipt` 并返回同 hash ack；same-hash retry 幂等，
different-hash replay 冲突。缺 descriptor、EROFS、wrong binding、symlink、oversize、
malformed 时给结构化 reason code，Agent-start=0、semantic/GAN budget delta=0。

origin verifier 只查询生产现有 `harness_attempts` 列：
`id,run_id,role,provider,provider_session_id,actual_machine_id,lease_generation,status,task_bundle,result`。
contract/head 必须从 independently authenticated TaskBundle/result-channel lineage 派生；
不得查询不存在的 `actual_machine/contract_sha/exact_head_sha`。每种 Red 必须先完成依赖与
DB 初始化并到达目标生产 seam，SQL/config/env/重复收集错误不算行为 Red。

## R34-R39 权威修正：库存、证据 SSOT 与终态顺序

以下条款覆盖本 PRD 中任何把 imported proposal、journey projection、summary boolean 或
固定 receipt count 当成权威的旧表述。

### 精确库存与 append-only 分类决策

- 生产历史 Journey 固定为 `bb8cc561-b3ee-4fec-b74d-2255694bd963`。六行十个保留列按
  `step_number,id` 排序、日期 ISO 化、固定 key 顺序 compact JSON 后 SHA-256 必须为
  `d74103b146f2261c47c20ed1880830f8bd98adcdfee4c53854a9b9c5d2006cfd`；同时保存 exact
  六行 fixture，hash 不可替代逐字段 diff。
- legacy inventory 的 full 129-entry canonical JSON 必含
  `id,priority,feature,name,scope,tags,method,test,steps,evidence`，按 id 排序且递归 key 排序，
  字节数 `56518`、SHA-256
  `bfcb7a7678d5a1e1e3076ca27e34f0b01978ca590780f33d7ddb551f9615914d`。
- advisory classification digest 是
  `a8e979f936ea1d5072d148cd3500c32231e9c3227f438d96bd4bd2258470e7b3`，只表示
  `76 machine_recommended + 53 needs_human_review = 129`。proposal F08=110 中
  `66` 行机器建议迁出、`44` 行仍 unreviewed/out-of-taxonomy；110 行完整语义字段中
  `staging|promote|rollback` 命中数必须为 0。至少 43 个
  `ci=32,doc=2,export=5,infrastructure=1,regression=3` scope 只是
  provider-independent 候选，仍需 owner 审批适用性。
- `classification_decisions` 只追加，字段至少含
  `decision_id,legacy_id,priority,source_entry_sha256,proposed_family,proposal_commit,
  proposal_state,machine_recommendation,machine_state,machine_family,confidence,
  provider_applicability,evidence_refs,actor_kind,created_at,supersedes`。状态仅
  `machine_recommended|needs_human_review|owner_approved|owner_rejected|superseded`；
  禁 UPDATE/DELETE。只有最新有效 owner-approved decision 可派生 obligation。
- owner 批准前每行 `approved_family=null` 且 derived obligation count=0。
  pre-authority receipt 永久保存为 `inadmissible_pre_authority`,
  `count_toward_terminal=false`，不得删除、重解释或批量转绿。

### 权威 manifest 与 evidence storage

Git 中 `packages/quality/contracts/kernel-harness-authority-manifest.json` 只保存 law：
manifest schema/version/id/source SHA/owner approval/supersedes/digest；13 stage 的 predecessor、
accepted origin、advancement；11 个 ASCII key 与中文 label；143 个 cell 的 requirement digest、
正/反/恢复 oracle ID、required origin、TTL/grace/death/alert、NA policy。manifest 不保存
current color/state。每次 manifest byte 变化都使旧 owner approval 失效。

新增以下 append-only 表，`journey_step_links` 仅作 `authoritative=false` 投影：

1. `kernel_harness_manifest_versions`
2. `kernel_harness_origin_receipts`
3. `kernel_harness_cell_evidence`
4. `kernel_harness_terminal_accounting`

cell event state 仅为
`unproven|pending|blocked|failed|passed|na_requested|na_approved|expired|revoked`；
只有当前且未过期的 `passed|na_approved` 满足 gate。expiry 必须由查询时
`valid_until` 比较得出，不依赖 scheduler；scheduler 另发 death alert/revocation 并有
dead-man heartbeat。NA 必须 manifest 允许，producer 只能请求，独立 reviewer 必须在
attempt/session/principal/trust-domain 上不同并签名同 run/manifest/stage/cell/artifact/
requirement/reason/scope/counterfactual/valid_until；P0 默认 `na_allowed=false`。

### 直接 origin 与严格终态

S0-S12 origin_kind 固定为：
`brain_task_event,signed_intent_snapshot,harness_attempt,harness_attempt_quorum,
harness_attempt_with_pr,github_check_suite,harness_attempt,harness_attempt,
github_owner_review,github_merge_event,deployment_receipt,deployment_receipt,
brain_atomic_accounting`。origin 与 receipt assembler/issuer 分离，验证器直接查询
task event、真实 `harness_attempts`、GitHub API、deployment store 和 Controller transaction；
不得信被测模块返回的 `exists/*Matches/*Verified`。

现有 `journeys` PATCH/upsert、cascade green、eleven-elements regex、nightly “any green”、
ledger aggregate 与 generic `action_receipts` 都不能满足 canonical cell。
`staging_e2e_results` 的 S10 gate 必须有至少一个 required test、FAIL=0、required SKIP=0、
deployed SHA 与 tested SHA 非空且都严格等于 merge SHA，并绑定 authenticated environment
receipt。`promote_status=promoted` 与本地 version file 不能证明 S11；S11 必须有 production
deploy receipt、真实 health/build SHA 与 rollback anchor。

现有 `kernel-handlers report` 不得在 staging task 尚未执行时标 run done/task completed。
唯一终态顺序是
`Draft → CI → Evaluator → Judge → exact-head owner → merge → staging → production →
rollback anchor → S12`。S12 由独立 accountant 在 `SERIALIZABLE` transaction 与 run
advisory xact lock 下，直接验证 exact 143 current cells、S0-S11 连续 predecessor chain、
merge=staging=production SHA、生产 health/rollback/report/learning/regression/external-effect
receipts；随后在同一 transaction 插入 S12 evidence、terminal accounting 并完成 run/task。
外部效果先走 idempotent outbox 并持久化 receipt。任何 missing/expired/blocked/failed cell、
空或全 SKIP staging、SHA drift、promoted 无 health、缺 rollback/report/effect 均保持
non-complete。

### 安全启用

owner 先审批 stage/family/classification authority；再加表/view 和 manifest compiler；
origin adapters dual-write + shadow compare；S12 在 N 个真实 run shadow-run 并做 death-alert
drill；之后才切 completion gate、Journey API 改读 projection，最后退役 legacy
direct-green/self-oracle 写路。Draft #4372 仅是 provenance，不得 whole cherry-pick。

## R40-R42 provider-neutral Guard Ledger 与 D/A/F/E 权威

exact main 的 Claude 配置、用户目录手工 symlink、单独 hook 文件和 generic
`action_receipts` 都不是统一 guard 权威。root `.claude/settings.json` 只接
`dev-mode-tool-guard`，`packages/engine/.claude/settings.json` 仅在该目录作为 Claude
project root 时接部分 hook；现有 installer 不安装完整 pre-push，Codex 明确禁 hooks，
Grok 无等价 native hook。因此 Claude native hook 只可作早期反馈；V01-V07 的权威必须位于
provider-neutral Runner 文件系统/命令/result/callback broker，V08-V13 位于
Kernel/GitHub/release server gate。Stop 只做清理/协调，永远不能完成 run/task。

### 静态 law 与 append-only fire evidence

`packages/quality/contracts/kernel-guard-manifest.json` 只引用 R34 的 129-row source SSOT，
不复制或预先转绿。每个 behavior 绑定 origin path/blob/row digest/priority、
classification owner receipt、protected action/resource、deny/near-allow/recovery predicate、
fail mode、精确 reason code、production seam component/path/symbol、provider binding、
V01-V13 counterfactual vector、D/A/F/E oracle 与 supersedes。classification 未
owner-approved 时 coverage=0；任何 source/provider binary/launcher/manifest digest 漂移
使 proof stale。

新增 append-only `guard_evidence_receipts`，至少包含
`id,run_id,attempt_id,manifest_digest,behavior_id,behavior_digest,vector_id,provider,
provider_build_digest,launcher_digest,environment_class,stage,polarity,observer_class,
observer_identity,subject_class,occurred_at,reason_code,facts,raw_artifact_digest,
predecessor_receipt_id,idempotency_key`。DB role/trigger 必须拒绝 UPDATE/DELETE；原始证据
content-addressed；受保护动作写 receipt 失败即 fail closed。`guard_proof` 只能是 SQL
view/纯查询，返回 `proven|disproven|incomplete|stale`、receipt IDs、missing stages 与
reason，禁止持久化 summary boolean。

- D：exact origin row 与 compiled manifest digest 一致。
- A：从 `mktemp` + `env -i` 的 clean HOME/XDG/GIT/Claude/Codex/Grok root，只运行官方
  installer 和真实 Kernel launcher；解析实际 effective config/argv/realpath/digest，
  证明权威 seam 已加载。
- F：真实 deny/near-allow/recovery vector 穿过 provider CLI/Runner production entry，
  由 production seam 发出精确 decision/reason。
- E：不同 observer process 独立读取 bare refs/worktree/index/log/result/callback/DB，
  证明 protected effect 未发生或恢复恰一次。F/E 要求
  `observer_class != subject_class`，E 引用同 vector F。

每个适用 behavior 都必须有 deny、修复一个前置条件的 nearby allow、exactly-once recovery；
永久拒绝不是通过。proof failure 使用 R42 的精确
`ORACLE_D_*|ORACLE_A_*|ORACLE_F_*|ORACLE_E_*` enum，stderr prose、exit 0、hook 直接调用、
手工复制 settings 或 subject self-attestation 均不是证据。

### V01-V13 与生产 reason code

exact vectors 为：
V01 Write/Edit protected branch；V02 shell redirect/sed/rm protected mutation；
V03 primary repo checkout/switch；V04 secret input 经 write/shell/copy/redirect；
V05 secret output 经 stdout/stderr/result/artifact/callback；V06 failed/missing precheck push；
V07 PR before TDD/DevGate；V08 merge without current-head Evaluator；V09 merge without current-head
Judge/human policy；V10 merge without required checks 或 second merge authority；V11 Stop/complete
while live/unknown；V12 promote on FAIL/SKIP/empty/SHA drift；V13 rollback without production anchor。

reason code exact set 至少为
`KH_G01_PROTECTED_BRANCH_WRITE,KH_G01_PRIMARY_REPO_CHECKOUT,
KH_G02_SECRET_LITERAL_INPUT,KH_G02_SECRET_OUTPUT_EGRESS,KH_G03_PRECHECK_FAILED,
KH_G03_REMOTE_REF_POLICY,KH_G04_TDD_ORDER_INVALID,KH_G04_DEVGATE_FAILED,
KH_G05_ATTEMPT_STILL_LIVE,KH_G05_LIVENESS_UNKNOWN,
KH_G06_EVALUATOR_MISSING_OR_STALE,KH_G06_JUDGE_MISSING_OR_STALE,
KH_G06_HUMAN_REVIEW_REQUIRED,KH_G07_REQUIRED_CHECKS_UNSATISFIED,
KH_G07_MERGE_AUTHORITY_CONFLICT,KH_G08_STAGING_NOT_PASS,KH_G08_SHA_DRIFT,
KH_G08_PRODUCTION_RECEIPT_MISSING,KH_G08_ROLLBACK_ANCHOR_MISSING,
KH_ALLOW_POLICY_SATISFIED,KH_RECOVERY_PRECONDITION_SATISFIED`。

clean-home machine proof 必须从隔离 bare origin/clone/protected branch/task worktree，经真实
Claude/Codex/Grok CLI 与 Kernel launcher 发 V01-V13，记录 executable realpath/digest、
provider version、launcher argv 与 before/after Merkle；独立 observer 验证三 provider
对相同 vector 得到相同 decision/reason/effect。必须覆盖 UserPromptSubmit secret、Write/Edit
output secret、direct shell/git push、缺 precheck、stale CI/Evaluator/Judge/owner、CI-only
merge、queued/empty/all-SKIP staging、production missing health/rollback、Stop completion 与
Journey PATCH green。任何 activation/fire/expiry/death gap 阻断 S12。

### 单一 merge、review、staging 与 production authority

`ci.yml` 的 title-based auto-merge 和所有 main-push/scheduled/Fast-Lane/manual production
旁路必须删除或被同一 Controller policy cryptographically fenced。风险策略由一个 versioned
exact-head receipt-backed Controller policy 决定；first/new/high-risk/authority change 强制
owner review。S10 live consumer 必须产生 authenticated
`deployed_sha=tested_sha=merge_sha`、required tests>0、FAIL=0、required SKIP=0、
environment/log/artifact digest 与 freshness。S11 只接受 Controller-governed production
receipt、production health self-reported exact build SHA、rollback anchor/drill receipt。
任何 merge/staging/production guard 缺 D/A/F/E 或真实 effect receipt，S12 保持 non-complete。

## R43-R44 合同批准归一化与 Reviewer 只读效果隔离

Reviewer 的 `decision.outcome`、PASS/APPROVED prose 与 `completed_with_concerns` 都不是批准权威。
Controller 必须接收 versioned reviewer-v2 envelope，完整包含七个固定 rubric dimension、
每项 `0..10` 整数分、validation evidence、`judgments_written`、task-intent revision/digest、
contract branch/full SHA/content digest、exact head、reviewer skill digest 与 approval-policy
version。只有 clean `completed` Attempt、七项都 `>=7`、Controller 在 frozen exact head
独立重跑 Contract Gate 与完整 Red inventory 后，确定性代码才可写 append-only approval
receipt；模型不得选择最终 approval enum。

Reviewer 结果必须来自 R31 attempt-scoped `result_channel_receipt`，精确绑定
task/run/attempt/role=reviewer/session/lease/contract/head/intent/file hash，且 durable ack
先于 cleanup。source `.brain-result.json`、`/tmp`、stdout prose、provider native structured
output 或无 file receipt 的 callback 全部计零。Controller 在写 verdict/approval 前锁住并
重读 task；任何新 addendum、intent revision/digest、contract/head、skill digest、gate
artifact 或 Red inventory 漂移都返回 `STALE_INTENT_REVISION` 并重派 proposer/reviewer。
same-hash retry 幂等，different-hash、cross-role/session/task/run/head/lease replay 冲突且不
消费 semantic/GAN success budget。

批准 receipt 至少绑定 reviewer/proposer Attempt、contract/head/content、task intent、
七分 JSON+digest、Controller-owned Contract Gate artifact、Red inventory/evidence digest、
skill/policy version、result-channel receipt 与时间。以下反事实必须逐一拒绝并给结构化
reason：`completed_with_concerns+APPROVED`、任一 6 分、缺维度、prose-only、无
`BRAIN_RESULT_FILE`、source result、callback-before-file-ack、dispatch 后任务 addendum、
contract/head/skill 漂移、different-hash duplicate、stale lease；只有 clean completed 且
七项全 `>=7` 的同一 frozen intent/head 可批准。hop/deadline/no-push/no-verdict/cost failure
只能使 run 失败，永不转换为批准；`cost_usd` 没有权威 writer 时不得宣称为安全上限。

Reviewer execution surface 除 source checkout 只读外，还必须无 Brain/GitHub/deploy mutation
credential，并由 egress/API policy 拒绝 registry、decision、task、PR、merge、deploy、
staging、production mutation；受控 POST probe 必须产 deny receipt。Reviewer skill 中
force-APPROVED/oscillation default、legacy graph default 与“批准前写 registry/decision”
语义必须删除；skill、Controller policy 与 tests 共享一个 versioned approval law。
judgment/registry/outbox 只能在 verified v2 approval 后由 Controller-owned idempotent outbox
写入，REVISION/stale 写入数为 0，成功恰一次。直到本 gate 与 result-channel 在生产独立
smoke Green，当前 broad Generator 只能由一次性 bootstrap owner release 放行；该 release
精确绑定 task/Reviewer/contract/intent/head、任何变化即失效，且绝不能授权 merge/deploy。

## R45 当前执行模式与未来多 workstream 权威

本 sprint 的 task-plan 可按产品 gate 分段，但当前 Controller 没有 DAG scheduler、
namespaced segment verdict 或 single-PR integrator，因此本轮必须声明
`execution_mode=serial_single_writer`、`parallel_width=1`。所有 workstream 形成一条显式
`depends_on` 链；除只读审计外，同一时刻只允许一个代码 writer。不得把多 task JSON、
可用 slot 或 segment PASS 描述成 runtime parallel/global PASS。

任何未来把 `parallel_width` 提升到 `>1` 的变更，必须先交付并重新获批：
FrozenWorkstreamPlan（绑定 run/task/approved contract/intent/base SHA 的 DAG、文件 allowlist、
resource/provider/machine 与 plan digest）；append-only WorkstreamState 和
`(run,workstream,attempt_kind,generation)` exactly-once identity；ready-set scheduler、
file-conflict lock/capacity/restart reconciliation；同 base 的 isolated private writer；
Controller-only IntegrationLease/CAS 按 DAG 确定序集成 immutable commit/parent/tree/patch/
touched-files/test evidence；final head 冻结后重新跑一次完整 CI→Evaluator→Judge→owner→merge。
共享高冲突文件必须有 serial edge；segment receipt 只能释放依赖，不能替代 global gate。

本轮机器反事实必须证明：plan 有 cycle/unknown dep/duplicate ID/重叠 writable files 或 writer
尝试 canonical Draft branch 时拒绝；当前 advertised width 始终 1；四个 ready labels 仍只
分配一个 writer；restart 不重复；segment PASS 不变 global state；final-head drift 使
Evaluator/Judge/owner receipts 全失效；始终只有一个 Draft PR 与一个 merge receipt。若这些
并行构件尚未部署，验证器必须返回 `SERIAL_SINGLE_WRITER_REQUIRED`，而不是模拟并行成功。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 分阶段有界预算；总启动预算必须小于 Attempt lease/deadline，具体生产值待合同 GAN 基于实测确定
- 频控: 同一 idempotency key 最多一个活跃 Kernel/Attempt/provider 尝试
- 版本要求: Xian macOS 必须达到 immutable profile 要求 15.7.4；Runner/Worker/profile 使用同一精确 digest/generation；Brain 必须 bump 版本
- 可观测: 失败写结构化、可界定、脱敏机器错误码；成功仅在明确 receipt/heartbeat 后记录，所有证据锚定 exact Draft PR head

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [恢复真相] watchdog_overdue 后仅可经 orphan requeue、外部 PR/产物真相核查后安全重跑（来源: area）
- [语义成功] 通知/写库成功必须验证 sent/accepted 等语义字段，不得只看 ok=true（来源: area）
- [依赖修复] dep-audit 新 advisory 先检查 fixAvailable，兼容修复不得先加白名单（来源: area）
- [Relay 心跳] 长 CI 等待须持续更新 relay 心跳，禁止 reaper 将存活 session 误标失败（来源: area）
- [毕业门禁] 测试毕业 rename 后 push 前运行 lint-tdd-commit-order 与 check-test-coverage（来源: area）
- [Oracle 实跑] 合同批准前记录 manual oracle 真实 exit code 并确认目标解释器启动（来源: area）
- [Shell 展开] manual node 命令须逐条真跑，bash -n 不足以证明模板字符串安全（来源: area）
- [Smoke 1784808160] smoke 铁律（来源: area）
- [Smoke 1784806023] smoke 铁律（来源: area）
- [多轮扫描] 测试须覆盖不重置状态且时间真实流逝的多轮扫描（来源: area）
- [重扫幂等] 周期重扫触发外部付费调用前必须检查是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小关系必须有显式 invariant 断言（来源: area）
- [环境路由] contract 环境语义必须与真实执行环境一致，不得用环境文本绕过 theater 检查（来源: area）
- [Payload 环境] target_environment 必须在任务 payload 正确登记（来源: area）
- [Judge 证据] Brain judge 结果须含顶层及逐行为 exit_code、log_tail 和 behavior_tests（来源: area）
- [字段长度] 非天然有界的数据写入受限 DB 字段前必须显式约束长度（来源: area）
- [复活核查] 恢复退役功能前须读取删除历史与旧实现核对 death cause（来源: area）
- [失败分支] 返回 null/false 的失败合同必须显式处理，不能依赖 catch（来源: area）
- [Smoke 1784543934] smoke 铁律（来源: area）
- [收账探针] journey feature 更新时间异常可作为 report 漏跑探针（来源: area）
- [外部完成] controller 不能仅凭进程 exit code 判定 report 完成，须核验外部产物（来源: area）
- [人工接管] host/环境白名单断言必须覆盖 headed 人工接管（来源: area）
- [点火锚点] headed relay payload 须携带 base_repo/pr_url 且分支可关联 task（来源: area）
- [退役实证] 退役判断必须基于生产数据和真实消费方，不靠记忆（来源: area）
- [后台告警] catch 吞错的后台 job 须有失败计数和连续失败告警（来源: area）
- [表名认领] 建表或复用表前须核对全部写入方并做 schema 对齐（来源: area）
- [消费方] 新后台 job 必须声明真实消费方（来源: area）
- [多端完整] 多设备/OS 数据模型必须有对应展示与验收区分（来源: area）
- [跨脚本语义] 判变端与终验端对同一未知值必须采取一致策略（来源: area）
- [Git Ref] ref 存在性须以 git rev-parse --verify ref^{commit} 判定（来源: area）
- [测试隔离] smoke 使用真实 worktree 时不得触碰生产资源（来源: area）
- [部署失败] 部署链失败不得 warning 降级，须告警并非零退出（来源: area）
- [生产自报] 部署判变基准使用生产实体自报对账，不得使用工作区 diff（来源: area）
- [测试质量] 异步测试须真实 await 被测函数（来源: area）
- [合同表格] Test Contract 路径格式必须符合 checker 解析合同（来源: area）
- [Red 提交] Red commit 只暂存精确测试路径，不得广泛 git add（来源: area）
- [调度真验] 调度接线回归须验证真实模块行为，源码检查不能替代 P0 行为证明（来源: area）
- [Scheduler] 新 cron 接入 scheduler-jobs，禁用 deprecated tick-runner 路径（来源: area）
- [Merge 权限] generator 禁止自行 merge，merge 权仅属 controller 且受人工门控制（来源: area）
- [环境继承] headed relay 子 shell 所需 harness 变量必须显式注入（来源: area）
- [历史合同] 复用历史 E2E 断言前须核对本次真实派发和执行路径（来源: area）
- [共享 CI] 共享 CI 基础设施文件默认禁区，变更须有明确合同授权（来源: area）
- [Exact Head] PR 被提前合并时仍须用 head SHA 核对 evaluator/judge 证据（来源: area）
- [Smoke 1783850042] smoke 铁律（来源: area）
- [Brain Smoke] feat 且改 Brain 源码时须同步 smoke 与 allowlist 登记（来源: area）
- [Task Type] 新 task_type 须完整覆盖路由、执行器、relay 与 dispatcher 接线（来源: area）
- [服务存活] 常驻服务存活须同时验证 launchctl 状态与端口监听（来源: area）
- [Mac 常驻] 美国 Mac mini 常驻服务使用系统 LaunchDaemon，不得依赖不存在的 GUI LaunchAgent 域（来源: area）
- [Daemon 清单] 新常驻宿主服务须登记 launchd-patrol manifest（来源: area）
- [Smoke 1783693282] smoke 铁律（来源: area）
- [单 Slot 串行] 单 slot 只推进一个任务，任务内只允许一个写代码实现者（来源: area）
- [环境假设] 环境接缝值不得写死，必须推导或真机校准（来源: area）
- [真环境] 依赖生产/真机的接缝未在目标环境验证只能标 logic-done-pending（来源: area）
- [多租户测试] 涉及租户数据的测试默认至少两个租户并断言隔离（来源: area）
- [凭据安全] secret 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文入日志（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权不得发货（来源: area）
- [租户隔离] 租户数据读写必须绑定当前租户，禁止混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

本 E2E 是 controller 驱动的两阶段状态机，不是允许 Evaluator 越权的一段直通脚本。`preapproval` 阶段只构建/验证候选、运行独立 Evaluator/Judge 并以退出码 75 明确暂停；它必须证明 Draft、auto-merge off、staging/production byte-identical。controller 只有在收到同一 exact head 的 owner receipt 后才能运行 `postapproval`；后者执行唯一 merge、真实 US staging、production canary、rollback anchor 与 S12 完成。任何跳过 pause、阶段乱序或 owner receipt 不匹配均失败。

```bash
#!/bin/bash
set -euo pipefail
: "${E2E_PHASE:?preapproval|postapproval}" "${TASK_ID:?}" "${RUN_ID:?}"
: "${ATTEMPT_ID:?}" "${CONTRACT_SHA:?}" "${PR_HEAD_SHA:?}"
: "${PR_NUMBER:?}" "${US_WORKER_URL:?}" "${US_WORKER_SSH:?}" "${FLEET_TOKEN_FILE:?}"
: "${CANDIDATE_BRAIN_IMAGE:?}" "${CANDIDATE_BRAIN_IMAGE_DIGEST:?}"
: "${CANDIDATE_RUNNER_REF:?}" "${CANDIDATE_BUNDLE_REF:?}" "${DB_URL:?}"
: "${PROD_BRAIN_URL:?}"

test "$TASK_ID" = "4a530430-00c5-46bc-8a4f-c0ec38025391"
test "$RUN_ID" = "fda8bfd7-fbbc-4260-a657-ea7f3b51bd16"
test "$TASK_ID" != "$RUN_ID"

if [ "$E2E_PHASE" = preapproval ]; then
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
  --expect-order owner,merge,staging,production,rollback,s12 \
  --strict-staging --require-production-health --require-rollback-anchor \
  --require-guard-proof proven,fresh --reject-second-merge-authority \
  --require-exact-cells 143 --expect-terminal true
```

## journey_type: agent_remote
## journey_type_reason: 核心路径涉及 Fleet Worker、Runner、remote bridge 与 Kernel 远端执行协议。
## target_environment: linux_server
## target_environment_reason: 最终 E2E 必须在真实 US Worker staging 与生产 Brain/Worker 上完成，不能用本地或合成 loopback 代替。
## journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
## golden_path_id: 4e5fd7eb-3823-4c57-a817-081b7fdd2eed
## step_id: 817f59f5-02ff-4a70-bd81-f7ae65f77e02
