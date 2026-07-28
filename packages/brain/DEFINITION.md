# Brain 模块定义

**版本**: 1.268.26

## Unified Kernel Golden Path exact-image candidate

- 旧 Claude/relay fixture 已跟随 Kernel 的 lease generation、post-diff risk、
  fleet bridge credential 与 ReleaseRun-only deploy authority 合同更新，继续验证
  fail-closed 行为而不恢复旧旁路。
- PostgreSQL 集成测试使用每轮唯一业务标识和隔离 deploy status 文件，避免残留
  测试数据或宿主持久状态造成假红；OKR 链路不再用 silent return 掩盖前置失败。
- 重复 Jest 回归已迁到 Vitest，evaluator extractor 钉住当前 Skill 合同版本。

## Unified Kernel Golden Path + durable ReleaseRun

- Codex review trust boundary、Kernel 11 要素等价 runtime 与 durable ReleaseRun
  已在同一候选树集成；exact-head confirmed merge receipt 唯一创建 ReleaseRun。
- Merge effect 在 intent 前和真实 GitHub effect 前都重新验证 approved contract、
  exact diff/check/base、post-diff risk 与 PostgreSQL durable review assessment。
- Migration 374–380 顺序覆盖 ReleaseRun、equivalence runtime/cases、Codex callback
  与 typed rollback；当前仅为本地候选，未部署，live proof 仍诚实为 0/99。
- Exact-image 合并保留 ReleaseRun sibling controllers 与 rollback runtime，同时
  提供完整 Brain scripts、Engine package 和 immutable `/brain -> /app`。
- `/scripts -> /repo/scripts` 让 `/app/src` 的 ReleaseRun 生产 import 与 sibling
  controller 共用同一份 immutable bytes；exact-image graph 同时加载 ops 和
  ReleaseRun adapter，Brain 提前退出会立即携带日志 fail-closed。

## Kernel exact-image boot graph closure

- `/app` 继续是唯一 Brain source copy；immutable `/brain -> /app` 与完整
  `/engine` package 恢复 production seam 原有的跨 workspace 相对 import，
  完整 `/app/scripts` 同时提供 fleet mutation broker 与 server runtime。
- CI build 必须注入 exact 40-hex `GIT_SHA`。Docker runtime contract 在镜像内
  回读 image ID/SHA、导入 Brain→Engine→Brain production graph，并通过隔离
  pgvector 实例验证真实 migration、listen 与 health 的有界启动。
- 无 Docker只有显式 allow-skip；required 模式、SHA mismatch、import/startup
  failure 或任何 container/network residue 均失败。既有 ACL/xattr contract
  保持不变。
- 回退：`bash scripts/brain-rollback.sh 1.268.23`；无数据库迁移。

## Kernel Alpine metadata runtime closure

- Brain `node:20-alpine` runtime 显式安装 `acl` 与 `attr`，使 Linux
  protected-path inspector 的 `getfacl/getfattr` 依赖不再在生产镜像缺失。
- Docker image contract 必须对 exact built image 验证两个命令存在，并在容器内
  真实调用 shared inspector：normal file 放行，ACL、xattr 及组合全部拒绝。
  Ubuntu brain-unit/integration 同样显式安装依赖；本地 contract 只能选择
  `--require-docker` fail 或 `--allow-skip` 显式跳过，不允许偶然假绿。
- stale socket quarantine 不再调用 path-based unlink。Node 无 inode-bound
  `unlinkat` 能力时保留 pinned stale inode 作为 forensic artifact，replacement
  继续保留并 fail-closed；artifact 只允许 Brain 离线生命周期清理。
- 回退：`bash scripts/brain-rollback.sh 1.268.22`；无数据库迁移。

## Kernel authenticated readiness and metadata closure

- production manifest 新增独立 readiness Ed25519 key purpose；Brain 只持有受保护
  private-key signer，CLI 只从 mode-0600 manifest 读取固定 public trust anchor。
  readiness 签名绑定 nonce、schema、plan digest、Brain/service identity、socket
  device/inode 与 2 秒有效期；错密钥、重放、过期、plan mismatch 和 adaptive echo
  全部 fail-closed 且不执行 effect。
- CLI 不再接受 raw socket/digest/key override；缺 protected manifest 时只报告
  稳定 config blocker。真实 production boot 把 signer capability 显式交给 UDS
  listener，未配置或签名失败时不声称 ready。
- 受保护 manifest、全部 signer key、grant root/file、UDS parent/socket 共用
  完整 metadata 枚举：Darwin `ls -lde@`、Linux `getfacl/getfattr`；受保护目标
  的 ACL、任意 xattr 或二者组合均拒绝。仅 ancestor walk 可接受 OS-owned
  `com.apple.rootless`，仍拒绝所有用户 metadata。
- stale socket recovery 移除时间猜测窗口；quarantine 后通过确定性 seam 重验
  parent/stale inode 并确认原路径仍为空。攻击者插入 symlink/replacement 时保留
  replacement、停止启动且不扩大 unlink。
- 回退：`bash scripts/brain-rollback.sh 1.268.21`；无数据库迁移。

## Kernel boot control review closure

- production manifest loader 将真实 `pg.Pool` 的 prototype methods 与内部状态
  封装成冻结、绑定、恰含 `connect/query` 的 Brain-owned capability，再交给
  trusted runtime factory。
- UDS readiness 使用 0600/owner/ACL/inode 检查和有界 challenge-response，
  精确匹配 challenge、service schema、plan digest、Brain/service identity；
  探针不解析 grant、不消费 nonce、不执行 effect。
- UDS server pin parent/socket inode，以 bounded connect 区分 active 与
  `ECONNREFUSED` stale；stale 经 quarantine、重验和精确 unlink 后才复用路径，
  symlink、ACL、unknown、active 及 replacement race 一律保留并 fail-closed。
