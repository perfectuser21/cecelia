# Cecelia 定义文档

**版本**: 2.0.0
**创建时间**: 2026-02-01
**最后更新**: 2026-08-03



**Brain 版本**: 1.267.187

**状态**: 生产运行中

---

## Brain 1.267.187 — Kernel Fleet concurrency and diagnostic containment

- Watchdog 在 failure-persistence evidence 边界对持久化异常统一执行绝对路径脱敏、
  凭据遮蔽和长度上限；AggregateError、注入的 recovery alert 与默认 P1 alert 不再
  暴露 `file://` URL、含空格的 POSIX 路径或 token 值。
- 通用 failure-persistence sanitizer 保持不变，避免扩大其他调用方的语义范围。
- Worker 将 in-flight prepare 与 inspect/cancel 按 exact lease 串行化，消除 prepare 未落盘时
  `already_clean/missing` 假证据和迟到孤儿容器；terminal start tombstone 可经 Brain
  transport/Dispatcher 幂等回放，错配或 malformed 回执继续拒绝。
- receiptless Attempt 只有 TaskBundle 明确标记 `execution_surface=fleet-worker` 才进入 Fleet
  recovery，本地 Docker 启动后、receipt 前的崩溃窗口不会被远端 missing 误终结。
- Fleet watchdog 不再独立 cleanup/reclaim Attempt，只重启 dedicated controller；统一
  expired-attempt reconciler 以原 owner/generation 处理 live、missing 与 terminal 状态。

## Brain 1.267.186 — Kernel Fleet two-phase launch and expired-attempt convergence

- Fleet Runner 启动协议固定为 `prepare → attested receipt 持久化 → start`。Worker 的
  `prepare` 只创建 stopped container 与 Attempt-owned 资源；Brain 未完成 exact receipt
  绑定时 Runner 不得启动，receipt 写入或 start 失败均按原租约精确清理。
- Worker 的 prepare/start/inspect/cancel/terminal 回执全部绑定 exact `attempt_id`、原
  owner/generation 和有限状态集合；inspect 只接受带 lease body 的 authenticated POST，
  stale lease 与旧 GET 均拒绝。Worker 只持久化非密生命周期元数据；重启后的 prepared
  terminal tombstone 只有取得 exact cleanup 才能进入替换终态。
- 过期 Fleet Attempt 在 normal derive 前收敛：已验签存活 Worker 保持原 owner/generation
  续租，避免只旋转数据库 generation 后拒绝真实 callback；receipt 未确认的存活 Worker
  必须先取得 exact cleanup 再换新 Attempt；Worker `missing/terminal` 时 Attempt 失败终态
  与 bounded decision evidence 同事务提交，并按 callback-equivalent infrastructure result
  重试而不污染 product fixRound。父 Run 终态只重新观测，并发输家立即让位。
- 协议升级固定使用 `fleet-rollout.sh all --apply --protocol-cutover`。切换前必须停止 tick
  和全部 controller、以 DB 证明无 active Attempt；rollout 必须先完成三机全 drain，之后
  才允许任一 bootstrap，且三台 Worker 更新后保持 drained。部署
  Brain 并完成真实两阶段协议探测后才逐机恢复 admission。回退到 `1.267.185` 也必须先
  全局 drain，再同时回退 Worker/Brain，禁止协议混跑窗口恢复派发。

## Brain 1.267.185 — Kernel transient infrastructure admission backoff

- `infrastructure_blocked` 不再占用语义 BLOCKED 的连续两次终结栅栏。Kernel 会先把
  capability snapshot、failure class 与 fallback reason 写入 append-only 决策账本，
  再按既有 90 秒轮询周期退避并重新获取 fresh Fleet admission；整条 run 仍受 8 小时
  deadline 与 4096 hop 宽兜底约束。
- BLOCKED streak 现在同时按 control status 与 failure class 分段，防止一次 Worker 清理期
  的瞬态 admission 失败提前消耗后续语义拒绝预算。语义 BLOCKED 连续两次仍立即终结，
  没有放宽产品/安全收敛闸。回退到 `1.267.184` 会恢复“Generator cleanup 后连续两次
  node_not_base_admitted 即误杀 run”的竞态。

## Brain 1.267.184 — Kernel runtime contract test hardening

- Provider Runner 回归测试现在分别锁定 Evaluator evidence preflight、provider runtime、
  provider session 与 terminal callback retry 四条 heartbeat 调用路径，并只在中央 helper
  内验 endpoint、generation payload 与 callback bearer auth，防止删路径或删认证后假绿。
- real-env task-delete smoke 完整承接原行为合同：精确 HTTP 200 / 404 / 409、响应字段和
  PostgreSQL 终态均需一致。此版本只加固合并后的 Kernel runtime 测试契约，不改变生产
  调度行为；回退到 `1.267.183` 会恢复较弱的结构断言。

## Brain 1.267.183 — Kernel callback rejection and lease-generation fencing

- Runner 只把 HTTP 2xx 视为 terminal callback 已提交；网络错误、408、425、429 与
  5xx 续租后重试，其他 4xx 视为永久拒绝并以非零退出，让 Worker 的自然退出收口路径
  回收 Runner、network、workspace 与状态，不再无限续租泄漏。
- 每次 callback 重试发送的 heartbeat 必须携带当前 `lease_generation`；Brain 的 route
  和 Attempt Store 都 fail closed，并在 SQL 更新条件中同时匹配 owner + generation，
  防止旧 Runner 延长后来接管者的租约。
- Runner 重建并固定为
  `sha256:e8979dcf7791b1fd0754276d39fd58adf9c8fc1148323a3d0d3b8abe29ea351f`；
  三机必须同步后才可 undrain。回退到 `1.267.182` 会恢复永久 4xx 无限重试与 heartbeat
  仅按 owner 续租的竞态。

## Brain 1.267.182 — Kernel Evaluator attempt-scoped PostgreSQL

- `contract_requirements.postgres` 现在被规范化为
  `TaskBundle.inputs.runtime_resources.postgres`，经 provider-neutral remote transport
  只传布尔资源请求；URL、密码、cookie 与 token 不进入 Commander/Fleet 合同。
- PostgreSQL capability gate 改为核对被选 Fleet Worker 的 admission 投影，不再用
  Brain controller 自己的数据库 `SELECT 1` 冒充目标机可执行能力。
- Fleet Worker `1.267.92` 为每个请求数据库的 attempt 建独立私有 Docker network 与
  pinned PostgreSQL sidecar，通过 `pg_isready` 后只向 Runner 注入短期 `DB_URL` /
  `DATABASE_URL`；状态文件仅保存无密资源身份。
- terminal、cancel、launch rollback 与 orphan reconcile 都按 exact attempt 回收容器和
  network；历史 attempt 按其已记录 pinned digest 回收，不依赖升级后的当前配置。
  真实清理失败会 quarantine 或报 `attempt_launch_rollback_failed`，不再假绿。
- terminal callback 只有在 exact leased Worker 返回 HMAC 验证通过的 `cleaned` /
  `already_clean` 收据后才落终态；不可达、失败或 quarantine 都返回可重试错误。
  Worker 在 Brain 返回成功前保留负责 callback 重试的 Runner，只先释放 runtime resource；
  Runner 自然退出后再清理容器、worktree 与状态，服务端 artifact 校验也先于资源释放。
- 三机 NodeProfile、LaunchDaemon installer、rollout/reconcile 固定 PostgreSQL 镜像
  `postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`
  并以真实启动 PostgreSQL + `pg_isready` 的无 host-port probe 做 admission；缺镜像、
  摘要漂移或运行失败均拒绝派发。
- Runner 因 durable callback 重试契约重建并固定为
  `sha256:0f64058c10eb64141c7acabacb8588890723cae5ff3e91b44a1c94dc1b50d109`；
  三机必须同步该镜像后才可 undrain。
- 回退到 `1.267.181` 前必须 drain 含 runtime resource 的 attempt；旧 Worker 不理解
  sidecar 生命周期，也会让目标机 PostgreSQL admission 重新出现假绿。

## Brain 1.267.181 — Kernel Codex 终态收据与 Planner/Proposer Run 隔离

- Codex JSONL 已以 `turn.completed` 结束、最后一条 agent message 与结构化结果文件
  语义一致时，Runner 可把 CLI 保留的非零诊断退出码恢复为 Provider 合法终态；
  `turn.failed`、缺消息、结果不一致、超时及既有安全闸失败仍 fail closed。
- 恢复收据以受限 `cli_exit_code` + `terminal_receipt=turn.completed` 元数据穿过
  Fleet callback，Brain 只接受完整成对且值域合法的证据，其他未知字段继续拒绝。
- Planner/Proposer Git handoff 分支都加入 Run 短 ID：
  `cp-harness-prd-<task8>-r<run8>-a<hop>` 与
  `cp-harness-propose-r<round>-<task8>-r<run8>-a<hop>`；同一 task 的新 Run 不再
  覆盖或消费旧 Run ref。部署前 legacy Proposer ref 仅由当前 Run TaskBundle 授权。
- 三台 Fleet NodeProfile 与 rollout/reconcile 固定到 Runner
  `sha256:1ec3542ab56a58c620196a4f32fd04b12e8049ec29dbc121e33b51a0cabc4288`。
- 回退到 `1.267.180` 会重新把已完成的 Codex turn 记为 `provider_exit`，并让
  Planner/Proposer 重跑复用历史分支；回退前必须 drain 活跃 Kernel attempts。

## Brain 1.267.180 — Kernel 只读角色冻结闸与失败回调收敛

- Reviewer/Evaluator 的只读 Fleet workspace 不再被要求写入 `core.hooksPath`；
  冻结基线仍在 Provider 前后用独立的 `/tmp` 血统检查器验证。
- Runner 为凭据建立后的启动失败补齐 Fleet Codex 凭据证明；仅超时合同和
  凭据包自身失败可缺少 copy 证据。未知 metadata 字段始终拒绝。
- 三台 Fleet 节点的 pinned Runner 基线升到
  `sha256:7d6c52d18713a356aefa8bae7efc9b485e9277645bcea8b5250ecceaca7086d7`。
- 回退到 `1.267.179` 会恢复「只读 Reviewer 启动前失败 + callback 409 +
  Attempt 卡 `starting`」的生产闭环。

## Brain 1.267.179 — Kernel 仓库 slug clone 边界

- Kernel/Fleet 标准的 `owner/repo` 仓库标识在本机 worktree clone 边界转成
  完整 GitHub HTTPS URL，不再被 Git 误当作本地相对路径。
- 本地绝对路径、现有 HTTPS/SSH URL 与数据库内的 provider-neutral slug 合同保持不变；
  私有仓库 clone 后 origin 仍还原为不含 token 的干净 URL。
- 回退到 Brain `1.267.178` 会使以 slug 传入 `payload.base_repo` 的 Kernel 任务
  再次在 run 建档前 clone 失败。

## Brain 1.267.178 — Kernel 冻结基线血统守卫

- 任务 `payload.base_sha` 钉死基线时，`workspace_spec` 新增 `frozen_baseline: true`，
  并沿 dispatcher → 远端 bridge → Fleet Worker → 容器 env 全链路传递；Worker 把自己
  观测到的 checkout SHA 以 `HARNESS_WORKSPACE_START_SHA` 注入，冻结位以
  `HARNESS_FROZEN_BASELINE` 注入。模型不自报、提示词不参与判档。
- Runner 在 Provider 启动前武装 pre-push 血统闸（SHA 与「已存在血统」快照烤进钩子脚本，
  unset env 松不开），Provider 退出后再断言一次；违规时 Attempt 直接判 failed，
  callback 不可能投影 PR。
- Brain callback 对冻结 Attempt 追加服务端 lineage 校验：`start SHA` 必须仍在 PR head
  历史中，且 head 相对 `main` 的分叉点不得越过 `start SHA`。任一不满足 → PR claim 降级为
  `unverified_pull_request_claim`（`frozen_baseline_violation` /
  `frozen_baseline_unverifiable`），GitHub compare 不可用继续 503 fail closed。
- 生产实弹 run `d9785137` / Generator attempt `3aa00156`：`payload.base_sha=0dc4e3c0`，
  forbidden 含 `read_or_copy_other_candidate`，harness-generator v7.11.0 Step 0.5 无条件
  `git rebase origin/main`，把 Kernel PR #1578 HEAD `7629efe6` rebase 到已含 One-session
  #1577 的 main `676fed7d`。**注意：`0dc4e3c0` 本来就是 `676fed7d` 的祖先，所以「start SHA
  仍是 HEAD 祖先」这条判据拦不住**——三层闸门用的是「`start SHA..HEAD` 之间不得出现任何
  已存在于其他血统的 commit」（容器侧）与「head 对 main 的分叉点不得前移」（服务端）。
- harness-generator SKILL 升 7.12.0：Step 0.5 按 `HARNESS_FROZEN_BASELINE` 二选一，冻结档
  禁 fetch/rebase/merge/cherry-pick/pull 其他候选、禁 force push、禁 `--no-verify`；
  Step 7 BEHIND 在冻结档下不做 `gh pr update-branch`。普通 dev 的 latest-main rebase 不变。
- 回退到 Brain `1.267.177` 会让冻结/对比 Kernel run 重新失去盲测边界，回退前必须 drain
  所有带 `payload.base_sha` 的 active run。

## Brain 1.267.177 — Kernel generator 字符串 PR artifact 规范化

- Generator callback 里以裸字符串上报的 GitHub PR URL 现在会被候选化，进入与结构化
  artifact 完全相同的服务端校验（仓库归属 → PR identity → 分支归属 → HEAD SHA），
  通过后才规范化成结构化 `type=pull_request` + `verification_status=verified`
  （带 `normalized_from: string_artifact` 留痕），从而正常投影 `initiative_runs.pr_url`。
- 生产实弹 run `a75ccbbf`：Generator 已开出 zenithjoy-workspace PR #1578，但
  `result.artifacts` 是 `["https://github.com/.../pull/1578", "Red commit: ...", ...]`
  字符串数组，Brain 只认结构化对象 → pr_url 未投影 → 状态机误判 `no_pr`。
- 字符串本身永不被信任：`repository_mismatch` / `branch_mismatch` / `invalid_url`
  一律降级为 `unverified_pull_request_claim`，校验设施不可用继续 503 fail closed
  保持 callback 可重试；非 PR 形态的字符串 artifact 原样透传，generator-fix 的
  `server_observed` 回退不变。
- 回退到 Brain `1.267.176` 会让字符串上报 PR 的 Generator run 重新误判 no_pr，
  回退前必须 drain 此类 active Kernel run。

## Brain 1.267.176 — Kernel cross-repository approved-SHA contract artifacts

- Kernel `persist_contract_approval` 现在按 task `payload.base_repo` 解析权威仓库，
  再按被批准的精确 SHA 物化合同产物；跨仓库 run（如 ZenithJoy）不再因为只读 Brain
  `origin` 而以 `approved_but_contract_artifacts_missing` 失败。
- 权威仓库复用 Kernel workspace 边界同一张 allow-list（`WORKSPACE_REPOSITORIES`），
  allow-list 外的仓库一律拒绝；本仓（origin 同仓）路径、full-SHA 与 repository-relative
  校验、immutable `git show <sha>:<path>` 语义与 fail-closed 全部不变。
- 回退到 Brain `1.267.175` 会让 Reviewer APPROVED 的跨仓库 run 再次在合同物化处失败，
  回退前必须 drain 此类 active Kernel run。

## Brain 1.267.175 — Kernel repository discovery and bounded workspace cleanup

- Kernel Ground Truth 现在按 task `base_repo` 查询 proposal refs；跨仓库任务不再误查
  Brain `origin`，因此已发布 proposal 能合法推进到 Reviewer。
- Fleet Worker `1.267.91` 为受控 workspace 根补齐 `_cecelia` 继承 ACL，并仅对经过
  attempt UUID 与受控根双校验的已知 worktree 清理错误执行精确删除；未知错误仍隔离。
- 三节点 Runner digest 保持
  `sha256:0ac225b0878550b6fbbb1f3b960be392630e52139df3fab761f4d5fe5cc4f721`；
  回退前必须 drain active Hybrid run，否则会恢复跨仓库 proposal 误判与 quarantine
  无界增长。

## Brain 1.267.174 — Runner Commander complete strict response schema

- Commander 的 Provider response schema 现在把根对象和 `route` 子对象的全部属性都列入
  `required`；原有可选语义用显式 `null` 联合类型表达，满足当前 Codex API 对每层对象的
  strict JSON Schema 约束。
- Runner 在可信规范化阶段剥离根对象与 `route` 内的 `null` 可选字段，再交给既有
  `commander-directive/v1` Zod 合同；不放宽 action、evidence、Provider、凭据、workspace
  或 callback 边界。
