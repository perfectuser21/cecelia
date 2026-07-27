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

## F1 生命周期 SSOT 与 legacy 行为库存

本 sprint 只把 Draft+CONFLICTING PR #4372 的 `origin/cp-07271751-51836fb2@4dc3b69a` 当作带 provenance 的迁移输入，不把它当 operational truth，也不允许它独立 merge。唯一 F1 Journey 是 `bb8cc561-b3ee-4fec-b74d-2255694bd963`。S0-S12 的 stage ID、名称、顺序、promise 与稳定 step ID 必须逐字继承该 intended baseline；尤其：

- S2 `Planner` = `c5bae104-da5e-483d-b5ea-c295c90a3f28`
- S3 `Contract GAN` = `d6dcdfaf-4b98-4717-bbe3-522f03f70757`
- S4 `Generator` = `0cdadc1a-e3a0-46a1-8333-ebbc102883f7`，Draft PR 是其输出 receipt，不是新 stage
- S6 `Evaluator` = `1a738e05-99a7-421c-a52d-c2bb80bf19be`

任一 rename、merge、split、shift 或新增 stage 都必须使 manifest/migration/regression/runtime parity fail。产品 F2 step 仍只作 `product_anchor`，另行绑定 `lifecycle_ssot_ref=kernel_harness_f1_baseline/S0-S12`，不得冒充整个 F1 生命周期。

legacy 库存固定为 `KH-F1-F01..F08`，baseline 总计 129 个行为（P0=66、P1=63），family 分布严格为 `F01=0,F02=2,F03=2,F04=8,F05=6,F06=0,F07=1,F08=110`。F01/F06 的零映射与 F08 的 110 偏斜必须保留为 typed audit gap，禁止用合成 8×3×3 receipt 数宣称等价。每个 legacy behavior 保留 `evidence_mode` 与 `assertion_ref`；源码 anchor 或 `audit_status=active` 不是 proven-to-fire evidence。统一 `KernelPolicyGate` receipt 必须按 canonical `family_id+legacy_behavior_id+provider+phase+subject` 建键，并包含 run/attempt/hop/head/provider/machine/lease/scenario/decision/reason/probe/exit/evidence/freshness/recovery binding。

## R21-R27 终态证明合同（权威）

1. 全部 129 个 legacy 行对 Claude、Codex、Grok 的 normal/violation/recovery 均适用，canonical required exact-set 固定为 `129×3×3=1161`。`legacyReceipts.length=1161`，observed key 只能从逐条验签 receipt body 的 `legacy_behavior_id+provider+scenario` 派生，不能信独立 summary array。F01/F06 保持 legacy count=0，另以 stable unified family behavior ID 产生 `2×3×3=18` 个 family receipt bodies；不得替代或膨胀 1161。
2. runtime activation required set 必须从 canonical F01-F08 construct 与实际 production entrypoint 生成，覆盖 branch-protect/main-repo-write、credential/bash/local-precheck、DevGate Red→Green/DoD、stop/watchdog、Evaluator/Judge、GitHub rules、staging/promote/rollback。observed set 只从 authenticated fire receipt body 派生；root `.claude/settings.json`、`packages/engine/.claude/settings.json`、installer/symlink、Kernel provider-neutral dispatcher 任一 hop 被删都必须 fail closed。
3. CredentialEnvelope 必须产生恰好 24 个 receipt-derived keys：三个 provider 各一 normal、literal/replay/expired/wrong-attempt/wrong-account/wrong-machine 六 violation、fresh-envelope recovery 一条。每条绑定 provider/session/account/requested+actual machine/origin Attempt/contract/head/lease/decision/effect/evidence/signature；recovery 链接 violation 与 fresh envelope，旧 envelope 不可复用，secret 在 argv/env/log/receipt/residual 为 0。
4. 每个 receipt 共享 current `task_id/run_id/approved_contract_sha/exact head or release lineage`，但拥有自己的 originating `attempt_id/provider/session/machine/role/lease_generation`。verifier 必须查询 durable Attempt row；wrong provider/session、cross-run、stale lease、nonexistent attempt 全拒绝。S6 Evaluator 与 S7 Judge 使用不同 Attempt 和 session；Claude/Codex/Grok receipt 来自 provider-matching Attempt。不得把所有 receipt 强制绑定本次 Codex proposer Attempt。
5. result-channel 正控是精确例外：real Worker 调用必须显式获得当前 proof Agent 的 `ATTEMPT_ID/CONTRACT_SHA/role/RUN_ID/PR_HEAD_SHA`，positive receipt 必须逐字等于这些输入，不能接受模块返回的自洽 ID。missing/EROFS/source-stale/wrong-binding/symlink/oversize/malformed/crash/cancel 均在真实 Runner seam fail closed并保留 durable hash receipt。
6. Kernel readiness 正控必须启动 built image 或 exact `packages/brain/src/orchestrator/run.js`，child 真获取 Controller lease/generation、构造真实依赖并持久化首个 fenced heartbeat；parent 独立查 PG 后才成功。只发 `kernel-ready` frame 而无 DB lease/dependency/heartbeat 的 child 必须失败；同时保留 early exit、timeout、async spawn error、lease busy、stale generation。
7. workflow authority 只能由真实 GitHub API 回读的 run ID、check-suite ID、exact head、actor、签名 owner receipt 与 repository-rule snapshot证明。JS 模块返回预期数组/布尔值不是证据。
8. S12 的 143 个 canonical stage×element exact keys 终态只能是 `pass` 或具独立 review receipt 的 `na_with_reason`；pending/blocked/stale/expired/gray/null 均为 0。S12 必须消费八类结构化 Green receipt：`production,rollback,report,external_status,legacy_equivalence,family_gap,provider_activation,credential_envelope`。八类任一 missing、partial、invalid digest、wrong identity、stale 或 non-Green 均保持 `terminalComplete=false`；终态还要求 legacy receipt bodies=1161、family receipt bodies=18、CredentialEnvelope receipt bodies=24，required=receipt-derived observed，所有 missing/pending/blocked/stale/expired/inferred/duplicate=0。

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