- CLI 把 `--check` 信息报告与 `--gate` 阻断语义分开；P0 regression contract
  改用 gate，execution/proof-matrix/wiring 任一非 true 都非零退出。
- manifest、全部 signer private key、grant root/file、UDS parent/server/client
  共用跨 macOS/Linux 的 ACL-free 验证；production boot 保留安全且具体的
  `trusted_runtime_*` / `production_trusted_execution_*` 错误码。
- 回退：`bash scripts/brain-rollback.sh 1.268.20`；无数据库迁移。

## Kernel production boot and grant control plane

- `server.js` 不再以空参数启动 trusted execution；它把 production environment
  与 shared PostgreSQL pool 交给 outer wiring loader。protected manifest
  缺失、不可用、不安全、digest/key/registry 漂移或 Phase 5 B ports 未配置时
  返回各自稳定 readiness code，且不创建 UDS。
- manifest 只允许 public trust registry、canonical assembled-plan digest、
  collector/execution-grant/十个 effect signer 的 key ID 与 absolute protected
  secret-file path、grant root/TTL、socket path 和 resource-port profile。配置
  通过单个 `O_NOFOLLOW` descriptor 读取并固定；raw Kernel secret env 禁止。
- grant issuer 独占 signer 与写/清理 authority，签名 grant 以 mode-0600
  exclusive temp file 落盘，执行 file fsync → rename → directory fsync 后只
  返回 opaque ref；reader 只有 exact-ref read authority，并拒绝已过期 grant。
  cleanup 对每个候选重验 regular/owner/single-link/mode/inode，未知或被替换的
  文件保留而不扩大删除。
- CLI `--check` 共用 client 的 UDS owner/mode/directory 安全检查，动态报告
  wiring readiness。真实 listener 仍不代表 proof matrix ready；本版本未配置
  Phase 5 B production ports、未接 ReleaseRun、未执行 drill、未部署。
- 回退：`bash scripts/brain-rollback.sh 1.268.19`；无数据库迁移。

## Kernel Codex review trust boundary

- Controller 只接纳已登记、非主仓、clean 的 exact Git worktree，并把已持久化的
  head/base、merge-base、tree digest、Skill/evidence digest 与 immutable image
  ID 写入证据 receipt；Reviewer 从固定 commit archive 解包到 tmpfs，不挂载 live
  worktree。
- Reviewer 固定 `codex 0.145.0 / gpt-5.4`，non-root、read-only、cap-drop、
  no-new-privileges、最小 mounts、permission profile 与 `--network none`。Auth
  通过 `O_NOFOLLOW` pinned descriptor 复制到每次运行的 mode-0600 临时文件；
  Codex tool 看不到 auth、Git object store、Brain `/app`、broker socket、
  Docker socket、Brain/DB/部署凭据。
- 每次 review 使用带 owner/expiry 标签的独占 Docker volume 与无凭据 egress
  broker sidecar。Broker 仅接受 HTTP/1.1 exact CONNECT
  `chatgpt.com:443`/`auth.openai.com:443`，只连接已校验的 global-unicast IPv4；
  DNS、握手、idle、absolute TTL、header、连接数均有界。
- Cleanup 严格等待 reviewer → broker → volume 并验证零残留；失败保留 slot
  fail-closed；删除前逐资源核对 kind/run/owner nonce。启动/巡检 TTL reaper 从
  Docker labels 收敛 crash-window 半资源。
- Review run intent 与 terminal journal 位于宿主持久目录，并执行
  file fsync → atomic rename → directory fsync。缺 terminal 的 confirmed-dead
  reviewer 合成 FAIL；callback queue 以 task/run 幂等键 fail-dominant UPSERT，
  worker 用 `FOR UPDATE SKIP LOCKED`，且只有 current run 能落终态和 gate verdict。
- Spec task card 与 diff 均从 admitted commit 读取；最终输出必须是 exact
  PASS/FAIL JSON。缺失/畸形 verdict、非零退出、boundary/cleanup 失败均写 FAIL，
  合法 FAIL 不会被 callback 改写成 PASS。
- 回退：`bash scripts/brain-rollback.sh 1.268.18`；migration 379 仅增加 nullable
  `callback_queue.idempotency_key` 与 partial unique index，可向后兼容保留。

## Kernel zero-Attempt patrol coverage

- Kernel v1 run 在 Planner 阈值内尚未创建 Attempt 时保持观察；超过 15 分钟仍为
  0 Attempt 则按 planner 卡死创建 intervention，不再成为巡检盲区。
- 计时只使用 run 的受信 `started_at`；时间缺失/无效时 fail-open 为不误杀，
  已有 Attempt 仍沿用 role/status/start time 判据，旧 relay 路径不变。
- 回退：`bash scripts/brain-rollback.sh 1.268.12`；没有数据库迁移。

## Kernel watchdog credential authority

- Codex watchdog resume 与 Kernel `run.js` 共用 controller-owned
  `KERNEL_FLEET_BRIDGE_TOKEN` 作为中央 Credential Broker 的签名 authority；
  不生成默认、伪造或硬编码 secret，也不从远端 worker 读取长期凭据。
- secret 缺失或不合法时在读取 provider credential、inspect/cancel/launch 之前
  fail-closed；调用方注入完整 launcher 时不额外构造未使用的 broker。
- 恢复请求只向 fleet worker 发送有界签名 envelope，测试同时约束 controller
  secret 不进入请求 JSON 或诊断文本。
- 回退：`bash scripts/brain-rollback.sh 1.268.11`；没有数据库迁移。

## Kernel production trusted service factory

- server-owned one-shot factory 把 production seam builders、10 个 effect signer、
  trusted registry、两类 isolation、cleanup inspector、PostgreSQL runtime、
  protected grant authority 与 canonical plan 装配成唯一 `createService`。