- 三节点固定 Runner
  `sha256:0ac225b0878550b6fbbb1f3b960be392630e52139df3fab761f4d5fe5cc4f721`；
  回退到 `1.267.173`/上一 digest 前必须 drain active `hybrid` run，旧组合会在首个
  Commander Attempt 恢复嵌套 `required` 不完整的 `invalid_json_schema`。

## Brain 1.267.173 — Runner Commander strict response schema

- Commander 的 Provider response schema 为 `schema` 常量补齐 JSON Schema
  `type: string`，兼容当前 Codex API 的 strict schema 校验，避免首个 Hybrid Attempt
  在模型执行前以 `invalid_json_schema` 退出。
- 三节点固定 Runner
  `sha256:c4c37787247cf0cb211b87f1ba7500e0e738bfa00228ddea7561821ff80f3189`；
  Provider、凭据、workspace 与 callback 边界不变。
- 回退到 `1.267.172`/旧 digest 前必须 drain active `hybrid` run；旧组合会恢复
  Commander schema 被当前 Codex API 拒绝的问题。

## Brain 1.267.172 — Fleet Worker Commander role admission

- Fleet Worker 的规范角色合同新增 `commander`，使 Hybrid run 的首个 Commander
  Attempt 能通过 Worker admission 并进入受控 workspace / pinned Runner 执行。
- 仍只接受 Commander 与既有七个 Harness 角色；未知角色继续在凭据、Git 和 Docker
  副作用前 fail closed，机器、Provider、模型与凭据边界不变。
- 回退到 `1.267.171` 会使新 Hybrid run 在首个 Commander Attempt 返回 HTTP 400；
  回退前必须 drain active `hybrid` run。

## Brain 1.267.171 — Commander auth failure status redaction boundary

- Commander 的递归秘密扫描器只把布尔 `auth_failed` 作为非秘密运行状态放行，
  修复初始 Hybrid run 在 `lastAgentExit.auth_failed=false` 上被误判并终止的问题。
- 非布尔 `auth_failed` 以及 `authorization`、token、secret、password、API key 等
  真实秘密材料仍然 fail closed；Provider 凭据与 CredentialEnvelope 边界不变。
- 回退到 `1.267.170` 会恢复 Hybrid run 在首个 Commander Attempt 前失败；回退前
  必须 drain active `hybrid` run。

## Brain 1.267.170 — Public Kernel run commander mode creation

- canonical 与 legacy Relay run 创建入口共用 allow-list 信任边界，允许显式选择
  `legacy-session`、`kernel-only` 或 `hybrid`，省略时保持 `kernel-only`。
- Kernel run Store 独立复核模式，并在创建事务的 INSERT 中原子持久化
  `commander_mode`；按 run ID 和 active task 读取时都返回该字段。
- 回退到 Brain `1.267.169` 前必须 drain active `hybrid` run；旧版本不会从公开入口
  创建 hybrid run，且读取时会把未投影的模式按 `kernel-only` 处理。

## Brain 1.267.169 — Kernel Evaluator Provider schema UID boundary

- Runner 的 root 可信前置把结果 schema 写成只读 `0444`，再以 UID 999、无 capabilities
  启动 Evaluator Provider，修复 Provider 读取 root `0600` schema 被拒绝的问题。
- schema 只包含公开输出合同；evidence capsule、CredentialEnvelope、exact-head 取证和
  Provider 无 GitHub authority 的边界均保持不变。
- 三节点固定 Runner
  `sha256:f57591df89aa1a15e49019f306abcc5606039314ebf5d293d884c055cbfe1d00`；
  回退到 `1.267.168`/旧 digest 前必须 drain active Evaluator Attempt。

## Brain 1.267.168 — Kernel Evaluator PR identity completeness

- Ground Truth 的 GitHub PR observation 现在携带不可变 `number`，Evaluator
  TaskBundle 可将 `pull_request.number` 与 evidence request 的 PR 号做同源校验。
- exact-head、workflow、run、artifact 与无 Provider GitHub authority 的边界保持不变；
  PR number 缺失或不匹配继续 fail-closed。
- 回退到 `1.267.167` 会恢复 `github_evidence_identity_mismatch`；存在 active
  Evaluator Attempt 时不得回退。

## Brain 1.267.167 — Kernel Evaluator trusted evidence capsule

- GitHub 写权限只在 US M4 Runner 的 Provider 前可信取证阶段存在；取证器把 repo、
  PR、exact head、workflow、run 与 artifact 逐层绑定并生成 SHA-256 manifest。
- 取证完成后删除 `hosts.yml`、清空凭据变量并验证 GitHub 已未登录，才启动
  Evaluator Provider；Provider 只能读取胶囊，不能触发、查询或下载 Actions。
- Provider 退出后 Runner 用未导出的 manifest digest 复核全部 artifact；任一字节被改
  即把 Attempt 判失败。三节点固定新 Runner
  `sha256:c78084e09c363601b00b968f47bca1e726ad14811feb438a91b70346e5fa4d33`；
  回退到 `1.267.166` 会重新暴露 Evaluator GitHub 凭据。

## Brain 1.267.166 — Kernel Evaluator structured evidence transport

- Provider 输出契约不再把 `checks[]` 强制为字符串，Evaluator 可把真实执行产生的
  `{command,exit_code,log_tail,verification_level}` 证据原样送入 callback 与 Judge。
- 传输层只保真，不替证据背书；Independent Judge 仍逐项拒绝缺退出码或输出尾部的
  结果，`.brain-result.json` bridge 继续作为兼容兜底。
- Fleet 三机统一固定 Runner
  `sha256:e4300138e571fbb80ebf2952f2fc1d9510066a18a218adf1c4c5259e1eaae979`；
  回退到 `1.267.165`/旧 digest 会恢复结构化证据被降为字符串的问题。

## Brain 1.267.165 — Fleet Judge embedded-contract mechanical evidence

- Independent Judge 的机械合同测试闸直接统计 Fleet TaskBundle 内锁版本
  `contract_content` 的具体 `[BEHAVIOR]` 条目；provider-neutral bundle 仍不暴露
  宿主 `worktree_path`，也不再因此假报 `contract_tests=0`。
- Sprint 测试文件和合同文件扫描仅作旧本地 run 的兼容 fallback；Evaluator 自报
  测试数、空标题或空列表项仍不能通过机械闸。
- 回退到 Brain `1.267.164` 会恢复该 path-free Fleet Judge 假失败；存在等待
  Independent Judge 的 active Kernel run 时不得回退。

## Brain 1.267.164 — Provider-neutral Kernel Judge evidence

- Independent Judge 现在优先读取 Fleet TaskBundle 内经批准且锁版本的
  `contract_content/prd_content`，不再要求 provider-neutral bundle 暴露宿主
  `worktree_path`；旧本地 run 仍可回退读取 sprint 文件。
- Judge 只有在解析到合同 E2E 或 Golden Path 步骤后才运行；两者都缺失时仍返回
  `NEEDS_CONTEXT`，结构化阶段闸、机械闸和人工合同 Gate 均未放宽。
- 回退到 Brain `1.267.163` 会使无宿主路径的 Fleet Judge 丢失已嵌入的合同证据，
  此类 active Kernel run 存在时不得回退。

## Brain 1.267.163 — Kernel Evaluator concerns verdict normalization

- Evaluator 的 `PASS_WITH_CONCERNS` 现在规范化为 append-only `PASS` verdict，
  不再被错误投影为 `FAIL` 并派发 Generator；未知 outcome 仍然 fail closed。
- Attempt 继续保存 `completed_with_concerns` 终态、完整 summary 和 concern reason，
  因而 Independent Judge 与 review-required Gate 仍会执行，不会吞掉 concerns。
- callback route 与原子 Attempt Store 共用同一个 verdict normalizer，避免兼容入口
  与生产事务路径再次漂移。
- 回退到 Brain `1.267.162` 会恢复该误判；存在此类 callback 的 active Kernel run
  时不得回退。

## Brain 1.267.162 — Kernel Evaluator feedback handoff

- `spawn:generator-fix` 现在接收与当前 PR head SHA 和失败 Evaluator Attempt ID
  双重绑定的安全反馈，包括 verdict、summary、decision reason 与最多 20 条
  机械检查证据；修复 Agent 不再从任务描述猜测失败原因。
- stale SHA、PASS、畸形或 Attempt 身份不一致的结果全部 fail closed。handoff
  只重建固定字段，不复制 provider metadata、credential reference 或 transcript，
  且所有文本经过统一脱敏与长度限制。
- 回退到 `1.267.161` 会再次丢失 Evaluator→Generator 修复上下文；有 active
  repair run 时不得回退。

## Brain 1.267.161 — Kernel Reviewer feedback handoff

- `collectGroundTruth` 从当前 proposal round/SHA 对应、且 canonical
  TaskBundle/HarnessResult 身份与状态一致的 completed Reviewer Attempt 投影有界
  反馈；旧轮、分支移动、缺 SHA 和畸形结果全部 fail closed。
- 下一轮 Proposer TaskBundle 显式携带 Attempt ID、round、SHA、summary 与
  decision reason，不再丢失上一轮阻塞项。
- 该 handoff 不结构化复制 provider metadata/transcript；summary/reason 复用
  Brain diagnostic 脱敏并分别截断到 2,000 字符。不要求 Worker 反查 Brain，
  不改变 Commander/Fleet 架构与 Reviewer fresh/read-only 隔离。

## Brain 1.267.160 — Planner receipt server attestation

- Brain 在 Git 校验后向 Attempt 与 callback event 原子写入同一份
  `server_verification.planner_git_artifact`；调用方字段会在解析时剥离，修复前
  没有该双份证明的历史 receipt 不再被消费。
- append-only snapshot 不再信任裸 `prdExists=true`；本地文件里程碑必须携带
  Brain 生成且绑定同一路径的 `prdEvidence`，阻断修复前 receipt 已被消费后的
  历史 boolean 旁路。
- Migration 381 把全新数据库的 execution transport 约束与生产对齐，正式允许
  `fleet-worker`，消除 migration 363 与生产 schema 的漂移。
- 回退到 `1.267.159` 会重新信任缺少服务端证明的历史 planner receipt；回退前
  必须确认没有 active Kernel run。

## Brain 1.267.159 — Planner concerns receipt convergence

- 远端 planner 的 `completed_with_concerns` 与既有 Kernel 合同保持一致：
  记录 concerns，同时允许已认证、lease-fenced 且服务端验证过的 Git artifact
  receipt 推进 PRD 里程碑，避免成功产物被误判为 `no_prd` 后重复派发 planner。
- receipt 仍要求 callback 与 Attempt 状态完全一致，并绑定精确 run、Attempt、
  lease generation、机器 attestation、仓库、分支、SHA 与 sprint path。
- 回退到 `1.267.158` 会重新只接受 `completed` planner receipt；回退前必须确认
  没有依赖 `completed_with_concerns` PRD artifact 的 active Kernel run。

## Brain 1.267.158 — Fleet Runner credential contract pin

- 三台 Fleet NodeProfile 统一固定 Runner
  `sha256:99168f93f9bba7815eea8f1934a1d1b411b78cb7acf6094719cdd674fa598e50`。
- Runner 内建功能探针使用真实 FIFO 调用生产 GitHub/Codex credential
  reader；rollout 在导出或传输 exact artifact 前以 8 秒硬超时执行探针，
  缺失或不可用时 fail closed。
- blue-green sidecar 的主部署与 fallback 都显式读取 `.env.docker`，避免
  Brain 重建后 Fleet bridge token 解析为空。
- 回退到 `1.267.157` 前必须 drain Fleet 节点并恢复上一 Runner digest；
  缺少 GitHub reader 的旧 Runner 禁止接收需要 GitHub envelope 的角色。

## Brain 1.267.157 — Fleet Worker GitHub envelope installer

- Fleet Worker 的事务安装、升级和回滚现在包含
  `github-credential-envelope.cjs`，保证已接入临时 GitHub 凭据的 Worker
  generation 可以被 LaunchDaemon 实际加载。

## Brain 1.267.156 — Staff Hub 验收终局：内网 pending/历史/结果提交端点

- 验收终局（决策 fc7b5dc0）：新增内网 `GET /api/brain/acceptance/pending`（团队共享待验收清单）、
  `GET /api/brain/acceptance/runs?gp_id=`（按 GP 历史查询）、`POST /api/brain/acceptance/results`
  （内网版结果提交，支持任意子集增量提交），供 Staff Hub 直连 Brain，Notion Worker 退场。
- `acceptance_checks` 新增 `detail`（工作卡文案）+ `submitted_by`（留痕）列（migration 380）。
- 抽取 `submitAcceptanceResults`/`loadRunsWithChecks` 共享核心函数，公网/内网路径复用同一套业务逻辑。
- 修复两个并发/事务安全缺陷：①`SELECT...FOR UPDATE` 行锁防止同一 run 并发提交时 pass_rate 计算竞态
  ②`SAVEPOINT` 包裹驳回任务 INSERT，防止撞上无关唯一索引时毒化整个事务导致静默丢数据。

## Brain 1.267.155 — Kernel real-business workspace convergence

- Kernel WorkspaceSpec 和 Fleet Worker 的受控仓库 allowlist 同时支持 Cecelia
  与 `perfectuser21/zenithjoy-workspace`；仍拒绝任意第三方仓库和请求方绝对路径。
- Brain 从 server-owned task worktree 的 Git origin 校验仓库身份并解析精确 SHA；
  ZenithJoy 真实业务 Attempt 可以进入统一 Worker API，不再在首个 planner
  派发时报 `workspace_repo_not_supported`。
- Fleet Runner 保留原始 task ID 和 planner/proposer/reviewer/generator/evaluator
  的角色环境合同；planner PRD 通过受控 Git branch + server-verified SHA 交给
  proposer，不能用“远端曾生成文件”的 callback claim 冒充可恢复产物。
- Planner/Proposer/Generator/Evaluator 的 GitHub 凭据由 US M4 按 Attempt 签发，
  Worker 一次消费后经 FIFO 注入容器 tmpfs；token 不进入 Docker argv/env、
  Worker state、receipt 或日志。Runner 用父进程内存中的初始 token 对所有
  provider 输出和结果统一洗敏，provider 篡改 `hosts.yml` 也不能绕过。
- Fleet evaluator 保留可写测试工作区，但以 Git 环境配置阻断 origin push，
  不能用评测凭据推进或改写被评 PR。
- 已存在的远端 writer branch 在独立 admin clone 中按服务端已验证 SHA
  安全 checkout，避免 `git switch -c` 与本地 ref 冲突。
- Kernel CLI 在依赖组装取得 pool 时即登记终结能力；其后的初始化或运行期
  顶层 fatal 会按精确 `run_id + task_id` 事务性终结 run、父 task 和 active
  attempts，避免子进程早退后留下无 heartbeat 的假 `in_progress`。
- 回退到 `1.267.154` 会重新只允许 Cecelia workspace；回退前必须 drain
  ZenithJoy Attempt，并确认没有依赖跨仓 WorkspaceSpec、Git artifact handoff
  或 Attempt-scoped GitHub envelope 的 active run。

## Brain 1.267.154 — Fleet Worker preflight startup convergence

- Fleet Worker installer 仅对 OrbStack 刚启动后的 `prerequisite_orbstack`
  瞬时失败执行有限重试，避免健康节点因单次启动窗口被整批 rollout 拒绝。
- Docker、container、磁盘、内存、服务身份、Runner digest、Git/worktree、
  callback 等聚合或确定性 admission 错误仍立即 fail-closed；重试次数与
  整数秒间隔均限制在 1–60 / 0–60 并校验输入。
- 回退到 `1.267.153` 会恢复单次 preflight；回退前应先确认 OrbStack、Docker
  socket 与 Runner probe 已稳定，再重跑节点 bootstrap。

## Brain 1.267.153 — Manual tick disable survives deploy restart

- Brain 启动时先读取 `working_memory.tick_enabled` 的 `source`；`source=manual`
  无论关闭多久都保持 disabled，不会被 60 分钟 startup auto-recover 或生产
  compose 默认的 `CECELIA_TICK_ENABLED=true` 推翻；启动初始化失败后的后台
  recovery timer 也遵守同一优先级，并在确认 manual 后停止无效重试。
- `drain`、`alertness` 或未知来源仍沿用既有超时恢复，避免临时保护状态永久停机。
- 回退到 `1.267.152` 会重新引入“部署重启自动覆盖长期人工停机”的风险；回退前
  必须以 `CECELIA_TICK_HARD_OFF=1` 硬关，或在每次重启后立即重新调用 disable。

## Brain 1.267.152 — Kernel reconcile precision

- Trust reconcile 事务复核直接按 run_id 使用 PostgreSQL 原始微秒时间戳，修复
  JavaScript `Date` 丢失微秒导致的假 optimistic conflict；锁内同时复核完整历史
  eligibility，plan 后失去资格的行 fail closed。
- Terminal mismatch apply 必须精确确认 repair 与 blocked 数；只修无冲突记录，
  blocked 历史逐条写 `blocked_acknowledged` 只读审计，不改人工终态。