```bash
set -euo pipefail
: "${TASK_ID:?}" "${RUN_ID:?}" "${ATTEMPT_ID:?}" "${CONTRACT_SHA:?}" "${PR_HEAD_SHA:?}"
: "${US_WORKER_URL:?}" "${FLEET_TOKEN_FILE:?}" "${CANDIDATE_RUNNER_REF:?}" "${DB_URL:?}"
bash scripts/kernel-fleet/run-result-channel-proof.sh \
  "$US_WORKER_URL" "$FLEET_TOKEN_FILE" "$CANDIDATE_RUNNER_REF" \
  "$TASK_ID" "$RUN_ID" "$ATTEMPT_ID" "$CONTRACT_SHA" "$PR_HEAD_SHA" reviewer
DB_URL="$DB_URL" bash scripts/kernel-fleet/verify-lifecycle-legacy-equivalence.sh \
  --task "$TASK_ID" --run "$RUN_ID" --requesting-attempt "$ATTEMPT_ID" \
  --contract "$CONTRACT_SHA" --head "$PR_HEAD_SHA" \
  --legacy-receipt-bodies 1161 --family-receipt-bodies 18 --verify-origin-attempts
DB_URL="$DB_URL" bash scripts/kernel-fleet/verify-provider-credential-envelope.sh \
  --task "$TASK_ID" --run "$RUN_ID" --requesting-attempt "$ATTEMPT_ID" \
  --contract "$CONTRACT_SHA" --head "$PR_HEAD_SHA" \
  --providers claude,codex,grok --receipt-bodies 24 --verify-origin-attempts
DB_URL="$DB_URL" bash scripts/kernel-fleet/verify-lifecycle-terminal-accounting.sh \
  --task "$TASK_ID" --run "$RUN_ID" --requesting-attempt "$ATTEMPT_ID" \
  --contract "$CONTRACT_SHA" --head "$PR_HEAD_SHA" \
  --require-obligations production,rollback,report,external_status,legacy_equivalence,family_gap,provider_activation,credential_envelope \
  --expect-premerge-noncomplete
```

## journey_type: agent_remote
## journey_type_reason: 核心路径涉及 Fleet Worker、Runner、remote bridge 与 Kernel 远端执行协议。
## target_environment: linux_server
## target_environment_reason: 最终 E2E 必须在真实 US Worker staging 与生产 Brain/Worker 上完成，不能用本地或合成 loopback 代替。
## journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
## golden_path_id: 4e5fd7eb-3823-4c57-a817-081b7fdd2eed
## step_id: 817f59f5-02ff-4a70-bd81-f7ae65f77e02