- 顶层配置、plan、trust registry 与 collector 元数据在装配时固定；isolation、
  cleanup、grant ports 必须是各自 owner 创建的冻结最小 capability。accessor、
  schema 外字段、可变 capability、raw secret env、错 owner 均 fail-closed。
- PostgreSQL 只接受 exact `{connect, query}` 最小 capability；factory 在返回前
  固定两个 operation，并绑定到不含额外 receiver state 的冻结 receiver。后续
  改写调用方 port 不会切换 nonce、audit 或 receipt-bundle 的数据库边界。
- factory 对成功和失败都只装配一次，不能在首次启动失败后通过热突变配置重试；
  本版本尚未把 factory 接入 `server.js`，也未创建 production isolation/keys。
  回退：`bash scripts/brain-rollback.sh 1.268.13`；没有数据库迁移。

## Kernel production effect signer set

- production signer loader 只接受与 canonical 10 个 non-release seam 精确对应的
  `{key_id, secret_file}` 配置；缺失、额外、accessor、跨 seam key 或 plan key
  漂移均在装配前 fail-closed。
- 每个 effect signer 必须由 trust registry 中同 service/purpose/key 的 Ed25519
  公钥校验私钥文件后加载；返回值不暴露路径或私钥，且不能用 raw secret/config
  扩展字段绕过。
- 本版本只提供生产 signer set 的可信装配边界，不生成、不提交、不部署私钥；
  回退：`bash scripts/brain-rollback.sh 1.268.11`；没有数据库迁移。

## Brain-owned Kernel production seam builders

- 一个 server-owned factory 只接受精确的 production dependency/authority
  port 集合，并校验 10 个 non-release seam 的 owner 与实际 creator 所需函数；
  缺失、额外或错 owner 的 port 均 fail-closed。
- factory 复用 10 个现有真实 equivalence seam creator，返回按 canonical seam ID
  索引且冻结的 builder map；builder 只接受 trusted assembly 提供的
  `effectSigner` 与 `createAuthorityBinding`。
- credential、independent judge、orphan liveness 与 DevGate loader 返回的 authority
  context 必须精确匹配 grant-derived binding；已校验函数与 sandbox repo 在冻结
  port snapshot 中捕获，调用方后续突变不能替换生产依赖。descriptor snapshot
  拒绝 accessor 与 schema 外的 own/prototype receiver state，函数只在仅含显式
  function/scalar/nested port 的冻结 receiver 上调用；orphan staleMs 只接受
  nullish 默认或 1ms–24h 的有限整数。
- 本版本不读取 env/key、不接 server wiring、不创建 fake authority、不部署；
  回退：`bash scripts/brain-rollback.sh 1.268.10`；没有数据库迁移。

## Kernel equivalence production case ledger

- Migration 377 在 ReleaseRun 374/375 与 trusted runtime 376 之后增加隔离
  production-case authority；它不覆盖既有 release 或 receipt evidence。
- Migration 378 是不可跳过的 additive authority upgrade：即使 377 已登记也会
  先拒绝存量 non-canonical behavior tuple，再幂等添加并 VALIDATE canonical
  constraint，同时补齐初始 lease 与同 generation lifecycle 的双向 trigger；
  不依赖重跑或篡改 377。
- 每个 case 绑定 canonical cell、Run、Attempt、artifact SHA、Brain/Engine
  version、seam/adapter 与唯一 ephemeral resource ref；跨 Run ownership、
  复用 resource 或 protected/main/production ref 均 fail closed。
- case identity 与 lifecycle event append-only；event 只保存固定 evidence ref、
  before/after hash 与 late-effect risk，不接受任意 JSON 或秘密。
- mutable lease 只能由同一 owner 以 generation +1 和数据库时钟单调迁移；
  初始 owner/generation/state、case expiry 与同 generation lifecycle event 由
  immediate + deferred trigger 双向约束；删除、截断、过期续租、缺 event 和
  非法状态跳转均被数据库拒绝。
- 11 个 behavior 与 seam/adapter/resource class 使用 canonical descriptor
  一一绑定；case 输入一次性 descriptor snapshot 并拒绝 accessor/Proxy，
  artifact SHA 与 Brain/Engine version 必须匹配 server-owned trusted binding。
- transaction deadline 覆盖 pool acquire、statement 与 COMMIT；任何已发出但
  未确认的 COMMIT 都返回 `late_effect_risk`，不得作为普通失败重试。
- 本版本只建立 authority ledger，不注册 signer、production seam port 或 proof；
  根合同继续保持 0/99，且未执行任何生产 mutation。
- 回退：`bash scripts/brain-rollback.sh 1.268.17`；migration evidence 保留，
  回退代码不得删除或改写 case/event rows。

## Brain-owned Kernel equivalence trusted execution

- Drill CLI 不再加载 Brain runtime、数据库、registry 或 signer，也不接收 grant
  文件路径；execute 只向固定 Brain Unix socket 发送 canonical
  `{cell_id, grant_ref}`。
- Behavior equivalence proof command 与 CLI 同步为 exact `--cell/--grant-ref`；
  recovery cell 验证显式携带 violation 的 expected outcome/effect code，历史链
  自描述校验与当前 cell 的合同校验分离，不能因 recovery 位于链头而误判全链。
- Brain trusted service 从 pinned 99-cell plan 解析 cell，经独立 protected-grant
  authority 对服务专属目录逐级校验 owner/mode、单次 `O_NOFOLLOW` 打开并把
  grant UUID/cell 绑定到 opaque ref；目录、祖先与 grant 文件还必须无 extended
  ACL，避免 mode 0700/0600 被 ACL 旁路。runtime 只接收冻结 grant 对象，不接受
  裸路径 capability，再调用已装配的 10 个 non-release adapter；启动时绑定
  caller artifact digest 与 server-owned canonical descriptor digest；任何
  behavior/seam/adapter/isolation/scenario outcome 漂移直接 fail-closed。