- Migration 379 在数据库 INSERT trigger 中保留 initiative→task 统一锁序，拒绝
  终态父任务上的 active v2 run；等待中的 legacy writer 返回 `23514`。
- 回退到 `1.267.151` 时保留审计、已完成 repair 和 Migration 379 前向安全约束，
  禁止用旧 trust 脚本续跑微秒计划。

## Brain 1.267.151 — Kernel terminal-attempt convergence

- Attempt 创建必须锁定精确的 active v2 run；run 已终态或不存在时 fail closed，
  并发 winner 重读不能绕过父 run 状态。
- run/task 终态化按 `task → run → ordered attempts` 在一个事务中关闭 active
  attempt、清租约并记录 `parent_run_terminal`；callback/finalize 竞态不再留下
  `queued/starting/running` 孤儿。
- 历史 stale-attempt 修复默认 dry-run，生产 apply 绑定数据库、候选数、plan SHA
  和单实例锁，逐条重锁证据并输出独占、fsync、只读 JSONL 审计；只处理终态 v2
  父 run 下已过期或空租约的 active attempt，二次 dry-run 必须为 0。
- 回退应用到 Brain `1.267.150` 时保留历史审计和 attempt lifecycle 记录；禁止恢复
  终态父 run 继续生成 attempt 或 run/task/attempt 分裂终态。

## Brain 1.267.150 — Audited Kernel history reconciliation

- 历史 run trust apply 绑定数据库名、migration 376 切点、候选数、plan SHA 和
  单实例锁；batch 按 `initiative advisory → task → ordered runs → attempts` 的生产
  统一锁序重新验证证据，证据漂移即回滚，且不会与 terminal writer 形成死锁。
- 终态 run 与父 task 的历史不一致只按精确 run/task 修复；有 active sibling、
  混合终态结果或 task 已有冲突终态时拒绝提案，离线修复和 orphan-guard 都在
  task 行锁内再次检查 sibling，probe 后新建的 recovery run 不能被旧 run 误终止。
- 两类 reconcile 均默认 dry-run，生产 apply 使用独占、fsync、只读 JSONL 审计；
  trust 二次 dry-run 必须 `would_change=0`，terminal 只有回读精确状态后才记 `verified`。
- 回退应用到 Brain `1.267.149` 时保留 Migration 376/378 加法 schema；不得恢复
  initiative-wide mutation，也不得把 synthetic canary 当真实业务验收。

## Brain 1.267.149 — Kernel asynchronous callback convergence

- Dispatcher 持久化 launch receipt 后只返回 `LAUNCHED`；Loop 记录 launch effect
  后等待 callback/reconcile，不把启动误作角色完成。
- callback 以 run/attempt/owner/generation 全身份栅栏进入一个事务；Attempt 终态和
  `verdict:attempt_callback` 同时提交，重复 payload 幂等、旧租约和冲突 payload 409。
- `needs_context`、基础设施阻塞、语义拒绝、runner failure、取消和 no-PR 使用独立
  路由；只有结构化基础设施故障可换执行目标，第二次相同 `unknown_no_pr` 终结。
- Migration 378 扩展 Attempt failure-class CHECK 以保存 `needs_context`。回退应用到
  Brain `1.267.147` 时保留兼容 schema，禁止恢复 callback split-write。
- 人工 context 列表按来源地址限制为每分钟 60 次数据库读取；答案和审批写操作继续
  使用独立的每分钟 10 次限额。

## Brain 1.267.147 — Kernel exact run API and trust accounting

- canonical relay GET/PATCH 以完整 `run_id` 定位；initiative 历史只读且稳定排序。
  legacy initiative PATCH 只有唯一候选时才适配并记审计，否则 409 fail closed。
- 两个 watchdog 的 run/task 终态写入走同一事务，选择、计次与父任务定位使用
  `current_task_id`；缺身份 fail closed，不再批量改写同 initiative 的历史。
- Migration 376 为 run 增加可信度和 predecessor lineage。新 canonical run 标
  `trusted`；历史默认 `untrusted`，只能由 dry-run 优先、带绝对审计文件的确定性
  reconcile 分批重建；审计独占创建、记录真实 applied/conflict 后封为只读。
- Migration 377 用数据库 trigger 强制所有 initiative run INSERT 参与兼容 API 的
  identity/prefix 事务锁，直接 writer 也不能穿过唯一候选解析窗口。
- summary 分开 `trusted/reconstructed/untrusted`；SLO 使用每个任务最新的原生
  trusted 终态，活跃 run 不进入分母。
  回退：部署 Brain `1.267.146` 并保留加法 schema，禁止恢复批量 mutation。

## Brain 1.267.146 — Kernel run identity and atomic terminalization

- Migration 375 要求所有新 v2 run 绑定 `current_task_id` 并记录
  `created_source`，校验 task→initiative 归属，同时限制每个 task 只能有一条 active run。
- create/finalize 统一以 task→run 顺序加锁；run/task 终态原子提交，executor
  不得对 Kernel task 单独回写终态。
- `harness_initiative` 与 `golden_path_proposal` 的 Kernel orphan 都只做精确终态
  对账或失败关闭，不再落入 legacy requeue 重复点火。历史缺身份行保持 untrusted，
  等待后续重建；Fleet synthetic canary 走 schema 合法的 v1 lane，并以
  `orchestrator_host=kernel-fleet-canary` 标识，不冒充业务 v2 run。
- 回退：部署 Brain `1.267.145`，保留 Migration 375 的加法 schema；禁止恢复
  initiative-wide mutation 或猜测回填历史身份。

## Brain 1.267.145 — Same-FD pinned toolchain snapshot

- Attestation 仅消费策略模块签发的 command，并以 no-follow 打开 canonical tool。
- 在同一只读 FD 上校验元数据、分块哈希和前后 identity；异常失败关闭。回退：Brain `1.267.144`。

## Brain 1.267.144 — Pinned toolchain attestation policy

- 新增两阶段纯策略：执行前校验 Phase 4A NodeProfile 的 expected/actual Runner digest，并对 realpath 后的工具链文件逐一 SHA-256；执行后复验漂移。
- 缺 pinned digest、路径或文件一致性即禁止盖章；attestation 可写入场景证据但
  不含文件内容。本层不接 Runner/receipt。回退：部署 Brain `1.267.143`。

## Brain 1.267.143 — Pinned assertion command policy

- 固定 Vitest、Pytest/bash 策略；工具链须为 absolute pinned descriptor，执行对象须为 canonical tracked 普通文件。
- command/argv/toolchain/env 深冻结，位置参数安全传递，环境明确不继承。
- 不执行断言，不接 Runner、receipt、API/UI。回退：Brain `1.267.142`。

## Brain 1.267.142 — Trusted assertion process adapter

- 新增短进程执行器边界：只接受显式注入的 trusted spawn adapter；未注入时
  在启动前以 `TRUSTED_PROCESS_ADAPTER_REQUIRED` 失败关闭。
- 子进程仅获得最小环境白名单；超时以独立进程组 TERM/KILL 整树清理，
  清理失败及 signal 退出均规范化为可验证的失败证据。
- 本层没有 Brain 本机默认执行路径，不选择命令、不写 receipt、不接 API/UI。
- 产权变更 B 继续 `effective_now=false`。回退：部署 Brain `1.267.141`。

## Brain 1.267.141 — GP assertion output evidence utility

- 新增独立输出证据工具：按 UTF-8 字节边界保留尾部、遮蔽 bearer 与键值凭据，
  并从 Vitest、Pytest 或显式 bash marker 提取场景计数证据。
- 本层只提供纯输出/evidence utility，不接线 Runner、receipt、API 或 UI。
- 产权变更 B 继续 `effective_now=false`。回退：部署 Brain `1.267.140`。

## Brain 1.267.140 — Golden Path §④-1 receipt evidence schema (stack 2)

- Migration 374 新增不可变受信执行 receipt 与场景证据，selfcheck 地板升到 374；
  不完整 PASS 不算覆盖。本层仍不含 Runner、route 或 UI，不宣称生产盖章完成。

## Brain 1.267.139 — Golden Path §④-1 receipt-state pure model

- 新增纯函数 `deriveAssertionVerification`：只从调用方提供的断言格与 receipt
  历史派生 `never_run`、最新失败或最新通过状态；旧 revision 仅保留为历史，
  同 revision 同时间以稳定字段确定性选出唯一最新记录。PASS 必须带完整执行
  身份、source/output 摘要、零退出码、非 synthetic 时间戳及场景证据。
- 本层不执行断言、不读写数据库、不新增 migration/API/Runner，也不持久化
  receipt；派生出的通过状态不等于完成“盖章”，不宣称 §④ 已上线。
- 产权变更 B 继续 `effective_now=false`。回退：部署 Brain `1.267.138`。

## Brain 1.267.136 — T10 统一收件箱路由补齐（learnings → capture_atoms）

- `packages/brain/src/` 下 11 处 `INSERT INTO learnings` 调用点（`cortex.js`、
  `executor.js`、`conversation-consolidator.js`、`learning.js`×2、
  `auto-learning.js`、`chat-action-dispatcher.js`×2、`decision-executor.js`×2、
  `fact-extractor.js`）补齐 `pushCaptureAtom` 调用，对齐已接入路径
  （`learning.js::recordLearning`）的既有容错模式（失败仅 `console.warn`，
  不阻断 `learnings` 主写入）。
- 新增 1 条永久 CI 结构性回归测试（source-code inspection，零 mock，遍历全部
  `INSERT INTO learnings` 调用点）+ 1 条 `cortex.js::recordLearnings` 行为级
  复现测试，防止未来新增写入点再次漏接统一收件箱。
- 不改动已接入的 2 处（`learning.js::recordLearning`、`routes/tasks.js`
  learnings-received 端点）、不改动 `capture-inbox.js` 内部实现、不改动
  `ledger-hygiene.js` m7 探针判定逻辑。
- 回退：部署 Brain `1.267.135`；本次改动为纯代码路径接线补齐，无 migration。

## Brain 1.267.135 — Golden Path §③ ledger data knife

- Migration 373 在既有 `journey_step_links` 上完成证据诚实回填，不新建平行
  账本：真实 feature 锚点和 GP-B Path 4 业务 smoke 入格，历史自由文本规范化；
  找不到可辩护证据的 green/pending 格降为 red，不制造假覆盖。
- NFR 决策新增明确 `journey_step` target，逐步归位并继承四家 home；产品
  Journey ledger 改为直接读取四区格子，修复此前把 Brain 内部模块字段错套到
  `journey_features` 导致的 HTTP 500。
- 新 readiness gate 对正向格证据、NFR 归属、base_ref 外键和 assertion_ref
  类型 fail closed，并由 PostgreSQL integration + 真 Brain HTTP smoke 验证。
- 本版本只完成最终 PRD §③；§④ 的断言盖章等四件机制仍未开始，产权变更 B
  继续 `effective_now=false`。
- 回退：部署 Brain `1.267.133`；Migration 373 数据保留供审计。

## Brain 1.267.133 — Versioned Golden Path contract Gate

- Migration 372 新增 append-only `golden_path_contract_versions`：每条 GP 的
  严格 7 项合同按版本和规范 SHA-256 保存，签字绑定不可变
  `contract_id/version/hash`，同一 GP 至多一个 `signed` 版本。
- 合同任一项变化会使旧 `signed` 版本变 `invalidated`、旧
  `pending_signature` 变 `superseded`，并创建新的 Owner 签字待办；相同最新
  内容幂等，不阻止未来以新版本恢复某个更旧内容。
- 替换合同时，`dispatched/in_progress` Harness task 要求先 drain 并返回
  `GP_CONTRACT_IN_FLIGHT`；仅 `queued/blocked` 的旧任务在同一事务中取消。
- Owner 批准 pending action 后，judgment、具体版本签字、绑定
  `gp_contract_id/version/hash` 的唯一 Harness task 和 GP `approved` 状态在同一
  事务提交；旧 `/golden-paths/:id/approve` 只读回最新已签版本的既有任务，
  未签时硬拒绝。
- proposer/reviewer/mapper/controller 快照精确同步
  `zenithjoy-skills#172@d19924f31`；reviewer 红方攻击与事故对照已接线。产权变更 B
  仍不生效，因为 §④ 断言盖章尚未上线。
- 本版本不包含 §③ 锚点回填，也不包含 §④ 断言盖章、裁决记账、退役触发、
  事故对照库或打回率机制。
- 回退：先暂停 GP 签字并 drain/cancel 受影响的 GP Harness task，再部署 Brain
  `1.267.132`。Migration 372 及合同/签字记录保留作审计；旧 Brain 不得继续执行
  GP approve，因为它没有合同 Gate。

## Brain 1.267.131 — Finalized Golden Path governance decisions

- Migration 370 把 Owner 定版的两条封版判据、拒绝话术、产权变更 B、高风险
  清单、向上默认分类和让路顺序写入 `decisions`，以稳定 `source_ref` 和
  `context.policy_key/policy_version` 供后续合同 Gate 读取。
- `decisions.level` 新增 `global`；Harness line context 一次读取 global 与 area
  invariant，并按 step、journey_feature、global、area 的优先级去重注入。
- 本版本只完成治理 SSOT 与继承入口，不启用产权变更，不包含 GP 合同签字、
  断言盖章或其他 PRD ④机制。
- 回退：部署 Brain `1.267.130`。Migration 370 的 policy rows 可保留为审计记录；
  旧 Brain 不读取 `level='global'`。

## Brain 1.267.128 — Provider-neutral attempt timeout terminal

- `TaskBundle.constraints.timeout_seconds` 现在作为 authoritative attempt timeout，
  由 Brain transport 传入 Fleet Worker，并以 `HARNESS_TIMEOUT_SECONDS` 进入
  pinned Runner。
- Codex、Claude 与 Grok 共用同一 TERM/KILL 超时边界；超时返回静态
  `provider_timeout` 终态，不回显 provider stdout 或临时凭据。
- Kernel 将 `provider_timeout` 归类为基础设施故障，保持 provider-neutral
  terminal schema；本版本不扩展 Phase 5。
- Runner pin：
  `sha256:6b6c4f9381aefd41d3cac723943e81143344f584971bf715beca04cc9bdb30ea`。
  该 artifact 以已部署的
  `sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7`
  为只读基线，仅叠加本版本审阅后的 Runner entrypoint。
- 回退：节点 drain 后加载上一 Runner digest，并部署 Brain `1.267.126`。

## Brain 1.267.126 — Writable ephemeral Codex credential tmpfs

- Fleet Worker 为 Runner 的临时 `/home/cecelia/.codex` tmpfs 固定为 pinned
  Runner 用户 `uid=999,gid=999,mode=0700`，使其可从 FIFO 写入一次性
  `auth.json`。
- Worker 通过 `docker exec -i` 的 stdin 在 Runner 内部写 FIFO，避免 macOS
  host 与 OrbStack VM 之间 bind-mounted FIFO 无法握手；secret 不进入 argv、
  env、日志或 host credential 文件。
- tmpfs 仍保持 `noexec,nosuid,nodev`，CredentialEnvelope、host credential
  isolation、terminal cleanup 与 Xian 无长期凭据边界不变。
- 回退：部署 Brain `1.267.125`。

## Brain 1.267.125 — OrbStack-safe Fleet attempt mounts

- Fleet Worker 将仅供 Runner bind mount 的 worktree/runtime 放入
  `/Users/Shared/cecelia-fleet-tmp/fleet-mounts`；mirror、state、quarantine 与
  CredentialEnvelope consumption marker 继续留在受保护 data root。
- Docker adapter 使用真实 host 路径和本机已加载的精确 `sha256:` image ID，
  并只向 OrbStack owner 授予单次 workspace、Git admin 与 runtime 的 ACL。
- ACL 遍历不跟随 symlink；`.admin` 父目录仅开放 traversal，container
  read-only、workspace ownership 与短期凭据边界保持不变。
- 回退：部署 Brain `1.267.124`。

## Brain 1.267.124 — Server-seeded Fleet mirror reuse

- Fleet Worker 先验证 server-owned mirror 已包含精确的 `base_sha` 与
  `expected_head_sha`；完整时跳过对 GitHub 的无条件 fetch。
- 任一目标 commit 缺失时仍执行既有 fetch，并继续以精确 SHA fail closed。
- 回退：部署 Brain `1.267.123`。

## Brain 1.267.123 — Unified Fleet Worker production transport wiring

- 生产 Compose 补齐 `KERNEL_FLEET_REMOTE_ENABLED`、共享 Worker bearer
  token 与 Tailscale callback base URL，使 US M4、Xian M4、Xian M1
  都进入 Phase 4B 的同一 authenticated Worker Attempt API。
- 缺失或过短 token 继续 fail closed；不在 Xian 保存长期 Codex 凭据，
  不扩展 Phase 4C/4D，也不执行 Phase 5 真实业务 Canary。
- Brain 回退目标：`1.267.122`。

## Brain 1.267.122 — Fleet Worker shared TMPDIR hotfix

