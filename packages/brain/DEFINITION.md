# Brain 模块定义

**版本**: 1.267.101

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