- Unix listener 使用安全 owner parent、私有 bind 名称、0600 发布路径、严格单行
  JSON framing 和固定墙钟 deadline；完整有效 EOF 是 server 接受点，EOF 前断连
  零 dispatch，EOF 后由 server 在同一绝对 deadline 内自主完成。若未来需要
  post-EOF 人工取消，必须另建 lease/cancellation channel，不能伪称普通 close
  可观测。超时会传播 AbortSignal，并等待取消确认、cleanup 和审计完成后才返回
  blocked。响应必须精确绑定 cell id 与 grant ref，
  缺失、错绑、未知字段及尾随字节均由 client 拒绝。
- nonce 与 bundle CAS authority 接收同一 deadline 派生的 signal 和剩余时限；
  PostgreSQL 事务设置 statement/lock/idle/transaction timeout，并用 DB
  `clock_timestamp()` 对同一绝对期限守卫写入和 COMMIT；abort 会销毁尚未提交的
  连接以触发 rollback。COMMIT 已发出后的 abort/超时一律视为
  cancellation-unconfirmed；COMMIT 已发出后的任何连接、协议或未知 reject 同样
  无法证明 rollback，必须保留 late-effect risk，绝不回报 consumed/committed
  成功或降级为普通 execution-aborted/failed。trusted service 与 socket 在执行
  返回后都重新核对墙钟，timer 被同步工作阻塞也不能产生迟到成功。
- 请求/响应都有大小与超时上限；关闭时只按 exact inode 删除自己发布的 socket。
- 生产 assembly/secrets 未配置时 boot readiness 明确 fail-closed，不建立 listener；
  `execution_wiring_ready` 仍为 false，不把机械 wiring 冒充等价证明。
- 回退：`bash scripts/brain-rollback.sh 1.268.10`；没有数据库迁移。

## Signed Kernel equivalence drills

- `kernel-equivalence-drills.js` 把根 11 条行为描述编译为 99 个固定 cell，并执行
  signer preflight、signed grant、atomic nonce、actual seam、observation、
  compensation cleanup 和 collector 流程。
- `kernel-equivalence-receipts.js` 使用 Ed25519 public-key registry 验证 grant、
  seam effect receipt、collector bundle、资源/版本/Run/Attempt 轴与 recovery/hash
  lineage；collector 不能替 seam 签名。
- timeout 必须由 AbortSignal + adapter cancellation confirmation 收口；prepare
  失败也必须清理已登记的 partial resource。未确认的取消保持 blocked，并标记
  late-effect risk。
- `run-kernel-equivalence-drill.mjs --plan|--check` 只读；`--execute` 仅接受 canonical
  单 cell 参数。本版本不注册假 key，99 个 cell 均由
  `seam_receipt_signer_missing` fail-closed。
- 回退：`bash scripts/brain-rollback.sh 1.268.6`；没有数据库迁移。

## Kernel P0/P1 behavior equivalence contract

- 根 `regression-contract.yaml` 是旧 Claude Code P0/P1 行为到 Kernel unified
  construct 的唯一清单，覆盖 S0–S12、11 项行为维度，以及
  Claude/Codex/Grok × normal/violation/recovery。
- `kernel-behavior-equivalence.js` 只做纯验证和既有 journey cell 投影，不查询或写
  PostgreSQL，也不创建第二套 lifecycle 或 `behavior_ledger` 表。
- `proven` 必须同时具备 exact artifact SHA/version、未过期 freshness、每个场景的
  effect receipt 和可执行行为测试；静态 grep、文档存在、文件存在和 smoke-only
  检查不能充当证明。任一缺失都会把 effective status 降为 gap。
- 当前账本保留 11 条真实 gap；现有 legacy/Kernel 单测只列为部分行为证据，不能
  冒充跨 Provider 的生产等价证明。
- 回退：`bash scripts/brain-rollback.sh 1.268.5`；本变更没有数据库迁移或运行时
  lifecycle 状态，因此回退仅移除 validator/report surface。

## Kernel post-diff risk and human review authority

- 候选 PR diff 在 merge authority 前由 server 计算风险；首次行为、合同或路径变化、
  migration、CI/workflow、安全凭据、release 及未知或过期 proof 强制人审。
- 审批和 merge effect 绑定 exact head SHA、diff hash、contract digest 与 policy，
  任一轴变化即失效；低风险重复变更也必须持有有效 production receipt。
- Migration 373 提供 append-only production receipt 与 risk assessment ledger。
- 回退：`bash scripts/brain-rollback.sh 1.268.3`。

## Unified legacy Skill dispatch contract

- Executor 的 provider/bridge 边界现在都显式携带 `id/title/description` 最小
  envelope；空 description 规范化为 title，缺 id/title 则 fail-closed。
- P1 合同测试同时验证 envelope、失败路径与 `/dev` 可执行 prompt 的标题/描述。
- 回退：`bash scripts/brain-rollback.sh 1.268.2`。
## Exact production recovery readback

- Brain and dashboard restart detection separates source-tree artifact identity
  from image/dist deployment digests and verifies route-owned durable receipts.
- External production/rollback controllers are accepted only after an exact
  running-container readback of image, command, environment, owner nonce,
  mounts, tmpfs, healthcheck, resource, network, and security policy.
- Production generations greater than one remain launchable; staging receipts
  cannot stale a production rollback, and deploy busy races terminalize every
  claimed-but-not-launched generation.
- 回退：`bash scripts/brain-rollback.sh 1.268.17`（保留 ReleaseRun 账本）。

## Durable typed post-production rollback

- Migration 380 adds an append-only rollback execution authority, one-shot
  claim/lease, terminal settlement, and exact readback receipt, independently
  bound to the already-confirmed `production_verified` ReleaseRun evidence.