- system LaunchDaemon installer 创建并校验 OrbStack 可共享的固定 TMPDIR，
  以 `_cecelia:_cecelia`、`0755` 管理，避免 clean node 在 worktree/container
  probe 前因 `mkdtemp` 失败。
- 路径拒绝 symlink 与任意 override；不改变 Runner pin、凭据或
  Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.121`；节点保持 drain 后再回退。

## Brain 1.267.121 — Fleet nodectl pinned Node hotfix

- `fleet-nodectl admit` 优先使用受管 pinned Node，再回退到显式 override 或
  `PATH`，使 clean node 不依赖交互式 shell 的 Node 安装。
- 不改变 admission 阈值、Runner pin、凭据或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.120`；节点保持 drain 后再回退。

## Brain 1.267.120 — Fleet OrbStack Docker socket link hotfix

- baseline reconcile 以 fail-closed 契约把 `/var/run/docker.sock` 链接到节点
  OrbStack owner 的受管 socket，使 system LaunchDaemon 使用统一 Docker 入口。
- 冲突链接或非 OrbStack 目标继续拒绝 admission；不扩展 Phase 4A 范围。
- Brain 回退目标：`1.267.119`；节点保持 drain 后再回退。

## Brain 1.267.119 — Fleet Codex probe pinned runtime hotfix

- Node/Codex 自检通过受管 toolchain 执行，避免 LaunchDaemon 与交互式 shell
  `PATH` 差异造成误报。
- 不复制长期 Codex 凭据，不改变凭据 envelope 或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.118`；节点保持 drain 后再回退。

## Brain 1.267.118 — Fleet pinned Node bootstrap hotfix

- baseline bootstrap 安装并验证 pinned Node 路径，使 Worker、admission 与 Codex
  probe 在 clean node 上使用同一受管运行时。
- 失败继续保持 drain；不改变 Runner pin 或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.117`；节点保持 drain 后再回退。

## Brain 1.267.117 — Fleet OrbStack home preflight hotfix

- Worker LaunchDaemon 显式携带 OrbStack owner home，避免 system domain 使用
  `/var/empty` 时无法解析统一容器运行时。
- 仍只允许 OrbStack/Docker，不引入其他容器运行时或长期凭据。
- Brain 回退目标：`1.267.116`；节点保持 drain 后再回退。

## Brain 1.267.116 — Fleet production admission stabilization

- 收紧生产 NodeProfile、probe 与 admission 的一致性，修复 clean node 在真实
  LaunchDaemon 环境下的 false negative，同时保留磁盘、资源、网络与 drift
  的 fail-closed 门槛。
- macOS `15.7.4` 是安全更新建议，`15.6.1` 仍满足本阶段服务器 admission；
  不扩展 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.115`；节点保持 drain 后再回退。

## Brain 1.267.115 — Fleet admission evaluator artifact hotfix

- rollout source archive 纳入 `node-admission.js`，使节点 `fleet-nodectl admit`
  能加载与 `node-profile.js` 配套的 admission evaluator，而不是在 undrain 后因
  `ERR_MODULE_NOT_FOUND` 失败。
- artifact 合同测试机械锁定该依赖；不改变 admission 阈值、Runner pin、凭据或
  Phase 4B/4C/4D/5 范围，任何失败继续恢复 drain。
- Brain 回退目标：`1.267.114`；节点保持 drain 后再回退。

## Brain 1.267.114 — Fleet Worker credential module install hotfix

- system LaunchDaemon installer 把 Worker 运行时依赖的 `credential-envelope.cjs`
  纳入同一代 staging、placement、snapshot 与 rollback 事务，避免启动时
  `MODULE_NOT_FOUND`。
- credential envelope 使用只读 `0644` runtime mode；失败继续完整回滚并保持
  节点 drain，不改变凭据内容、Runner pin 或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.113`；节点保持 drain 后再回退。

## Brain 1.267.113 — Fleet rollout bundle HEAD contract hotfix

- rollout 产物仓库把 `HEAD` 固定到冻结的 `fleet-rollout` ref，并以 `HEAD`
  创建 Git bundle，使节点 baseline 的既有 `fetch ... HEAD` 契约可解析到同一
  rollout commit。
- bundle 仍只包含冻结提交，不改变 Runner pin、Worker token、admission 或
  Phase 4B/4C/4D/5 范围；失败仍保持节点 drain。
- Brain 回退目标：`1.267.112`；节点保持 drain 后再回退。

## Brain 1.267.112 — Fleet disposable bind-mount traversal hotfix

- node probe 在创建一次性 Git worktree 前把随机临时根目录从 `0700` 收敛为
  `0755`，让宿主用户域的 OrbStack daemon 可以遍历路径并执行只读 bind mount。
- 临时目录仍使用不可预测名称，容器挂载仍为 readonly，探针结束仍删除 worktree、
  容器和临时根目录；不扩大 repository、凭据或 Docker socket 权限。
- Brain 回退目标：`1.267.111`；节点保持 drain 后再回退。

## Brain 1.267.111 — Fleet canonical repository safe-path hotfix

- baseline 在设置进程级 `safe.directory` 前先用 `realpath` 规范化受控 bare
  repository，兼容 macOS `/var` → `/private/var` 的系统符号链接。
- 不放宽全局 Git 配置，不信任其他目录；失败仍保持节点 drain，不改变 Runner pin、
  Provider 凭据或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.110`；节点保持 drain 后再回退。

## Brain 1.267.110 — Fleet repeat-bootstrap repository ownership hotfix

- baseline 对受控 bare repository 的每次 Git 读取、fetch 与 ref 更新都显式限定
  `safe.directory` 为该 NodeProfile 的 repository 路径，使 root reconcile 能安全、
  可重复地处理已归属 `_cecelia` 的基线仓库。
- 不放宽全局 Git 配置，不信任其他目录；失败仍保持节点 drain，不改变 Runner pin、
  Provider 凭据或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.109`；节点保持 drain 后再回退。

## Brain 1.267.109 — Fleet OrbStack service-user path ACL hotfix

- Fleet Worker installer 在低权限 node probe 前，为 OrbStack owner home、
  `.orbstack` 与 `.orbstack/run` 授予 `_cecelia` 最小 search ACL，再授予
  Docker socket read/write ACL，修复真实节点 `prerequisite_orbstack`。
- 安装失败只回滚本次新增 ACL；Worker 仍是 system LaunchDaemon，不引入 GUI
  LaunchAgent，不改变 Runner pin、Provider 凭据或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.108`；节点保持 drain 后再回退。

## Brain 1.267.108 — Fleet OrbStack user-domain startup hotfix

- baseline 通过原始 rollout 管理用户的 launchd 域启动、停止并检查 OrbStack，
  不再从 root 域调用用户态 VM；异步启动仍使用 30 秒有界状态核对。
- Fleet Worker 继续作为 `_cecelia` 的 system LaunchDaemon 运行；不引入 GUI
  LaunchAgent，不改变 Runner pin、Provider 凭据或 Phase 4B/4C/4D/5 范围。
- Brain 回退目标：`1.267.107`；节点保持 drain 后再回退。

## Brain 1.267.107 — Fleet OrbStack eventual-start hotfix

- OrbStack `start` 返回非零后不再立即回滚；baseline 会在 30 秒有界窗口内以
  `orb status` 核对真实运行状态，兼容升级和首次安装的异步 VM handoff。
- 超时仍 fail closed 并保持节点 drain；Runner digest、NodeProfile 和 Phase
  4B/4C/4D/5 范围均未改变。
- Brain 回退目标：`1.267.106`；节点保持 drain 后再回退。

## Brain 1.267.106 — Fleet rollout root-staging executable hotfix

- 修复 Xian rollout 在 root-owned `0700` staging 外由普通 SSH 用户展开
  `*.sh`、导致生产 bootstrap 在执行前失败的问题；现在由 root 在已校验子树内
  设置脚本执行位。
- 变更只恢复 Phase 4A 既有生产入口；不扩展 Phase 4B/4C/4D/5，也不复制 Xian
  长期 Provider 凭据。
- Brain 回退目标：`1.267.105`；节点保持 drain 后再回退。

## Brain 1.267.105 — Fleet Node macOS admission policy correction

- macOS `15.6.1` 是最低支持版本；同一 macOS 15 major 的更高 minor/patch
  可以准入，低于 floor、malformed 或未经验证的其他 major 继续 fail closed。
- `15.7.4` 是非阻塞安全维护建议，不再把两台 M4 的补丁号差异误判为 admission
  失败；Runner digest、OrbStack/Docker 与 Phase 4A 其余合同不变。
- Brain 回退目标：`1.267.104`；节点保持 drain 后再回退。

## Brain 1.267.103 — Fleet rollout transfer-interruption cleanup

- Xian SSH rollout 在 payload 解包前即安装 EXIT/HUP/INT/TERM 清理：截断传输、
  tar 失败或控制器中断都会先 fail-closed drain，再删除精确的 root staging。
- 成功路径仍只清理一次性 staging，不改变 NodeProfile、bootstrap、admission、
  Runner digest 或 Phase 4B/4C/4D/5 边界。
- Brain 回退目标：`1.267.102`；节点保持 drain 后再回退。

## Brain 1.267.102 — Fleet rollout protected-token staging

- US M4 rollout 控制器可在不放宽 `_cecelia` 0700 数据目录的前提下，经
  `sudo -n` 验证并以 0600 一次性分阶段复制 Worker bearer token。
- token 内容不进入命令参数、日志、Git 或 Xian 长期 provider credential；节点
  drain/bootstrap/admission 顺序及 Phase 4A 之外的执行语义均未改变。
- Brain 回退目标：`1.267.101`；节点先用 `fleet-nodectl.sh drain` fail closed。

## Brain 1.267.101 — Fleet Node Phase 4A production convergence

- 三台 canonical Fleet Node 使用同一份 US M4 基线和从
  `origin/main@9466c380` 构建的 pinned Runner
  `sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7`；
  rollout、registry、admission 与 drift 检查共享该唯一 pin。
- macOS `15.7.4` 是最低补丁线：同一 `15.7` release line 的更高补丁可准入，
  低于 floor 或跨 release line 的版本仍 fail closed。Baseline reconciler 同时
  将官方 Tailscale app CLI 暴露到 system LaunchDaemon 的固定 toolchain PATH。
- 本版本只收敛 Phase 4A NodeProfile、bootstrap、admission、drain 与生产节点基线；
  不新增 Phase 4B/4C/4D 行为，不复制 Xian 长期 Codex 凭据，也不执行 Phase 5
  synthetic 或真实业务 canary。
- Brain 回退目标：`1.267.100`；节点先用 `fleet-nodectl.sh drain` fail closed。

## Brain 1.267.99 — Harness Commander Phase 2

- `hybrid` Run 现在可把 material Kernel boundary 封装成隔离 Commander Attempt，
  经 Claude/Codex/Grok 的同一 Provider Registry、preflight、lease、callback 与
  execution receipt 链返回一条 provider-neutral Directive；默认仍为 `kernel-only`。
- L0 保持最终权威：Directive 不能绕过 role、evidence、budget、deadline、merge 或
  deployment gate。接受、拒绝和基础设施 failover 都可从 authoritative decision log
  与不可变事件投影回放。
- 跨 Provider 只允许显式白名单基础设施失败并创建 fresh-session retry lineage；
  语义/产品失败、无效 Directive 和未知文本不 failover，目标用尽转人工。
- 本版本不部署节点、不复制凭据、不执行 synthetic/真实 canary；Xian 不保存长期
  Codex 凭据，后续节点基线继续以 US M4 OrbStack 配置为准。
- Brain 回退目标：`1.267.98`。

## Brain 1.267.98 — Harness Commander Phase 1

- 新增 provider-neutral Commander/Directive/Actor message 合同、Run 隔离状态、
  事务性事件投影、持久 Actor Inbox 与只读观测 API。
- `commander_mode` 默认 `kernel-only`；事件是既有 Kernel authority 的可重建投影，
  Actor message 和 Directive validator 在本阶段都不能造成副作用。
- 本版本不含 Provider 调用、Commander Attempt、部署或 synthetic/真实 canary。
  Phase 2 和 Phase 5 继续以独立 PR 交付。
- Brain 回退目标：`1.267.97`。

## 目录

1. [核心定位](#1-核心定位)
2. [架构总览](#2-架构总览)
3. [三层大脑](#3-三层大脑)
4. [数据模型](#4-数据模型)（执行轴 §4.1 · 能力轴 §4.2）
5. [任务生命周期](#5-任务生命周期)
6. [保护系统](#6-保护系统)
7. [并发与资源管理](#7-并发与资源管理)
8. [部署架构](#8-部署架构)
9. [API 接口](#9-api-接口)
10. [文件地图](#10-文件地图)
11. [运维手册](#11-运维手册)

---

## 1. 核心定位

### 1.1 Cecelia 是什么

**Cecelia = 24/7 自主运行的管家系统**

```
Cecelia Core = Brain (Node.js, port 5221)
             + Tick Loop (每 5s 循环检查，每 2min 执行一次 tick)
             + 三层大脑（L0 脑干/L1 丘脑/L2 皮层）
             + 保护系统（alertness, circuit-breaker, quarantine, watchdog）
```

**关键理解**：Cecelia **自己不干活**，只负责决策和调度。

- **不写代码**：召唤 Caramel（外部程序员 Agent）
- **不做 QA**：召唤小检（外部测试员 Agent）
- **不做审计**：召唤小审（外部审计师 Agent）
- **不处理数据任务**：路由到 N8N（外部自动化工具）

Cecelia 是一个自主运行的任务调度与决策系统。她接收 OKR 目标，自动拆解为可执行任务，派发给外部员工执行，监控执行状态，处理失败和异常，并从经验中学习。

**核心职责（扩展）**：
- **主动汇报**：定期通过 Dashboard 推送运行状态、进度快照和洞察，不等用户主动查看。
- **正向感知**：在系统正常运行时也持续产生认知活动，不只在出现异常时才发出声音。

### 1.2 核心器官（Core 内部组件）

**Core 只包含 Cecelia 的生命体内部器官**：

| 器官 | 实现 | 职责 | 说明 |
|------|------|------|------|
| ❤️ **心脏** | tick.js | Tick Loop 驱动 | 每 5s 循环，每 2min 执行 |
| 🧠 **大脑 L2** | cortex.js | 皮层（深度分析） | Opus，RCA/战略调整/记录经验 |
| 🧠 **大脑 L1** | thalamus.js | 丘脑（事件路由） | MiniMax M2.1，快速判断/异常检测 |
| 🧠 **大脑 L0** | planner.js, executor.js, tick.js | 脑干（纯代码） | 调度、派发、保护系统 |
| 🛡️ **保护系统** | alertness/, circuit-breaker, quarantine, watchdog | 自我保护 | 四重防护 |
| 📋 **规划器** | planner.js | KR 轮转、任务生成 | 基于评分选择下一个任务 |
| 🔌 **对外接口** | executor.js | 召唤外部员工 | 不自己干活，只召唤 |
| 🌐 **神经系统** | routes.js | HTTP API | Express 路由 |
| 📊 **记忆读写** | 读写 working_memory 等表 | 记忆逻辑 | 数据在外部（PostgreSQL） |

**明确**：PostgreSQL 不是"记忆器官"，它是外部存储设备（见 Section 1.3）。

### 1.3 外部依赖（Infrastructure）

**Cecelia 依赖以下外部服务，但它们不是 Core 的一部分**：

| 服务 | 位置 | 职责 | 类比 |
|------|------|------|------|
| **PostgreSQL** | 独立容器 (port 5432) | 数据存储 | 外部硬盘 |
| **N8N** | HK server (port 5678) | 处理 `data` 类型任务 | 外包数据公司 |

**说明**：
- PostgreSQL：存储所有状态和历史，但它不是 Core 的"器官"，而是外部存储设备
- N8N：只处理 HK region 的 `data` 类型任务（task-router.js 路由规则），US region 的 data 任务不走 N8N

### 1.4 外部员工（Agent Workers）

**Cecelia 自己不干活**，通过 `executor.js` 召唤外部员工执行任务：

| 员工 | Skill | 模型 (Anthropic / MiniMax) | 职责 | 类比 |
|------|-------|------|------|------|
| **Caramel** | /dev | Sonnet / M2.5-highspeed | 编程（写代码、PR、CI） | 外包程序员 |
| **小检** | /qa | Sonnet / M2.5-highspeed | QA 总控 | 外包测试员 |
| **小审** | /audit | Sonnet / M2.5-highspeed | 代码审计 | 外包审计师 |
| **秋米** | /okr | Sonnet / M2.5-highspeed | OKR 拆解（边做边拆） | 外部顾问 |
| **审查员** | /review | Sonnet / M2.5-highspeed | 代码审查（只读模式） | 外部审查员 |
| **Vivian** | - | MiniMax Ultra | 拆解质量审查 (HK) | 外部审查员 |

**关键理解**：
- 这些是**外部无头进程**，不属于 Core
- Cecelia 通过 `executor.js` 召唤它们
- `executor.js` 是 Core 的"对外接口器官"，不是"执行器官"

**调用链**：
```
tick.js (决策派发)
  ↓