- Brain, dashboard, and Workflow Skills rollback through fixed typed routes;
  production deploy intents and legacy/manual token-only calls cannot authorize
  rollback.
- Forward and rollback mutations run in restartable sibling controllers from
  immutable image-owned routes under one PostgreSQL production-mutation lock.
- Timeout, abort, lease loss, and post-effect readback mismatch settle
  fail-closed with durable `late_effect_risk`; expired claims are observed as
  `unknown` after Brain restart and never create a replacement claim. A bounded
  controller restart may only resume the same still-live claim and recover its
  Workflow WAL before ordinary CAS preflight.
- 回退：`bash scripts/brain-rollback.sh 1.268.16`（保留 rollback execution ledger）。

## Crash-safe immutable ReleaseRun effects

- Every route runs from a fresh writable copy of a digest-verified, read-only
  exact-SHA archive; mutable production state is written only under the
  dedicated deploy root.
- Snapshot reuse re-hashes the canonical tree and rejects changed bytes.
- Detached worker and bootstrap secret files enforce owner/mode/link/inode
  invariants and safely reap only stale private directories after SIGKILL.
- Staging effect status is persisted for Brain restart recovery, and legacy
  image recreation now requires the same ReleaseRun production authority.
- 回退：`bash scripts/brain-rollback.sh 1.268.15`（保留 ReleaseRun 审计账本）。

## Exact bootstrap receipt closure

- `staging_passed` and `production_verified` require the exact persisted
  bootstrap artifact versions and receipt evidence.
- Receipt conflict replay compares the full confirmed row and rejects any
  divergent merge, manifest, scenarios, probes, timestamps, or evidence.
- 回退：`bash scripts/brain-rollback.sh 1.268.14`（保留 bootstrap receipt ledger）。

## Private bootstrap secret transport

- The one-time bootstrap accepts only a current-owner `0600` private-config
  reference for its production DB URL and owner approval signature.
- Approval verification and PostgreSQL clients load secrets from files;
  `psql` gets only `PGSERVICEFILE`/`PGPASSFILE` references.
- Migration, E2E, and deployment children run with explicit environment
  allowlists, preventing ambient credential inheritance.
- 回退：`bash scripts/brain-rollback.sh 1.268.13`（保留 bootstrap ledger）。

## Durable ReleaseRun alert delivery

- BLOCKED escalation and P0 outbox rows are one atomic database write.
- Every delivery failure/success is appended durably; a provider failure leaves
  the item pending for repeated BLOCKED reports or orchestrator-startup retry.
- Only one immutable delivered attempt may exist per outbox item.
- 回退：`bash scripts/brain-rollback.sh 1.268.12`（保留 alert outbox 审计账本）。

## Leased private release workers

- Detached release workers own renewal for their exact dispatch generation
  until every artifact route finishes, then append one fenced terminal outcome.
- Lease loss aborts active work and cannot report `dispatched`.
- Worker and route environments are allowlisted; authorization, deploy token,
  and database credentials are passed only by validated `0600` private-file
  reference.
- 回退：`bash scripts/brain-rollback.sh 1.268.11`（保留 dispatch lease 审计账本）。

## Exact ReleaseRun receipt replay

- Receipt idempotency returns the persisted row and compares every authority
  field; conflicting replays are rejected instead of inheriting an existing ID.
- Staging and production transitions bind exact persisted artifact readback and
  receipt verification JSON at the database boundary.
- 回退：`bash scripts/brain-rollback.sh 1.268.10`（保留 exact receipt ledger）。

## Server-owned merge review authority

- Merge review risk comes from the exact changed paths observed by the GitHub
  adapter and a fixed server policy, never mutable title metadata.
- An append-only PostgreSQL assessment recomputes durable first-release
  history and enforces monotonic review: first/high/unknown always review,
  while task payload can only require more review.
- The effect executor binds that assessment to the current PR head before
  persisting merge authorization.
- 回退：`bash scripts/brain-rollback.sh 1.268.9`（保留 review assessment ledger）。

## Artifact-bound rollback ledger

- Normal and bootstrap production record exact per-artifact rollback intents
  before effect execution and exact receipts after confirmed readback.
- Runtime and PostgreSQL independently bind current/previous digests,
  operational metadata, confirmed effect receipt, and full artifact coverage.
- Terminal evidence must reference the exact ordered artifact receipt set.
- 回退：`bash scripts/brain-rollback.sh 1.268.8`（保留 artifact rollback ledger）。

## Immutable ReleaseRun artifacts

- Release effects materialize an exact-merge archive in a retained,
  per-commit artifact root; the shared deployment checkout is never reset.
- Workflow Skills production links point only into that immutable root and
  retain exact prior link targets.
- Dashboard rollback evidence is a typed per-run JSON receipt containing the
  exact old tag and deterministic previous-tree digest.
- 回退：`bash scripts/brain-rollback.sh 1.268.7`（保留 immutable artifact roots）。

## Server-owned ReleaseRun E2E probes

- E2E policy v2 仅执行 server registry typed probes，不导入通用 shell runner。
- canonical origin、staging network allowlist、timeout 和 bounded response reader
  阻断 manifest URL/command 注入。
- per-probe ID/status/observation digest 同步进入 normal/bootstrap durable receipts。

## Fenced Kernel ReleaseRun closure

- approved contract E2E manifest、typed per-scenario receipt、dispatch renewal /
  generation / outcome fencing 和 DB transition guards 组成唯一 PASS 权威。
- production 在 effect 前写 rollback intent，在 live readback 后写 rollback receipt；
  terminal transition 必须引用 exact effect、E2E 与 rollback receipts。
- artifact routes 由数据库持久 manifest 驱动，分别执行 Brain、Dashboard 与
  Workflow Skills runtime；unknown/no-runtime fail closed。