executor.js (召唤接口，检查资源)
  ↓ spawn
cecelia-bridge → cecelia-run → claude -p "/skill ..."
  ↓ (独立进程，干活)
Agent Workers (Caramel/小检/小审/...)
  ↓ 完成后
回调 Core API (POST /api/brain/execution-callback)
```

### 1.5 意识守护（Consciousness Guard）

Brain 的意识 / 自我对话模块（rumination / diary / proactive-mouth / evolution-scanner / desire / ...）可通过环境变量 `CONSCIOUSNESS_ENABLED=false` 整体关闭，**保留任务派发、调度、监控不受影响**。

**开关**：
| 值 | 效果 |
|---|---|
| `CONSCIOUSNESS_ENABLED=false` | 关（推荐） |
| `BRAIN_QUIET_MODE=true` | 关（deprecated 别名，3 月兼容窗口） |
| 默认（未设） | 开 |

**守护函数**：`packages/brain/src/consciousness-guard.js` 导出 `isConsciousnessEnabled()`，所有意识模块入口通过它判断。CI 反向 grep 脚本 `scripts/check-consciousness-guard.sh` 禁止裸读环境变量。

**启动日志**：
```
[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过（保留任务派发/调度/监控）
[Brain] 守护模块: thalamus/rumination/narrative/diary-scheduler/evolution-scanner/...
```

**不守护（保留派发 / 纯计算）**：planner / executor / dispatchNextTask / quarantine / circuit-breaker / alertness / harness-watcher / publish-monitor / credential-check / evaluateEmotion（纯函数，dispatch_rate_modifier 派发依赖）。

**运行时热切换（Phase 2）**：通过 Dashboard `/settings` 页或 API `PATCH /api/brain/settings/consciousness` 即时切换，无需重启。API 层写 `working_memory.consciousness_enabled` + 模块 cache write-through。**env 优先级**：plist 设 `CONSCIOUSNESS_ENABLED=false` 时 memory 被忽略（主机级紧急逃生口）。Dashboard 检测到 `env_override=true` 自动 disable Switch。

---

## 2. 架构总览

### 2.1 四层完整架构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Cecelia Core (cecelia/core repo)              │
│  ┌───────────────────────────────────────────────────┐ │
│  │  ❤️ 心脏 (tick.js)                                │ │
│  │  🧠 大脑 L2 (cortex.js) - Opus                    │ │
│  │  🧠 大脑 L1 (thalamus.js) - MiniMax M2.1         │ │
│  │  🧠 大脑 L0 (planner.js, executor.js) - 纯代码   │ │
│  │  🛡️ 保护系统 (alertness, watchdog, ...)          │ │
│  │  📋 规划器 (planner.js)                           │ │
│  │  🔌 对外接口 (executor.js) - 召唤外部员工        │ │
│  │  🌐 神经系统 (routes.js) - HTTP API              │ │
│  │  📊 记忆读写逻辑 (读写 working_memory 等表)      │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          ↓ 依赖
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Infrastructure (外部存储)                      │
│  ┌───────────────────────────────────────────────────┐ │
│  │  PostgreSQL (独立容器, port 5432)                 │ │
│  │  - cecelia 数据库                                 │ │
│  │  - 核心表 + 系统表                                 │ │
│  │  - 唯一真相源                                     │ │
│  ├───────────────────────────────────────────────────┤ │
│  │  N8N (HK server, port 5678)                       │ │
│  │  - 只处理 HK region 的 data 任务                  │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          ↓ 召唤
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Agent Workers (外部员工)                       │
│  ┌───────────────────────────────────────────────────┐ │
│  │  Caramel (/dev, Sonnet/M2.5-hs) - 外包程序员     │ │
│  │  小检 (/qa, Sonnet/M2.5-hs) - 外包测试员        │ │
│  │  小审 (/audit, Sonnet/M2.5-hs) - 外包审计师     │ │
│  │  秋米 (/okr, Sonnet/M2.5-hs) - 外部顾问        │ │
│  │  审查员 (/review, Sonnet/M2.5-hs) - 外部审查员  │ │
│  │  Vivian (decomp_review, MiniMax Ultra) - HK     │ │
│  └───────────────────────────────────────────────────┘ │
│  独立无头进程，通过 cecelia-bridge 召唤                  │
└─────────────────────────────────────────────────────────┘
          ↓ 展示
┌─────────────────────────────────────────────────────────┐
│  Layer 4: Workspace (对外窗口)                           │
│  ┌───────────────────────────────────────────────────┐ │
│  │  cecelia/workspace (port 5211)                    │ │
│  │  - React/Vue 前端界面                             │ │
│  │  - Dashboard 面板                                 │ │
│  │  - 数据可视化                                     │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**架构层级说明**：
- **Layer 1 (Core)**：Cecelia 的生命体，只包含内部器官
- **Layer 2 (Infrastructure)**：外部存储设备，Core 依赖但不包含
- **Layer 3 (Agent Workers)**：外部员工，Core 通过 executor.js 召唤
- **Layer 4 (Workspace)**：对外展示窗口，调用 Core API

### 2.2 LLM 使用边界

**硬规则**：L0（代码层）禁止 LLM 直接决策。所有状态推进、DB 写入、资源分配必须由确定性代码执行。

| 层 | 允许 LLM | 职责 |
|----|---------|------|
| L0 脑干 | 禁止 | 调度、执行、保护（纯代码） |
| L1 丘脑 | MiniMax M2.1 | 事件分类、快速判断（<1s） |
| L2 皮层 | Opus | 深度分析、战略调整（>5s） |

**LLM 只提建议，代码做执行**：
- L1/L2 输出 Decision JSON（actions + rationale + confidence）
- decision-executor.js 验证 action 在白名单内，然后在事务中执行
- 危险 action（如 adjust_strategy）进入 pending_actions 表等人工审批

### 2.3 Fleet Node 准入、统一 Worker、中央凭据与故障闭环（Phase 4A～4D）

- Brain 只接受 `us-mac-m4`、`xian-mac-m4`、`xian-mac-m1` 三个不可变
  `NodeProfile`，并从 system LaunchDaemon Worker 的有界 `/health` 报告重新计算
  `base_admitted`；Worker 自报的准入结论不可信。
- NodeProfile 固定 US loopback、Xian 两台各自的 Tailscale listener，以及
  Xian 指向 US Brain Tailscale health 的 callback。LaunchDaemon 固定通过
  `/var/run/docker.sock` 访问 OrbStack。
- US M4 通过 `fleet-rollout.sh` 从 committed Git、credential-free bundle 与
  pinned Runner image 构建工件；构建开始固定 commit OID，归档、bundle 与传输前
  复核必须保持同一 OID 且 worktree 干净。本地与远端 payload 均由 `sudo -n`
  解包到 root-owned mode 0700 `/var/tmp` staging，controller/nodectl 经 root
  owner、非 symlink、非 group/world writable 校验后才执行；root internal apply
  再次独立校验且不接受 nested-sudo/override。不从用户可写临时目录执行 root 脚本，
  也不复制用户目录、Codex auth、Prompt、token 或 provider session。
- baseline reconciler 固定创建 UID/GID 450 的 `_cecelia`，安装 pinned
  Node/Codex CLI 与 OrbStack 2.2.1，并把 app 内 `orbctl/docker` 固定暴露到
  Cecelia toolchain PATH，再导入 Git baseline/Runner；installer 增加
  owner-home `search` 与 exact
  `docker.sock` `read,write`；root-only WatchPaths helper 在 socket 重建后恢复
  exact ACL，不触碰 sibling sockets。本次安装新增 ACL 在失败时逆序撤销。
  新 generation 只有在 launchd 保持 running 且 profile-owned `/health` 返回
  匹配 machine identity 后才提交，否则恢复原文件与原服务状态。
- 准入是强制、fail-closed 的派发前置条件。Worker URL 缺失、重定向、超时、
  非 2xx、超限/畸形响应、identity/版本/Runner digest/资源/新鲜度不匹配、显式
  drain，均关闭节点；不得回退为仅凭 `online` 或 `effective_slots` 放行。
- production capacity 必须使用 `task_bundle.role`，先取 canonical capacity 与
  实时 effective/physical slots 的较小值，再按角色权重折算；缺失/未知角色关闭节点。
- Phase 4B 在 Phase 4A baseline 上定义 strict、path-free `WorkspaceSpec` 和
  authenticated Worker Attempt API。三台 canonical machine 均通过各自的
  server-owned Worker URL 执行；Brain 保留 machine/provider/account/model/role
  决策，Worker 从 controlled Git mirror 创建 Attempt-owned worktree 和无 hardlink
  的 private Git common-dir；容器不挂载共享 mirror，并独占 pinned
  OrbStack/Docker container、durable state、terminal cleanup、restart reconcile
  与 quarantine。Caller cwd/worktree path 不得跨过 Worker boundary。
- Worker 使用受保护文件中的节点 bearer token；该 token 只做 transport auth，
  不是 Codex/provider credential。installer 为 `_cecelia` 准备
  `/var/lib/cecelia` 下 canonical、mode 0700 data root，并拒绝 traversal 与中间
  symlink 逃逸；正常
  退出按 container（含 prompt runtime）→ worktree → state 回收。
  Legacy bridge 的 production `/harness/attempts*` 已关闭，返回
  `410 fleet_worker_required`。
- Phase 4C 由 US M4 为最终选中的 team1～team5 单账号签发
  Attempt/account/machine/deadline 绑定的 `CredentialEnvelope`。Brain 只经
  authenticated Worker API 传输；Worker 在建 workspace 前校验并一次消费，
  通过 FIFO 把 `auth.json` 写入容器 tmpfs `CODEX_HOME`（0600）。宿主状态只允许
  七项 envelope 元数据；callback 只增加 `credential_ref` 与
  `credential_copy_mutated`，不回传或回写认证材料。
- Phase 4D 由 Brain 对干净、新鲜、策略匹配的报告本地计算
  `dispatch_ready=true`；Worker 自报 readiness、slot 或 online 仍不可信，任何本地
  准入失败都会 drain 节点。same-machine resume 绑定 receipt 证明的真实机器，并为
  child Attempt 创建独立 Attempt/workspace identity；没有 provider session 时从
  DB/Git/PR 证据重新进入确定性 Kernel reconciliation。
- `harness_attempts.failure_class` 区分 `infrastructure_blocked`、
  `runner_failure` 与 `semantic_refusal`；同一任务的跨 Run 规范化产品失败集合重复时，
  L0 在创建 `generator-fix` Attempt 前转入 `wait:human_review`。
- Phase 4D 只完成代码侧执行等价与恢复闭环；Phase 5 真实业务任务验收仍未完成。
- 两阶段协议发布顺序固定为：先停止 tick 与所有 controller，并用 DB 证据确认不存在
  active Attempt；再执行 `fleet-rollout.sh all --apply --protocol-cutover`，让三台 Worker
  更新后保持 drained；随后部署新 Brain；最后由新 Brain 对每台 Worker 执行真实
  prepare → 持久化 receipt → start 两阶段协议探测；取得证据的节点才可逐机恢复
  admission。部署后的 PR #1581 真实业务验收期间 Tick 必须继续保持
  manual-disabled/off，仅启动新建 Kernel Run 的 dedicated controller；任一步缺少证据
  都保持全局停止派发。
  当前 `xian-mac-m1` 的 Docker 不可用，必须保持 drained，不能降低阈值。
- 回退同样先停止 tick 与所有 controller、全局 drain 并确认 DB 不存在 active Attempt，
  再回退 Worker/Brain 协议版本；恢复前必须用回退后的 Brain/Worker 组合重新取得真实
  两阶段协议与 Worker 健康证据，不能用 synthetic canary 替代，也不能在协议混跑窗口
  恢复 admission。

---

## 3. 三层大脑

### 3.1 L0 脑干 — 纯代码

循环每 5 秒检查一次，正式 tick 每 2 分钟执行一次 `executeTick()`：

```
executeTick() 流程：
  0.1. 评估警觉等级 → 调整行为
  0.2. 定期清理（每小时，cecelia_events/decision_log 等）
  0.3. PR Plans 完成检查（纯 SQL）
  0.4. 反串清理（清理孤儿任务引用）
  0.5. Pre-flight 检查（资源/熔断）
  0.6. Codex 免疫检查（每 20h 一次，确保 codex_qa 任务存在）
  0.7. 统一拆解检查（七层架构，decomposition-checker.js）
  0.7. Layer 2 运行健康监控（每小时一次，health-monitor.js）
  0.8. Initiative 闭环检查（initiative-closer.js，每次 tick）
       如果 initiative 下所有 task 都 completed → 关闭 initiative
  0.9. Project 闭环检查（initiative-closer.js，每次 tick）
       如果 project 下所有 initiative 都 completed → 关闭 project
  1. L1 丘脑事件处理（如有事件）
     └─ level=2 → 升级到 L2 皮层
  2. 决策引擎（对比目标进度 → 生成决策 → 执行决策）
  3. 焦点选择（selectDailyFocus）
  4. 自动超时（in_progress > 60min → failed）
  5. 存活探针（验证 in_progress 任务进程还活着）
  6. 看门狗（/proc 采样，三级响应）
  7. 规划（queued=0 且有 KR → planNextTask）
  8. OKR 自动拆解（Global OKR 有 0 个 KR → 创建拆解任务）
  9. 派发循环（填满所有可用 slot）
  10. 每日代码审查触发
  10.5. 反刍回路（空闲时消化 learnings → 洞察写入 memory_stream）
  11. 欲望系统（六层主动意识，自然消费反刍洞察）
  12. WebSocket 广播 tick:executed
```

**关键模块**：

| 文件 | 职责 |
|------|------|
| `tick.js` | 心跳循环、派发调度、焦点选择 |
| `executor.js` | 进程管理、资源检测、命令生成 |
| `planner.js` | KR 轮转、任务自动生成、PRD 生成 |
| `initiative-closer.js` | Initiative/Project 闭环检查（纯 SQL，每次 tick） |
| `health-monitor.js` | Layer 2 运行健康监控（每小时，4 项 SQL 检查） |
| `watchdog.js` | /proc 采样、动态阈值、两段式 kill |
| `alertness/index.js` | 5 级警觉、指标收集、诊断、自愈 |
| `circuit-breaker.js` | 三态熔断（CLOSED/OPEN/HALF_OPEN） |
| `quarantine.js` | 失败隔离、可疑输入检测 |
| `decision-executor.js` | 决策执行（事务化、白名单、危险审批） |

### 3.2 L1 丘脑 — MiniMax M2.1 快速判断

`thalamus.js` 处理系统事件，快速路由：

```
事件 → quickRoute()（L0 硬编码规则）
  ├─ HEARTBEAT → no_action
  ├─ TICK(无异常) → fallback_to_tick
  ├─ TICK(有异常) → null → callThalamLLM()
  ├─ TASK_COMPLETED(无问题) → dispatch_task
  ├─ TASK_COMPLETED(有问题) → null → callThalamLLM()
  ├─ TASK_FAILED(简单/重试未超限) → retry_task
  ├─ TASK_FAILED(简单/重试超限) → cancel_task
  ├─ TASK_FAILED(复杂原因) → null → callThalamLLM()
  ├─ TASK_TIMEOUT → log_event + retry_task(降级)
  ├─ TASK_CREATED → no_action
  ├─ OKR_CREATED → log_event
  ├─ OKR_PROGRESS_UPDATE(非阻塞) → log_event
  ├─ OKR_BLOCKED(普通) → notify_user + mark_task_blocked
  ├─ OKR_BLOCKED(严重/持续) → null → callThalamLLM()
  ├─ DEPARTMENT_REPORT(非严重) → log_event
  ├─ DEPARTMENT_REPORT(严重) → null → callThalamLLM()
  ├─ EXCEPTION_REPORT(低严重度) → log_event
  ├─ EXCEPTION_REPORT(中/高严重度) → null → callThalamLLM()
  ├─ RESOURCE_LOW(非严重) → notify_user
  ├─ RESOURCE_LOW(严重) → null → callThalamLLM()
  ├─ USER_COMMAND(简单) → log_event
  ├─ USER_COMMAND(复杂) → null → callThalamLLM()
  ├─ USER_MESSAGE(非紧急) → log_event
  ├─ USER_MESSAGE(紧急) → null → callThalamLLM()
  └─ 其他 → callThalamLLM()（L1 判断）
               ├─ level=0/1 → 返回决策
               └─ level=2 → 升级到皮层
```

**48 个白名单 action**：
- 任务：dispatch_task, create_task, cancel_task, retry_task, reprioritize_task, pause_task, resume_task, mark_task_blocked, quarantine_task
- OKR：create_okr, update_okr_progress, assign_to_autumnrice
- 系统：notify_user, log_event, escalate_to_brain, request_human_review
- 分析：analyze_failure, predict_progress
- 规划：create_proposal
- 知识/学习：create_learning, update_learning, trigger_rca
- 任务生命周期：update_task_prd, archive_task, defer_task
- 控制：no_action, fallback_to_tick
- 类型建议：suggest_task_type
- 对话：handle_chat
- 认知闭环：kr_replan, write_self_model, escalate_to_cortex
- 提案（Inbox）：propose_decomposition, propose_weekly_plan, propose_priority_change, propose_anomaly_action, propose_milestone_review, heartbeat_finding
- 扩展（v1.121.0）：reschedule_task, aggregate_tasks, merge_tasks, split_task, notify_oncall, adjust_resource_allocation, trigger_backup, rotate_credentials

### 3.3 L2 皮层 — Opus 深度分析

`cortex.js` 在 L1 判断 level=2 时介入：

- **根因分析 (RCA)**：分析反复失败的任务
- **战略调整**：adjust_strategy（修改 brain_config，需审批）
- **经验记录**：record_learning（存入 reflections 表）
- **RCA 报告**：create_rca_report（存入 decision_log 表）
- **创建任务**：create_task（皮层建议自动转 Brain 任务）

**皮层额外 4 个 action**：adjust_strategy、record_learning、create_rca_report、create_task

### 3.4 内容类型注册表（content-types/）

`brain/src/content-types/` 目录实现 YAML 驱动的内容类型配置层，将内容类型定义与 Pipeline 代码解耦。

**核心组件**：

| 文件 | 职责 |
|------|------|
| `content-type-registry.js` | 加载/列出/验证 YAML 配置（`getContentType()`、`listContentTypes()`、`loadAllContentTypes()`） |
| `content-type-validator.js` | 轻量格式校验器，启动时检查所有 YAML 文件（不阻断启动，WARN 级别） |
| `<type-name>.yaml` | 内容类型定义文件（如 `solo-company-case.yaml`） |

**与 Pipeline 的关系**：
- `content-pipeline-orchestrator.js` 通过 `getContentType(content_type)` 读取类型配置
- 类型配置驱动 Pipeline 各阶段的 prompt、图片参数、审查规则
- 新增内容类型只需添加 YAML 文件，无需改 Pipeline 代码

**YAML Schema 结构**：
```yaml
content_type: <类型标识符>    # 必填，须与文件名一致
images: { count, format, size }  # 必填，图片配置
template: { research_prompt, generate_prompt, review_prompt }  # 必填
review_rules: [{ id, description, severity }]  # 必填，AI 审查规则
copy_rules: { platform_tone, hashtags, min_word_count }  # 必填，文案规则
outputs: [{ type, count?, format?, platforms? }]  # 产出物定义
```

**添加新内容类型**：在 `content-types/` 目录下创建 `<type-name>.yaml`，填写上述必填字段即可。

---

## 4. 数据模型

> **两根正交的轴**：Cecelia 用两根互相独立（正交）的轴描述系统。
> - **执行轴（GTD / OKR 轴）**：`OKR → Project → Initiative → Task`，回答"为达成目标，现在派谁去做哪件事"，是**调度视图**（见 §4.1）。
> - **能力轴（能力 / 产品轴）**：`领域 → 子领域 → Golden Path(=Ability) → step → feature`，回答"这个产品由哪些能力组成、每个能力做到多熟"，是**产品视图**（见 §4.2）。
>
> 两根轴不是父子关系，也不互相包含：一个 Task（执行轴）可以推进某条 Golden Path 的某个 step（能力轴），但"能力轴层级"本身不随 OKR 拆解而生，它描述的是产品本身的结构。混淆这两根轴，正是历史上"Golden Path 分级模糊"的根因（详见 §4.2 与设计稿 `docs/superpowers/specs/2026-07-13-ability-axis-hierarchy-redefinition-design.md`，decision `13013a49`）。

### 4.1 执行轴：六层结构（OKR→Task）

```
goals (OKR 目标，3 种 type)
├── Global OKR (type='global_okr', parent_id=NULL, 季度目标)
│   └── Area OKR (type='area_okr', parent_id=Global OKR.id, 月度目标)
│       └── KR (type='kr', parent_id=Area OKR.id, Key Result)
│
projects (项目/Initiative，2 种 type)
├── Project (type='project', 1-2 周, 可跨多个 Repo)
│   └── Initiative (type='initiative', parent_id=Project.id, 1-2 小时)
│
pr_plans (工程规划)
└── PR Plan (project_id→Initiative, dod, sequence, depends_on)
│
tasks (具体任务)
└── Task (project_id→Initiative, goal_id→KR.id, pr_plan_id→PR Plan, 20 分钟)
```

**完整拆解链**（6 层）：
```
Global OKR → Area OKR → KR → Project → Initiative → Task
```

**时间维度**：

| 层级 | 时间跨度 |
|------|----------|
| Global OKR | 3 个月（季度） |
| Area OKR | 1 个月（月度） |
| Project | 1-2 周 |
| Initiative | 1-2 小时 |
| Task | 20 分钟 |

**关键关系**：
- Task.project_id → **Initiative** ID（不是 Project）
- Task.goal_id → **KR** ID（不是 Global/Area OKR）
- Task.pr_plan_id → **PR Plan** ID（可选，通过 PR Plan 创建时必填）
- Initiative→Project 通过 parent_id 找到 repo_path（`resolveRepoPath()` 向上遍历）
- project_repos 表：Project ↔ Repository 多对多关联
- project_kr_links 表：Project ↔ KR 多对多关联
- Repository = 独立概念，Project 可跨多个 Repo

### 4.2 能力轴层级（能力 / 产品轴）

> **状态：本节 §4.2.1 的 5 层定义与 §4.2.2 的 Golden Path 生命周期是 2026-07-13 主理人拍板的\*\*目标模型\*\*（decision `13013a49`），schema 归并尚未落地。凡涉及"三表合一 / L2 激活 / 挂载层级调整"处均标注\*\*现状 vs 目标\*\*，不谎报已实现。完整设计与逐条 schema 待决项见 `docs/superpowers/specs/2026-07-13-ability-axis-hierarchy-redefinition-design.md`。**

能力轴描述**产品本身的结构**（一个产品由哪些能力组成、每个能力做到多熟），与 §4.1 执行轴（OKR→Task 的调度视图）正交。

#### 4.2.1 五层定义

| 层 | 命名 | 系统落点（目标） | 例子（智能客服） |
|---|---|---|---|
| **L1** | **能力领域**（Journey） | `journeys` 表 | 智能客服、智能获客 |
| **L2** | **子领域**（Ability Group） | `journey_features.group`（现为孤儿字段，目标提升为一等维度） | 微信客户沟通、社群运营 |
| **L3** | **Golden Path = Ability = function** | `journey_features(kind='ability')` 为交付/FK 锚层；`golden_paths` 补提案态语义并以 FK 对齐（**不物理迁行**，见 §4.2.3） | 被动回复、建群 |
| **L4** | **step** | `golden_path` 表（migration 303，目标正名为 step 表） | step1 接收理解 → step2 生成回复 → step3 发送 |
| **L5** | **feature（使能件）** | `journey_features`（`kind='feature'`，经 `step_id` 挂到 L4） | 调 LLM、套知识库、敏感词过滤 |

**一条 Golden Path 的边界判据**（三问全 yes）：独立触发 + 独立交付一个客户可见结果 + 独立可验收。L2 子领域不满足"独立交付"，故它是"筐"（分类）而非"路"（能力），不立为可交付实体。

**FR / NFR / thickness 的归属**：

- **FR（功能定义）= 这个 Ability 干什么。不单独立表、不单独立层**（YAGNI）——它就是 Golden Path/Ability 记录本身的功能描述（落在 ability 记录 / PrePRD 上），steps 即其功能展开。历史上把 `golden_path`(303) 叫"FR 台账"是**错名**：那张表是 step 表，不是 FR。
- **NFR（非功能决策）= 挂在某个 step 上的决策**，不立层，复用现有 `decisions` 表：`category='nfr'`, `level='step'`, `target_type='golden_path'`, `target_id=<step id>`（例：topic=`前后台` / decision=`后台静默`）。**NFR 机制已存在，不新建。**
- **thickness / maturity（深度轴）= 这条 Golden Path 做到多熟**（thin→mature）。"打深 1-5 → 6-10" = 往该 Golden Path 的 step 清单追加 step，做完一批升一档。

**一条 Golden Path 内部的两根子轴**（这是"分级模糊"的解药，别再混为一谈）：

- **广度 / 组成** = step 清单（这条路走哪几步、每步挂哪些 feature）。
- **深度 / 成熟度** = thickness（这条路做到多熟）。

**一个 E2E**：1 条 Golden Path = 1 个端到端测试 = 这个 Ability 的验收。

#### 4.2.2 Golden Path 生命周期（不设独立"提案"实体）

**一张 Golden Path 表（= Ability）+ 一个状态字段**。"提议"只是这条 Golden Path 处在早期状态；AI（GP-loop / direction-proposer）与主理人**都能提**，主理人**批准 + 排序**。

```
AI提议 / 人提议 ──批准──▶ 未开始 ──▶ 进行中 ──▶ 已完成 ──▶ 已上线
  (source: ai / 人)     (主理人排序 priority)
```

- `source` 字段区分 AI 提 / 人提；批准 = 状态流转（提议→批准）；排序 = `priority` 字段（目标新增）。
- "加深老 GP" = 追加 step（状态回"进行中"）；"开新方向" = 新建 GP（"提议"态）。两者都能提。

#### 4.2.3 现状 vs 目标（schema 归并待落地）

以下为**目标模型**，均**待 migration**，当前 schema **尚未**如此归并：

| 待决项 | 现状 | 目标 | decision 依据 |
|---|---|---|---|
| **L3 三表理顺** | 能力散在 `journey_features(kind='ability')` / `abilities`(migration 294) / `golden_paths`(migration 334) 三处无主 | **不物理迁行**：`journey_features(kind='ability')` 保留为交付/FK 锚层（`tasks`/`advancement_items`/`initiative_runs` 3 条硬 FK + 49 处引用）；`golden_paths`(334) 只补提案态语义 + 一条 FK `delivered_ability_id → journey_features.id` 对齐；"归一"落读视图 / Notion 层。`abilities`(294) 零引用死表，单独 DROP | 13013a49（设计稿 D1，方向修正见设计稿 §8） |
| **L2 子领域激活** | `journey_features.group`(migration 295) 是孤儿字段，无代码消费、Notion 从不推送 | 提升为一等实体 / 维度，代码消费 + Notion 推送 | 13013a49（D3） |
| **golden_paths 挂载层级** | `golden_paths.journey_id` 直连 L1，跳过 L2 | 改挂 L2 子领域，L2 再挂 L1 | 13013a49（D2） |
| **`golden_path`(303) 正名 step 表** | 现被叫"FR 台账"、挂 Task（`owner_task_id`） | 正名为 step 表，产品身份挂 Golden Path；Task 仍是执行视图；支持一 step 多 feature | 13013a49（D4） |
| **状态机 + priority** | `golden_paths`(334) 有 candidate→approved→in_dev→delivered… 状态机 | 映射为用户 6 档（提议→未开始→进行中→已完成→已上线）+ 补 `已上线` 态 + `priority` 排序列 | 13013a49（D5） |

> **注意**：设计稿明确 GP-loop（`golden_paths` 自提议流水线）**不改名、不推翻**，它就是"AI 往主表提议新 GP"的自动来源。范围外（本轮不做）：不重构 GP-loop 对抗/晨报逻辑、不动 harness per-Task 验收语义。

### 4.3 核心表

| 表 | 用途 | 关键字段 |
|----|------|---------|
| **tasks** | 任务队列 | status, task_type, priority, payload, prd_content, pr_plan_id, phase(exploratory/dev) |
| **goals** | OKR 目标 | type(global_okr/area_okr/kr), parent_id, progress |
| **projects** | 项目/Initiative | type(project/initiative), repo_path, parent_id, kr_id, plan_content |
| **pr_plans** | 工程规划（PR 拆解层） | project_id→Initiative, dod, files, sequence, depends_on, complexity |
| **project_repos** | 项目↔仓库关联 | project_id, repo_path, role |
| **areas** | **PARA 领域（areas）** — GTD/PARA 分类维度，与能力轴 L1"能力领域(Journey)"是两个不同概念，勿混用（见 §4.2 术语澄清） | name, group_name |
| **project_kr_links** | 项目↔KR 关联 | project_id, kr_id |

> **注意**：`features` 表已在 Migration 027 中删除。Initiative 功能由 `projects` 表的 `parent_id` + `type='initiative'` 实现。

**能力轴相关表（现状登记，非本文档谎报已归并——目标模型见 §4.2.3）**：

| 表 | 用途 | 现状 |
|----|------|------|
| **journeys** | 能力轴 L1 能力领域 | 已存在 |
| **journey_features** | L5 feature 使能件（`kind='feature'` 经 `step_id` 挂 L4）；`kind='ability'` 行=能力轴 L3 交付/FK 锚层（保留不迁行）；`group` 字段=L2 子领域槽位（孤儿） | 已存在，字段语义待整顿 |
| **golden_path** (migration 303) | L4 step 台账（历史错名"FR 台账"），目标正名 step 表 | 已存在 |
| **golden_paths** (migration 334) | Golden Path 方向级提案实体 + 状态机，目标补提案态语义 + FK `delivered_ability_id → journey_features.id` 对齐 L3（**不作唯一主表**，L3 交付/FK 锚仍在 journey_features） | 已存在 |
| **abilities** (migration 294) | 早期能力表，零活引用死表，目标单独 DROP（非迁行、非归并） | 已存在（死表，待清） |

> ⚠️ 上表仅**登记现状**：三表归一 / L2 激活 / 正名 / 挂载调整均为**目标、待 migration**（§4.2.3），当前代码与 schema 尚未落地。`abilities` 表虽标为"待 DROP"但**尚未** DROP。

### 4.4 系统表

| 表 | 用途 |
|----|------|
| **cecelia_events** | 全局事件日志（token 使用、状态变更、学习等） |
| **decision_log** | LLM 决策记录（L1/L2 输出、执行结果） |
| **working_memory** | 短期记忆（key-value，如 last_dispatch） |
| **brain_config** | 配置（region、fingerprint） |
| **pending_actions** | 通用提案系统（含审批/提案/通知，签名去重，24-72h 过期） |
| **reflections** | 经验/问题/改进（issue/learning/improvement） |
| **daily_logs** | 每日汇总（summary、highlights、challenges） |
| **recurring_tasks** | 定时任务模板（cron 表达式, goal_id, project_id, worker_type, recurrence_type） |
| **content_type_configs** | 内容类型配置（YAML→DB 迁移，JSONB config，前端可编辑） |
| **topic_selection_log** | 每日选题去重日志（migration 203，selected_date + keyword 唯一索引，7 日避重） |
| **topic_decision_feedback** | 选题热度反馈（migration 214，week_key + topic_keyword 唯一索引，高热话题注入选题 Prompt） |
| **topic_suggestions** | 选题推荐审核队列（migration 217，pending/approved/rejected/auto_promoted，2h 自动晋级） |
| **llm_usage_snapshots** | LLM 算力消耗快照（migration 218，每日定时采集账号用量，供周报趋势分析） |
| **schema_version** | 迁移版本追踪 | Schema 版本: 379 |
| **initiative_run_events** | Harness pipeline 节点状态流（migration 279，initiative_id/node/status/attempt/ts BIGINT） |
| **harness_attempts** | Provider-neutral Harness 的逐 hop 执行账本（migration 357，TaskBundle/Result、provider session、lease/heartbeat） |
| **publish_success_daily** | 每日每平台发布成功率快照（migration 276，platform/date UNIQUE，Brain tick 写入） |
| **janitor_runs** | Janitor 任务执行记录（migration 272，job_name/status/output/duration） |
| **janitor_config** | Janitor 任务配置（migration 272，enabled/schedule/last_run） |
| **agents** | agent_ops 注册表（migration 274，agent_type/status/config/host_alias） |
| **wechat_rpa_sessions** | wechat-rpa 会话审计（migration 275，action/status/payload/error） |
| **distilled_docs** | 蒸馏文档层 Layer 2（SOUL/SELF_MODEL/USER_PROFILE/WORLD_STATE） |
| **kr_verifiers** | KR 指标自动验证（SQL 查询, threshold, current_value, 定时采集） |
| **blocks** | 通用 block 存储 |

### 4.5 任务状态

```
queued → in_progress → completed
                    → failed → (retry) → queued
                    → quarantined → (release) → queued
                                 → (cancel) → cancelled
```

### 4.6 任务类型与路由

| 类型 | 位置 | Agent | 模型 (Anthropic / MiniMax) | Provider |
|------|------|-------|------|----------|
| dev | US | Caramel (/dev) | Sonnet / M2.5-highspeed | 默认 minimax |
| review | US | 审查员 (/review) | Sonnet / M2.5-highspeed | 默认 minimax |
| qa | US | 小检 (/qa) | Sonnet / M2.5-highspeed | 默认 minimax |
| audit | US | 小审 (/audit) | Sonnet / M2.5-highspeed | 默认 minimax |
| ci_patrol | US | CI/CD 巡检 (/ci-patrol) | Sonnet / - | 默认 anthropic |
| explore | HK | 快速调研 (/explore) | - / M2.1 | 固定 minimax |
| knowledge | US | 知识记录 (/knowledge) | Sonnet / - | 默认 anthropic |
| codex_qa | 西安 | Codex 免疫检查 | Codex | 固定 openai |
| codex_dev | 西安 | Codex /dev（runner.sh + devloop-check.sh） | Codex | 固定 openai |
| crystallize | 西安 | 能力蒸馏流水线编排入口（Scope→Forge→Verify→Register） | Codex | 固定 openai |
| crystallize_scope | 西安 | crystallize 子任务：定义 DoD + 验收标准 | Codex | 固定 openai |
| crystallize_forge | 西安 | crystallize 子任务：Codex 探索写脚本（playwright-runner.sh + CDP → PC） | Codex | 固定 openai |
| crystallize_verify | 西安 | crystallize 子任务：无 LLM 验证脚本（3次） | Codex | 固定 openai |
| crystallize_register | 西安 | crystallize 子任务：注册到 SKILL.md + 部署 | Codex | 固定 openai |
| codex_test_gen | 西安 | 自动生成测试（扫描覆盖率低模块 + 生成测试） | Codex | 固定 openai |
| decomp_review | HK | Vivian (拆解审查) | - / M2.5-highspeed | 固定 minimax |
| initiative_plan | US | Initiative 规划 | Opus / - | 默认 anthropic |
| initiative_verify | US | Initiative 验收 (/arch-review verify) | Sonnet / - | 默认 anthropic |
| scope_plan | US | Scope 内规划下一个 Initiative (/decomp Phase 3) | Opus / - | 默认 anthropic |
| project_plan | US | Project 内规划下一个 Scope (/decomp Phase 4) | Opus / - | 默认 anthropic |
| pipeline_rescue | US | Pipeline 救援 — 卡住的 pipeline 接管修复 (/dev) | Opus / - | 默认 anthropic |
| platform_scraper | CN | 平台数据采集（CDP 浏览器 + 各平台登录态） | - | - |
| suggestion_plan | US | Suggestion 层级识别 | Sonnet / - | 默认 anthropic |
| talk | HK | MiniMax | - / M2.5-highspeed | 固定 minimax |
| research | HK | MiniMax | - / M2.5-highspeed | 固定 minimax |
| data | HK | N8N | - | - |
| dept_heartbeat | US | 部门主管 (repo-lead) | - / M2.5-highspeed | 固定 minimax |
| pr_review | 西安 | 异步 PR 审查（独立 MiniMax 审查） | Codex / MiniMax | 固定 minimax |
| intent_expand | US | 意图扩展 Expander（沿 project→KR→OKR→Vision 链补全 PRD） | Sonnet / - | 默认 anthropic |
| initiative_execute | US | Initiative 执行 (/dev 全流程) | Sonnet / - | 默认 anthropic |
| code_review | US | 代码审查 (/code-review) | Sonnet / - | 默认 anthropic |
| architecture_design | US | 架构设计 (/architect design) | Opus / - | 默认 anthropic |
| architecture_scan | US | 系统扫描 (/architect scan) | Opus / - | 默认 anthropic |
| arch_review | US | 架构巡检 (/arch-review review) | Sonnet / - | 默认 anthropic |
| strategy_session | US | 战略会议 (/strategy-session) | Opus / - | 默认 anthropic |
| prd_review | US | PRD 审查 (/prd-review) | 本机 Codex | 固定 openai |
| spec_review | US | Spec 审查 (/spec-review) | 本机 Codex | 固定 openai |
| code_review_gate | US | 代码质量门禁 (/code-review-gate) | 本机 Codex | 固定 openai |
| initiative_review | US | Initiative 整体审查 (/initiative-review) | 本机 Codex | 固定 openai |
| okr_initiative_plan | 西安 | OKR Scope 下规划下一个 Initiative (/decomp) | - | general |
| okr_scope_plan | 西安 | OKR Project 下规划下一个 Scope (/decomp) | - | general |
| okr_project_plan | 西安 | OKR Project 层完成后规划下一步 (/decomp) | - | general |
| sprint_generate | US | Harness Generator — 写 sprint contract + 代码 (/dev) | Sonnet / - | 默认 anthropic |
| sprint_evaluate | US | Harness Evaluator — 测运行中的代码 (/sprint-evaluator) | Sonnet / - | 默认 anthropic |
| sprint_fix | US | Harness Generator 修复轮次 (/dev) | Sonnet / - | 默认 anthropic |
| sprint_planner | US | Harness Planner — 拆分 Sprint 任务计划 | Sonnet / - | 默认 anthropic |
| sprint_contract_propose | US | Harness Contract 提案 — 生成 sprint-contract.md | Sonnet / - | 默认 anthropic |
| sprint_contract_review | US | Harness Contract 审查 — 验证 sprint-contract.md | Sonnet / - | 默认 anthropic |
| sprint_report | US | Harness Reporter — 生成 Sprint 最终报告 (/sprint-report) | Sonnet / - | 默认 anthropic |
| harness_planner | US | Harness v4.0 Planner — 拆分 Harness 任务计划 | Sonnet / - | 默认 anthropic |
| harness_contract_propose | US | Harness v4.0 Contract 提案 — 生成 harness-contract.md | Sonnet / - | 默认 anthropic |
| harness_contract_review | US | Harness v4.0 Contract 审查 — 验证 harness-contract.md | Sonnet / - | 默认 anthropic |
| harness_generate | US | Harness v4.0 Generator — 写代码 (/dev) | Sonnet / - | 默认 anthropic |
| harness_evaluate | US | Harness v4.0 Evaluator — 独立广谱验证 (/sprint-evaluator) | Sonnet / - | 默认 anthropic |
| harness_fix | US | Harness v4.0 Generator 修复轮次 (/dev) | Sonnet / - | 默认 anthropic |
| harness_ci_watch | US | Harness v4.0 CI 监控 — 等待 CI 结果 | Sonnet / - | 默认 anthropic |
| harness_deploy_watch | US | Harness v4.0 Deploy 监控 — 等待部署结果 | Sonnet / - | 默认 anthropic |
| harness_report | US | Harness v4.0 Reporter — 生成最终报告 (/sprint-report) | Sonnet / - | 默认 anthropic |
| harness_initiative | US | Harness v2 阶段 A — Initiative 规划 + DAG 调度入口 (/harness-planner) | Sonnet / - | 默认 anthropic |
| golden_path_proposal | US | GP loop — AI 自提 Golden Path 提案（圈选后走 relay 跑 /golden-path-controller，同 harness_initiative 路径） | Sonnet / - | 默认 anthropic |
| harness_task | US | Harness v2 阶段 B — Task 级执行（内部 Generator/CI/Evaluator 状态机） | Sonnet / - | 默认 anthropic |
| harness_final_e2e | US | Harness v2 阶段 C — Initiative 级真实 E2E 验收 | Sonnet / - | 默认 anthropic |
| harness_intervention | US | Harness 巡逻干预任务（卡住检测 + 自动重置） | - | /_internal |
| staging_e2e | US | Harness staging E2E native 执行（部署 :5222/5223 + contract E2E + promote 分流） | - | /_internal |
| strategist_decision | US | Line 军师决策（task 落终态后按 line 派发，line-strategist-loop 独立巡航接入） | - | /line-strategist |
| ci_patrol | US | CI/CD 巡检员（每日按 line 巡检 CI/CD 健康度 + guard 棘轮） | - | /ci-patrol |
| content-pipeline | 西安 | 内容工厂 Pipeline 编排入口 (/content-creator) | - | general |
| content-research | 西安 | 内容调研阶段 (/notebooklm) | - | general |
| content-copywriting | 西安 | 文案生成阶段 (/content-creator) | - | general |
| content-copy-review | 西安 | 文案审核阶段 (/content-creator) | - | general |
| content-generate | 西安 | 图片生成阶段 (/content-creator) | - | general |
| content-image-review | 西安 | 图片审核阶段 (/content-creator) | - | general |
| content-export | 西安 | 内容导出阶段，生成卡片并上传 NAS (/content-creator) | - | general |
| content_publish | US | 内容发布阶段，按平台路由到对应 publisher skill（douyin/kuaishou 等需要 CDP 浏览器） | Sonnet / - | 默认 anthropic |
| platform_scraper | CN | 自媒体平台数据采集（抖音/小红书/视频号/公众号/快手/知乎，CDP 浏览器） | Sonnet / - | 默认 anthropic |

---

### 4.7 Provider-neutral Harness Kernel（灰度）

`harness_initiative` / `golden_path_proposal` 可在任务 payload 显式设置
`harness_runtime: "kernel-v1"`，进入确定性 Harness Kernel；缺省仍走原
`harness-controller`，作为一键回滚路径。Kernel 使用统一 TaskBundle/HarnessResult
契约和仓库内冻结 Skill，将 Claude Code、Codex、Grok 视为可替换执行器；
`executor: "auto"` 只选择满足能力的 provider，不固定 model。只有 payload
显式提供 `model` 时才向 CLI 传模型参数。

角色级 `role_assignments.<role> = {provider, account}` 允许 generator 与 evaluator
使用不同厂商/账户；分配只影响 dispatcher/launcher，不进入纯函数 derive 或门禁。

对抗验收不会因 provider 统一而取消：proposer、reviewer、generator、evaluator
使用独立 attempt/session，judge 走独立证据门；同一 provider session 不能跨 role
或跨 attempt 复用。Attempt 通过 lease + heartbeat 防止跨设备/进程重复执行；
看门狗仅在同一 attempt 有 session 时原位 resume，否则从 Git/PR/DB 真相重新推导
下一 hop。运行手册见 `packages/brain/src/orchestrator/README.md`。

---

## 5. 任务生命周期

### 5.1 从 OKR 到任务（四层拆解）

```
Global OKR (目标)
  │
  ├─ 有 0 个 KR？ → 自动创建拆解任务 → 秋米 /okr → 生成 KR
  │
  └─ KR (关键结果)
       │
       ├─ selectDailyFocus() → 选择今日焦点 Global OKR
       │
       ├─ 秋米 /okr 拆解:
       │   └─ KR → Sub-Project (projects.parent_id) → PR Plans → Tasks
       │
       ├─ planNextTask(krIds) → KR 轮转评分
       │   ├─ 焦点 KR +100
       │   ├─ 优先级 P0/P1/P2 → +30/+20/+10
       │   ├─ 进度差距 → +0~20
       │   └─ 截止日期紧迫 → +20~40
       │
       └─ autoGenerateTask() → 生成任务
           ├─ 重试失败任务（retry_count < 2）
           ├─ 匹配 KR_STRATEGIES（7 种策略模式）
           └─ Fallback：research → implement → test
```

**PR Plans 层的作用**：
- 将 Sub-Project 拆解为具体的 PR，每个 PR Plan 对应 1 个 Task
- 支持依赖关系（depends_on）和执行顺序（sequence）
- 包含 DoD（完成定义）和预计修改文件列表，帮助 Agent 估算范围

### 5.2 派发流程

```
dispatchNextTask():
  1. checkServerResources() → CPU/内存/SWAP 压力
  2. 检查并发（active < AUTO_DISPATCH_MAX）
  3. 检查熔断（circuit-breaker isAllowed）
  4. selectNextDispatchableTask() → 选下一个任务
     └─ WHERE status='queued'
        AND (next_run_at IS NULL OR next_run_at <= NOW())
  5. UPDATE status='in_progress'
  6. triggerCeceliaRun(task)
     ├─ preparePrompt() → 生成 skill + 参数
     ├─ getModelForTask() → 选模型
     ├─ resolveRepoPath() → Sub-Project→Project→repo_path
     └─ HTTP → cecelia-bridge → cecelia-run → claude
  7. WebSocket 广播事件
  8. 记录到 working_memory
```

### 5.3 执行回调

```
任务完成 → POST /api/brain/execution-callback
  ├─ status=completed → 更新任务状态、清理进程
  ├─ status=failed → handleTaskFailure()
  │   ├─ failure_count < 3 → 标记失败
  │   ├─ failure_count >= 3 → 自动隔离
  │   └─ 检测系统性故障 → alertness +25
  └─ payload.exploratory=true？
      └─ 创建"继续拆解"任务 → 秋米继续
```

### 5.4 探索式拆解闭环

```
KR → 首次拆解 (decomposition='true', /okr, Opus)
  └─ 秋米分析 → 创建 Sub-Project + PR Plans + 第一个 Task
       └─ Task 完成 → 回调触发"继续拆解"
            └─ (decomposition='continue', /okr, Opus)
                 └─ 秋米分析上次结果 → 创建下一个 Task
                      └─ 循环直到 KR 目标达成
```

---

## 6. 保护系统

### 6.1 警觉等级（alertness/index.js）

5 级自我保护，基于实时指标自动诊断和响应：

| 级别 | 名称 | 派发率 | 行为 |
|------|------|--------|------|
| 0 | SLEEPING | 0% | 休眠，无任务 |
| 1 | CALM | 100% | 正常运行 |
| 2 | AWARE | 70% | 轻微异常，加强监控 |
| 3 | ALERT | 30% | 明显异常，停止规划 |
| 4 | PANIC | 0% | 严重异常，只保留心跳 |

**功能模块**：
- `metrics.js`：实时指标收集（内存、CPU、队列深度等）
- `diagnosis.js`：异常模式诊断（内存泄漏、队列阻塞等）
- `escalation.js`：分级响应和升级
- `healing.js`：自愈恢复策略

**状态转换规则**：
- 降级冷却 60 秒（防震荡）
- PANIC 锁定 30 分钟
- 渐进式恢复（只能逐级降低）
- 紧急升级可直接跳到 PANIC

### 6.2 熔断器（circuit-breaker.js）

Per-service 三态熔断：

```
CLOSED ──(3次失败)──► OPEN ──(30分钟)──► HALF_OPEN
   ▲                                        │
   └────────(成功)──────────────────────────┘
                     (失败) → 回到 OPEN
```

### 6.3 隔离区（quarantine.js）

| 隔离原因 | 条件 |
|---------|------|
| repeated_failure | 连续失败 ≥3 次 |
| suspicious_input | 检测到危险模式（rm -rf、DROP TABLE 等） |
| resource_hog | 看门狗连续 kill ≥2 次 |
| timeout_pattern | 连续超时 ≥2 次 |
| manual | 人工隔离 |

**审查操作**：release（释放）、retry_once（试一次）、cancel（取消）、modify（修改后释放）

**故障分类**：classifyFailure() 区分 SYSTEMIC（系统性，23 种模式）vs TASK_SPECIFIC（任务自身），系统性故障触发 alertness 信号。

### 6.4 看门狗（watchdog.js）

每 5s 通过 /proc 采样，动态阈值保护：

**阈值（动态计算）**：

| 参数 | 公式 | 16GB 机器 |
|------|------|-----------|
| RSS 硬杀线 | min(总内存×35%, 2400MB) | 2400MB |
| RSS 警告线 | 硬杀线×75% | 1800MB |
| CPU 持续阈值 | 95%（单核=100%） | 95% |
| CPU 持续时长 | 6 个 tick（30s） | 30s |
| 启动宽限期 | 60s | 60s |

**三级响应**：

| 系统压力 | 行为 |
|---------|------|
| < 0.7（正常） | RSS 超警告线 → 仅警告 |
| 0.7~1.0（紧张） | RSS 超警告 + CPU 持续高 → kill |
| ≥ 1.0（崩溃） | 只杀 RSS 最大的 1 个，下个 tick 再评估 |
| 任何时候 | RSS 超硬杀线 → 无条件 kill（即使宽限期） |

**两段式 kill**：SIGTERM → 等 10s → SIGKILL → 等 2s 确认死透

**自动重排**：kill 后 requeue + 指数退避（2min, 4min），2 次 kill → 隔离

---

## 7. 并发与资源管理

### 7.1 自动计算

```javascript
CPU_CORES = os.cpus().length
TOTAL_MEM_MB = os.totalmem() / 1024 / 1024
MEM_PER_TASK = 400MB
CPU_PER_TASK = 0.5 core
INTERACTIVE_RESERVE = 2 seats  // 留给有头会话

// Layer 1: 物理上限（MAX_PHYSICAL_CAP=20 兜底）
PHYSICAL_CAPACITY = min(floor(min(USABLE_MEM / 400, USABLE_CPU / 0.5)), MAX_PHYSICAL_CAP=20)

// Layer 2: 硬上限（CECELIA_MAX_SEATS env var，防止物理上限失控飙升）
EFFECTIVE_MAX_SEATS = min(CECELIA_MAX_SEATS, PHYSICAL_CAPACITY)  // 当前 10

// Layer 3: 运营上限（CECELIA_BUDGET_SLOTS env var，日常派发上限）
// 优先级：CECELIA_BUDGET_SLOTS > CECELIA_MAX_SEATS（作为 fallback）
OPERATIONAL_CAP = CECELIA_BUDGET_SLOTS  // 当前 7，控制日常并发
AUTO_DISPATCH_MAX = OPERATIONAL_CAP - INTERACTIVE_RESERVE  // 当前 5
```

**10 核 16GB（美国 Mac mini M4）**：PHYSICAL_CAPACITY=16（被 Layer 2 压到 10）, CECELIA_MAX_SEATS=10（硬上限）, CECELIA_BUDGET_SLOTS=7（运营上限）, AUTO_DISPATCH=5

**环境变量配置**（`packages/brain/.env` + `docker-compose.yml` 双写）：
```
CECELIA_MAX_SEATS=10    # 硬天花板，防止动态值飙升
CECELIA_BUDGET_SLOTS=7  # 运营上限，预留 2 个 interactive 席位
```

### 7.2 动态限流

`checkServerResources()` 实时计算压力值（0.0~1.0+）：

| 压力 | 有效 Slots |
|------|-----------|
| < 0.5 | 满额（10） |
| 0.5~0.7 | 2/3（7） |
| 0.7~0.9 | 1/3（3） |
| ≥ 0.9 | 1 |
| ≥ 1.0 | 0（停止派发） |

### 7.3 进程跟踪

- `activeProcesses Map<taskId, {pid, startedAt, runId}>`
- 存活探针：每个 tick 检查 in_progress 任务的进程是否还在
- 桥接任务（pid=null）：通过 `ps aux` 搜索 task_id
- 孤儿清理：启动时同步 DB 状态与实际进程

---

## 8. 部署架构

### 8.1 双服务器

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  🇺🇸 美国 VPS (研发+执行)     │     │  🇭🇰 香港 VPS (生产)          │
│  146.190.52.84              │     │  124.156.138.116              │
│                             │     │                             │
│  Docker 容器：              │◄───►│  Docker 容器：              │
│  ├ cecelia-node-brain:5221  │Tail-│  ├ PostgreSQL:5432          │
│  ├ PostgreSQL:5432          │scale│  ├ 生产前端:5211            │
│  ├ 开发前端:5212            │     │  └ MiniMax executor         │
│  └ Claude Code (headed)     │     │                             │
│                             │     │  任务类型：                 │
│  任务类型：                 │     │  talk, research, explore,   │
│  dev, review, qa, audit,    │     │  data                       │
│  code_review, knowledge     │     │                             │
│  ENV_REGION=us              │     │  ENV_REGION=hk              │
└─────────────────────────────┘     └─────────────────────────────┘
```

### 8.2 容器化

**Brain 容器**：
- 镜像：`cecelia-brain:1.52.5`（多阶段构建）
- 基础：node:20-alpine + tini
- 用户：非 root `cecelia` 用户
- 文件系统：read-only rootfs（生产模式）
- 健康检查：`curl -f http://localhost:5221/api/brain/health`

### 8.3 构建与部署

```bash
# 构建
bash scripts/brain-build.sh          # → cecelia-brain:<version>

# 部署（完整流程）
bash scripts/brain-deploy.sh          # build → migrate → selfcheck → test → tag → start
# 自动回滚：健康检查失败 → 回滚到上一版本

# 手动部署（跳过测试）
docker compose up -d cecelia-node-brain
```

### 8.4 启动检查（selfcheck.js）

6 项检查，任一失败 → process.exit(1)：

1. **ENV_REGION** — 必须是 'us' 或 'hk'
2. **DB 连接** — SELECT 1 AS ok
3. **区域匹配** — brain_config.region = ENV_REGION
4. **核心表存在** — tasks, goals, projects, working_memory, cecelia_events, decision_log, daily_logs, pr_plans, cortex_analyses

5. **Schema 版本** — DB 版本 >= EXPECTED_SCHEMA_VERSION（selfcheck.js 常量，当前 '379'；>= 检查，向前兼容）

6. **配置指纹** — SHA-256(host:port:db:region) 一致性

### 8.5 数据库配置

**单一来源**：`brain/src/db-config.js`

```javascript
DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '',
}
```

所有 DB 连接（db.js、migrate.js、selfcheck.js、测试）统一导入此配置。

---

## 9. API 接口

Brain 服务运行在 `localhost:5221`，所有端点前缀 `/api/brain/`。

### 9.1 状态监控

| 端点 | 方法 | 用途 |
|------|------|------|
| `/status` | GET | 决策数据包（给 LLM 用） |
| `/status/full` | GET | 完整系统状态 |
| `/health` | GET | 健康检查 |
| `/hardening/status` | GET | 硬化状态（CI 用） |
| `/executor/status` | GET | 执行器进程状态 |
| `/watchdog` | GET | 看门狗实时 RSS/CPU |
| `/token-usage` | GET | LLM Token 消耗统计 |
| `/memory` | GET | 工作记忆 |

### 9.2 Tick 循环

| 端点 | 方法 | 用途 |
|------|------|------|
| `/tick/status` | GET | Tick 状态 |
| `/tick` | POST | 手动触发 tick |
| `/tick/enable` | POST | 启用自动 tick |
| `/tick/disable` | POST | 禁用自动 tick |

### 9.3 任务管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/tasks` | GET | 查询任务（支持 status/type 过滤） |
| `/action/create-task` | POST | 创建任务 |
| `/action/update-task` | POST | 更新任务 |
| `/action/batch-update-tasks` | POST | 批量更新 |
| `/task-types` | GET | 有效任务类型 |
| `/route-task` | POST | 任务路由（US/HK） |
| `/execution-callback` | POST | 执行完成回调 |
| `/heartbeat` | POST | 任务心跳 |

### 9.4 OKR 目标

| 端点 | 方法 | 用途 |
|------|------|------|
| `/action/create-goal` | POST | 创建目标 |
| `/action/update-goal` | POST | 更新目标 |
| `/goal/compare` | POST | 对比目标进度 |
| `/okr/statuses` | GET | OKR 状态枚举 |

### 9.5 PR Plans 管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/pr-plans` | POST | 创建 PR Plan |
| `/pr-plans` | GET | 查询 PR Plans（支持 project_id/status 过滤） |
| `/pr-plans/:id` | GET | PR Plan 详情 |
| `/pr-plans/:id` | PATCH | 更新 PR Plan |
| `/pr-plans/:id` | DELETE | 删除 PR Plan |

> **注意**：旧的 `/features` 系列端点仍在代码中但已废弃（`features` 表已在 Migration 027 中删除）。

### 9.5a Capabilities 能力管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/capabilities` | GET | 列出所有能力（支持 current_stage/owner 过滤） |
| `/capabilities/:id` | GET | 单个能力详情 |
| `/capabilities` | POST | 创建新能力（从 capability_proposal 审批后） |
| `/capabilities/:id` | PATCH | 更新能力（stage 推进 + evidence） |

> **说明**：Capability-Driven Development Framework (Migration 030)，能力注册表 + 成熟度追踪（Stage 1-4）。

### 9.6 焦点系统

| 端点 | 方法 | 用途 |
|------|------|------|
| `/focus` | GET | 获取每日焦点 |
| `/focus/set` | POST | 手动设定焦点 |
| `/focus/clear` | POST | 清除手动焦点 |

### 9.7 保护系统

| 端点 | 方法 | 用途 |
|------|------|------|
| `/alertness` | GET | 警觉等级 |
| `/alertness/evaluate` | POST | 重新评估 |
| `/alertness/override` | POST | 手动覆盖 |
| `/alertness/clear-override` | POST | 清除覆盖 |
| `/quarantine` | GET | 隔离区任务 |
| `/quarantine/stats` | GET | 隔离统计 |
| `/quarantine/:taskId` | POST | 手动隔离 |
| `/quarantine/:taskId/release` | POST | 释放任务 |
| `/circuit-breaker` | GET | 熔断器状态 |
| `/circuit-breaker/:key/reset` | POST | 重置熔断器 |
| `/pending-actions` | GET | 提案/审批列表（按优先级+时间排序） |
| `/pending-actions/:id/approve` | POST | 批准 |
| `/pending-actions/:id/reject` | POST | 拒绝 |
| `/pending-actions/:id/comment` | POST | 追加评论（对话） |
| `/pending-actions/:id/select` | POST | 选择选项并执行 |

### 9.8 规划与决策

| 端点 | 方法 | 用途 |
|------|------|------|
| `/plan/next` | POST | 规划下一个任务 |
| `/plan/status` | GET | 规划状态 |
| `/decide` | POST | 生成决策 |
| `/decisions` | GET | 决策历史 |
| `/intent/parse` | POST | 意图识别 |

### 9.9 每日对齐

| 端点 | 方法 | 用途 |
|------|------|------|
| `/nightly/status` | GET | 每晚对齐状态 |
| `/nightly/trigger` | POST | 手动触发 |
| `/nightly/enable` | POST | 启用 |
| `/daily-reports` | GET | 每日报告列表 |
| `/daily-reports/:date` | GET | 指定日期报告 |

---

## 10. 文件地图

### 10.1 Brain 核心

```
brain/
├── server.js                  # 入口：迁移 → 自检 → 启动
├── Dockerfile                 # 多阶段构建, tini, non-root
├── package.json               # 版本号（当前 1.52.1）
│
├── src/
│   ├── db-config.js           # DB 连接配置（唯一来源）
│   ├── db.js                  # PostgreSQL Pool 单例
│   ├── migrate.js             # 迁移运行器
│   ├── selfcheck.js           # 6 项启动检查
│   │
│   ├── tick.js                # ❤️ 心跳循环 + 派发调度
│   ├── executor.js            # 进程管理 + 资源检测
│   ├── planner.js             # KR 轮转 + 任务生成
│   ├── focus.js               # 每日焦点选择
│   │
│   ├── thalamus.js            # L1 丘脑 (MiniMax M2.1)
│   ├── cortex.js              # L2 皮层 (Opus)
│   ├── decision-executor.js   # 决策执行器
│   │
│   ├── rumination.js           # 反刍回路（空闲时消化知识）
│   ├── notebook-adapter.js    # NotebookLM CLI 适配器
│   │
│   ├── watchdog.js            # 资源看门狗 (/proc)
│   ├── alertness/index.js     # 5 级警觉
│   ├── circuit-breaker.js     # 三态熔断
│   ├── quarantine.js          # 隔离区
│   │
│   ├── routes.js              # ~100 个 API 端点
│   ├── task-router.js         # 任务类型 + 区域路由
│   ├── intent.js              # 意图识别
│   ├── templates.js           # PRD/TRD 模板
│   ├── notifier.js            # 通知
│   ├── websocket.js           # WebSocket 推送
│   │
│   ├── content-pipeline-orchestrator.js  # 内容工厂 Pipeline 编排器
│   └── content-types/         # 内容类型注册表（YAML 驱动）
│       ├── content-type-registry.js   # 加载/列出/验证 YAML 配置
│       ├── content-type-validator.js  # 轻量格式校验（启动时 WARN）
│       └── <type-name>.yaml           # 内容类型定义文件（如 solo-company-case.yaml）
│
├── migrations/                # SQL 迁移 (000-035)
│   ├── 000_base_schema.sql
│   ├── ...
│   ├── 027_align_project_feature_model.sql  # 删除 features 表
│   ├── ...
│   ├── 034_cleanup_orphan_tables_and_constraints.sql
│   └── 035_final_cleanup_orphans_and_types.sql
│
└── src/__tests__/             # Vitest 测试
```

### 10.2 基础设施

```
scripts/
├── brain-build.sh             # Docker 构建
├── brain-deploy.sh            # 构建→迁移→自检→测试→部署
└── brain-rollback.sh          # 回滚到上一版本

docker-compose.yml             # 生产模式（不挂载源码）
docker-compose.dev.yml         # 开发模式（挂载 brain/ 热重载）
.env.docker                    # 环境变量
.brain-versions                # 版本历史
```

### 10.3 外部依赖

```
/home/xx/bin/cecelia-run       # 任务执行器（setsid + slot 管理）
/home/xx/bin/cecelia-bridge.js # HTTP→cecelia-run 桥接
```

---

## 11. 运维手册

### 11.1 日常检查

```bash
# 系统状态
curl -s localhost:5221/api/brain/status/full | jq '.tick, .alertness, .circuit_breaker'

# 任务队列
curl -s localhost:5221/api/brain/tasks?status=queued | jq '.[].title'

# 看门狗
curl -s localhost:5221/api/brain/watchdog | jq

# 隔离区
curl -s localhost:5221/api/brain/quarantine | jq '.[].title'

# 容器健康
docker ps --filter name=cecelia-node-brain
```

### 11.2 常见操作

```bash
# 手动触发 tick
curl -X POST localhost:5221/api/brain/tick

# 手动设定焦点
curl -X POST localhost:5221/api/brain/focus/set \
  -H 'Content-Type: application/json' \
  -d '{"goal_id": "<objective-uuid>"}'

# 释放隔离任务
curl -X POST localhost:5221/api/brain/quarantine/<taskId>/release \
  -H 'Content-Type: application/json' \
  -d '{"action": "release"}'

# 重置熔断器
curl -X POST localhost:5221/api/brain/circuit-breaker/cecelia-run/reset

# 手动覆盖警觉等级
curl -X POST localhost:5221/api/brain/alertness/override \
  -H 'Content-Type: application/json' \
  -d '{"level": 0, "duration_minutes": 60}'
```

### 11.3 部署新版本

```bash
# 1. 在 cp-* 分支开发，通过 PR 合并到 develop
# 2. 构建 + 部署
bash scripts/brain-build.sh
bash scripts/brain-deploy.sh

# 3. 如果健康检查失败，自动回滚
# 手动回滚：
bash scripts/brain-rollback.sh
```

### 11.4 故障排查

| 症状 | 检查 | 处理 |
|------|------|------|
| 不派发任务 | alertness/circuit-breaker | 检查是否 PANIC/OPEN |
| 任务卡 in_progress | executor/status | 检查进程是否存活 |
| 内存高 | watchdog | 看门狗自动处理 |
| DB 连接失败 | selfcheck 日志 | 检查 PostgreSQL 状态 |
| LLM 错误多 | token-usage | 检查 API Key / 网络 |

### 11.5 GoldenPath 验证

```bash
# 启动 → 健康 → 状态 → tick → tick 状态
bash brain/scripts/goldenpath-check.sh
```

---

## 附录：Token 成本

| 模型 | 输入 | 输出 | 用途 |
|------|------|------|------|
| Opus | $15/M | $75/M | L2 皮层（RCA 分析） |
| Sonnet | $3/M | $15/M | Claude Code 默认（Anthropic provider） |
| Haiku | $1/M | $5/M | 嘴巴（轻认知，保留） |
| MiniMax M2.5-hs | $0.30/M | $2.40/M | dev/review/qa/audit/talk（MiniMax provider） |
| MiniMax M2.1 | $0.15/M | $1.20/M | L1 丘脑（事件路由）、exploratory |

每次 L1/L2 调用记录 token 使用到 cecelia_events 表。

---

## 附录：三段常驻环境模型（Sprint 07131922）

Cecelia 运行三个独立 Brain 实例，常驻于宿主机。

| 环境 | 端口 | DB | restart 策略 | tick |
|------|------|----|--------------|------|
| Production | 5221 | cecelia | unless-stopped | 默认启用；当前 two-phase rollout 与 PR #1581 真实验收期间 manual-disabled/off |
| Staging | 5222 | cecelia_staging | unless-stopped | HARD_OFF（双保险）|
| Develop | 5220 | cecelia_dev | unless-stopped | 默认关 |

### Develop 环境

- **用途**：PR 前本地验证，开发者日常测试
- **端口**：5220（Brain）
- **DB**：cecelia_dev（独立 postgres 数据库）
- **部署**：`bash scripts/dev-deploy.sh`（含 pg_dump 备份 + migrate 幂等）
- **验证**：`bash scripts/dev-verify.sh`
- **健康监控**：`scripts/dev-healthcheck.sh`（每 5 分钟轮询 5220，宕机 10 分钟后向 5221 创建 alert 任务）
- **CI 自动部署**：develop 分支 push 触发 `.github/workflows/auto-dev-deploy.yml`

### ZenithJoy 联动占位

- Cecelia develop 环境与 ZenithJoy develop 环境（`ZJ_DEV_PORT=5230`，待 ZJ 侧确认）配合
- `staging-e2e-runner.js` 导出 `ZJ_DEV_PORT` 常量（默认 5230，可通过环境变量覆盖）
- 本 Sprint 不修改任何 ZenithJoy 仓库文件，联动在后续 Sprint 实施