- bootstrap 使用同一 manifest executor 和 append-only lease renewal，exact merge
  fetch、private output 与无 DB URL argv；BLOCKED report 写 durable dedup P0 escalation。
- 回退：`bash scripts/brain-rollback.sh 1.268.5`（保留 migrations 374–375 审计账本）。

## Durable Kernel ReleaseRun

- confirmed merge receipt 唯一创建不可变 ReleaseRun，绑定 source/merge SHA、
  artifact versions 与 `kernel-release/v1` policy；migration 374 的 append-only
  ledger 强制六状态顺序。
- staging/production 共用 release advisory lease；intent 先写、effect 后验，
  重放先观察。只有 exact PASS receipt 才推进，unknown/skipped/idle/fail 均阻断。
- Kernel `report/done` 只消费 `production_verified`。部署 API、历史 workflows、
  drift sentinel 与直接生产脚本没有 ReleaseRun authorization 时全部 fail closed。
- N-1 首次升级只允许 root-trusted owner signature + GitHub merged PR authoritative
  read 的 exact-SHA bootstrap；canonical runner 顺序补齐 migration 369–374，
  append-only singleton state/attempt/receipt ledger 强制 staging confirmed 后才能
  production，并支持 crash 后 generation replay；terminal 后永久禁用。
- 回退：`bash scripts/brain-rollback.sh 1.268.3`（保留 migration 374 审计账本）。

## Kernel controller contract and intervention evidence

- `harness-controller` 的运行语义已从供应商会话编排收敛为确定性 Kernel Run
  Controller：每个 `run_id` 一个逻辑 Controller，角色均为独立 Attempt，
  Fleet Supervisor 只拥有机器准入、容量和放置权。
- Kernel merge/release 合同只接受绑定当前 SHA 的 authorization 与 append-only
  effect receipt；Skill、Provider、CI、Fleet 和人工终端都不是旁路权威。
- `harness_intervention` 任务为 Kernel Run 持久携带 `run_id` 与
  `harness_runtime=kernel-v1`。handler 只读取该 Run 的 `harness_attempts`
  result/receipt/telemetry 白名单并脱敏后分析；缺失或查询失败 fail-closed，
  绝不回落到 relay 容器日志。
- 旧 relay 继续读取 Docker logs，保持回滚兼容。
- 回退：`bash scripts/brain-rollback.sh 1.268.1`。

## Fleet Worker-owned GitHub read authority

- evaluator 与非 canary reporter 的 TaskBundle 冻结 repo、PR number、head ref、
  head SHA 和 state，并把只读策略纳入 bundle hash；Worker 只用 argv-only
  `gh pr view` 获取该最小事实，逐轴不一致即 fail-closed。
- 每个 Attempt 的 observation 以 mode 0600 append-only hash-chain audit 持久化；
  相同 request 崩溃重放复用原 authority，冲突重放在任何 GitHub 调用前拒绝。
- authority 以固定 mode 0600 文件只读挂载给 provider/Runner；Runner 对
  TaskBundle、Attempt、角色、request digest 与 PR 事实逐字段复核。provider 不接收
  GitHub token、`~/.config/gh`，managed entrypoint 不执行 `gh`。
- installer、generation rollback 与 Fleet rollout 均包含 broker 文件及预检；
  任一缺失不会启动 provider。
- 回退：`bash scripts/brain-rollback.sh 1.268.0`。

## Fleet Worker-owned GitHub mutation

- Generator 的 GitHub 写权限从 provider 容器移到 Worker broker；TaskBundle
  冻结 repo、branch、base/remote SHA、draft PR 文本与 allowed paths，并纳入
  bundle hash。provider 只提交绑定本地 HEAD 的 DONE/FIXED 声明。
- Worker 在容器退出并清理后校验 branch/HEAD/base ancestry、changed paths、
  binary、symlink/submodule、added-line secret、origin 与 frozen remote lease；
  只允许 argv-only `force-with-lease` push 和 draft PR 创建/读取。
- mutation 的 prepared/push-confirmed/draft-confirmed receipt 以 mode 0600
  append-only hash chain 持久化；崩溃恢复与重复 terminal/callback 不重复写动作。
- evaluator/reporter 在 Worker-owned GitHub read broker 完成前 fail-closed；
  Claude/Grok 在 provider credential broker 完成前 fail-closed。两者均不会回退到
  provider 内执行 `gh`。
- 回退：`bash scripts/brain-rollback.sh 1.267.99`。

## Fleet rollout transfer-interruption cleanup hotfix

## Fleet rollout transfer-interruption cleanup hotfix

- Xian SSH payload 在读取 tar stdin 前即受 EXIT/HUP/INT/TERM cleanup 保护；传输
  截断、解包失败或控制器中断都会写入 drain 并删除精确 root staging。
- 成功 rollout 只删除一次性 staging，不误设 drain；NodeProfile、Runner pin、
  bootstrap/admission 和 Phase 4B/4C/4D/5 语义均未扩展。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.102`。

## Fleet rollout protected-token staging hotfix

- US M4 的 Worker bearer token 位于 `_cecelia` 专属的 0700 数据目录；普通
  rollout 控制器现在通过非交互 sudo 验证 regular-file、non-symlink 与 0400/0600
  权限，再以 0600 分阶段复制到一次性 payload，不放宽生产 token 目录权限。
- token 内容不进入参数、日志、Git 或长期 Xian provider credential；其余 Phase 4A
  rollout/admission 顺序不变，Phase 4B/4C/4D 与 Phase 5 仍不在本 hotfix 范围。
- 回退：节点先执行 `fleet-nodectl.sh drain`，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.101`。

## Fleet Node Phase 4A production convergence

- NodeProfile registry、rollout 与 admission 统一固定从
  `origin/main@9466c380` 构建的 Runner
  `sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7`，
  任一节点报告不同 digest 都进入 draining。
- macOS policy 将 `15.7.4` 作为最低补丁线；同一 `15.7` release line 的更高
  patch 可准入，低于 floor、跨 release line 或 malformed version 均 fail closed。
- baseline reconciler 除 pinned Node/Codex/OrbStack/Git 外，还从已安装的官方
  Tailscale app 暴露稳定 CLI 到 system LaunchDaemon 的 toolchain PATH。
- 变更边界只包含 Phase 4A NodeProfile、bootstrap、admission、drain 与三机基线；
  Phase 4B/4C/4D 执行语义未改，Phase 5 真实业务 canary 未运行。
- 回退：节点先执行 `fleet-nodectl.sh drain`，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.100`。

## Provider-neutral Harness Commander Phase 2

- `commander_mode=hybrid` 现在可在 material Kernel boundary 通过 Provider Registry、
  capability preflight、正常 Attempt lease/heartbeat/callback/receipt 调用一个隔离的
  Commander；默认仍为 `kernel-only`，`derive.js` 与既有非 hybrid 路径不变。
- Provider 返回的 `commander-directive/v1` 先进入正常 HarnessResult/Attempt 终态，
  再由 L0 校验 cursor、evidence、合法 role、budget、deadline 与 capability。接受、
  拒绝和 failover 决策以 `orchestrator_decision_log` 为 authority，并由 migration
  368 同事务投影成不可变 Run event。
- Commander 自身只对带持久 `failure_class` 和显式白名单 code 的基础设施故障按声明
  target 顺序 fresh-session failover；语义拒绝、产品失败、无效 Directive 与未知文本
  均不跨 Provider，fallback 用尽转人工。
- role 级 `switch_provider`/`switch_machine`、节点安装、OrbStack bootstrap、部署与
  真实 Provider canary 仍属 Phase 3/4/5；本版本没有使用 synthetic canary 代替验收，
  也不允许 Xian 本地长期 Codex credential。
- 回退：`bash scripts/brain-rollback.sh 1.267.98`；或将 Run 保持/恢复为
  `commander_mode=kernel-only` 立即旁路 Commander。
## Kernel result authority read surface

- `GET /api/brain/strategic-decisions` 支持按 `source_ref` 精确过滤并回传该
  binding，Runner 只读回查 reviewer judgment 数量时不再依赖 reason 文本。
- `GET /api/brain/learnings` 支持按 `task_id` 精确过滤并在每条结果回传
  `task_id`，Reporter finalizer 可 fail-closed 验证 learning 真实落库数。
- 两个读取面都只增加可选过滤条件；不带参数的现有调用保持原行为。
- 回退：`bash scripts/brain-rollback.sh 1.267.98`。

## Reviewer zero-judgment contract

- Reviewer `APPROVED` 在合同没有判定点时允许 `judgments_written=0`。
- raw claimed 与 verifier 回读值仍必须完全一致，且两侧继续受 `0..10000`
  整数边界约束；`REVISION` 仍只能为 0。

## Provider-neutral Harness Commander Phase 1

- `initiative_runs.commander_mode` 默认保持 `kernel-only`；只有未来显式选择
  `hybrid` 的 Run 才能进入 Commander 路径，现有 Kernel 控制流不改默认语义。
- migration 367 新增 Run 隔离的 Commander state、递增事件投影、不可变 Actor
  message、独立 delivery/ack 与逻辑角色游标。`initiative_runs`、
  `harness_attempts` 和 `orchestrator_decision_log` 仍是进程真相；事件表是可重建投影。
- CommanderBundle、CommanderDirective 和 ActorMessage 使用 provider-neutral
  strict schema。Directive validator 只返回结构化接受/拒绝结果；Actor message
  不能派发角色、修改 Run、执行命令或携带 credential/session 路径。
- Phase 1 不调用 LLM/Provider、不创建 Commander Attempt、不执行 Directive，也不
  部署或运行 canary。Phase 2 Provider 接入与 Phase 5 三机真实任务验收仍待后续独立 PR。
- 回退：`bash scripts/brain-rollback.sh 1.267.97`。additive 表可保留不用；
  将 Run 保持/恢复为 `commander_mode=kernel-only` 即禁用新读取面。

## Kernel role result PR authority

- generator-fix 与 evaluator Attempt 创建前必须冻结完整、server-owned 的
  PR URL、head ref、head SHA 与 state；PR type 固定为 `pull_request`，
  number 从无 query/hash 的 canonical `/pull/N` URL 解析。
- required callback authority 必须逐字段精确匹配，partial PR evidence
  fail-closed；callback 自报的 PR number 不作为权威。
- generator/evaluator 仅接受 `OPEN` PR，reporter 可验证 `OPEN` 或
  post-merge 的 `MERGED` PR。

## Fleet execution equivalence and recovery

- Brain-owned node admission now marks a clean, fresh, policy-matched report
  dispatch-ready. Worker-supplied readiness, slot, and online claims remain
  untrusted; any local admission failure still drains the node.
- Same-machine provider resume is bound to the receipt-proven actual machine.
  The child Attempt receives a new Attempt/workspace identity and an explicit
  `fresh_session=false` bundle. Recovery without a provider session restarts
  deterministic Kernel reconciliation, whose normal dispatcher creates a
  `fresh_session=true` Attempt from DB/Git/PR evidence.
- `harness_attempts.failure_class` records the canonical structured distinction
  between `infrastructure_blocked`, `runner_failure`, and `semantic_refusal`;
  classification uses status and bounded error codes, not free-form messages.
- Ground truth reads normalized product-failure sets from prior Runs of the same
  task without merging their hops into the current Run. Repeating the exact set
  routes L0 to `wait:human_review` before any `generator-fix` Attempt is created.
- Rollback: `bash scripts/brain-rollback.sh 1.267.96`. Phase 5 deployment and
  real three-machine canary are intentionally not performed by this change.

## Kernel attempt telemetry

- `harness_attempts` 以 additive migration 361 增加 logical cycle、attempt kind、retry lineage、restart reason、workstream 与 derived 时间来源。
- attempt 生命周期在 `starting` 首次记录 `started_at`，且仅在终态写 `completed_at`。
- `GET /api/brain/harness/tasks/:task_id/attempt-telemetry` 必须由 `x-tenant-id + task_id` 双作用域查询，响应采用字段白名单。
- orphan 的结构化收口区分 resume 返回 `null`、`false`、成功 child lineage 与 live lease owner fencing。
- Kernel action 路由与批准合同冻结语义不变。

## Fleet Node mandatory base admission and unified Worker

- `fleet-node-profiles.json` 是三台 canonical 节点的 immutable policy；Brain 从
  Worker 的有界、新鲜、同身份健康报告本地计算 `base_admitted`。
- NodeProfile 同时固定 Worker listener 与 Brain callback：US 使用回环，Xian
  M4/M1 listener 绑定各自 Tailscale IP，callback 指向 US Brain Tailscale health。
  system LaunchDaemon 固定 `DOCKER_HOST=unix:///var/run/docker.sock`。
- US M4 的 `fleet-rollout.sh` 只从 committed Git、credential-free bundle 和
  pinned Runner image 构建节点工件。构建期间固定一个 commit OID，归档、bundle
  和传输前复核必须属于同一 OID 且 worktree 仍干净。本地与 BatchMode SSH 路径
  都先由 root 解包到 `/var/tmp` mode 0700 staging，并在执行前校验 controller
  与 nodectl 为 root-owned、非 symlink、不可被 group/world 写入；不执行用户可写
  临时目录中的 root 脚本。内部 apply 入口只接受 EUID 0 并再次校验 staging，
  不提供 nested-sudo 或 nodectl override；也不读取或传输账号目录、Prompt、token
  或 provider session。
- baseline reconciler 创建固定 UID/GID 450 的 `_cecelia` 服务身份，安装 pinned
  Node/Codex CLI 与 OrbStack 2.2.1，把 app 内 `orbctl/docker` 链接到 Cecelia
  toolchain PATH，导入 Git baseline/Runner，再调用 transactional installer。
  installer 为 `_cecelia` 向 OrbStack owner home 授予 `search`，
  并向 exact `docker.sock` 授予 `read,write`；root-only WatchPaths helper 负责
  socket 重建后的恢复，不授权 sibling sockets。本次新增 ACL 在失败时逆序回退。
  新 generation 只有在 launchd 持续为 running、且 profile-owned `/health`
  返回匹配 machine identity 后才提交；否则恢复原文件与原服务状态。
- 所有 production machine health 都必须经过该 gate。缺失、重定向、超时、
  malformed/stale evidence、显式 drain 或 policy/resource/digest 不匹配均
  fail-closed；不存在 `online`/`effective_slots` 回退。
- production capacity 从 canonical capacity 与实时 effective/physical slots
  的较小值按 `task_bundle.role` 折算；缺失/未知角色 fail-closed，reporter
  作为生产可达的轻量角色使用权重 1。
- Phase 4B 定义 strict、path-free `WorkspaceSpec` 与 authenticated Worker
  Attempt API。三台 canonical machine 均使用 server-owned Worker URL；Brain
  保留 ExecutionTarget 决策，Worker 从 controlled Git mirror 创建 Attempt-owned
  worktree 与无 hardlink 的 private Git common-dir，容器不挂载共享 mirror，并
  独占 pinned OrbStack/Docker container、durable state、terminal
  cleanup、restart reconciliation 与 quarantine。Caller cwd/worktree path 不得
  跨越 Worker boundary。
- Phase 4C 的 Codex Credential Broker 只在 `us-mac-m4` 从受保护的
  `~/.codex-team1`～`~/.codex-team5/auth.json` 读取最终选中账号，签发绑定
  Attempt/account/machine/deadline 的单账号 envelope。Worker 在 workspace 前
  校验 hash/expiry/bindings 并用 durable ref marker 防重放；payload 仅在进程内存
  与 FIFO 中短暂存在，容器通过 tmpfs `CODEX_HOME/auth.json`（0600）消费。
  Attempt state 只保存七项 envelope metadata；callback 只允许 UUID
  `credential_ref` 与 boolean `credential_copy_mutated`，不允许 token writeback。
  watchdog 恢复 Codex Attempt 时复用同一中央 Broker 签发新 envelope，禁止从
  Xian 节点或测试主机的长期 Codex home 读取恢复凭据。
- Worker bearer token 只做节点 transport auth，由受保护文件读取，不是 provider
  credential。installer 为 `_cecelia` 准备 `/var/lib/cecelia` 下 canonical、
  mode 0700 data root，拒绝 traversal 与中间 symlink 逃逸；容器退出按
  container（含 prompt runtime）→ worktree → state 回收。Legacy bridge 的
  production `/harness/attempts*` 返回 `410 fleet_worker_required`。
- 只有完整、匹配、新鲜且未 drain 的 report 才能由 Brain 计算
  `dispatch_ready=true`；在最终 readiness 出现前不得创建 Attempt 或调用 launcher，
  并将 `node_not_dispatch_ready` 原样写入阻断结果、告警和决策 evidence。
- self-deploy 以 US M4 baseline 和 pinned Runner 收敛三台节点；任一节点缺少
  Docker/OrbStack、低于 OS floor 或出现 digest drift 时必须保持 drained，不得降低
  准入阈值，也不得用 synthetic canary 代替真实任务验收。
- 节点回退：
  `CECELIA_MACHINE_ID=<machine-id> sudo -E packages/brain/scripts/fleet-worker/fleet-nodectl.sh drain <machine-id> --apply`。
  Brain 回退：`bash scripts/brain-rollback.sh 1.267.95`。
