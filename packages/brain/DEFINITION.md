# Brain 模块定义

**版本**: 1.267.155

## Kernel real-business workspace convergence

- `WorkspaceSpec` 只接受两个 Brain-owned repository identity：Cecelia 与
  ZenithJoy workspace。解析新 writer SHA 时先核对当前受控 worktree 的
  `origin`，禁止请求仓库与实际 checkout 不一致。
- Fleet Worker 用同一显式 allowlist 创建 per-Attempt mirror/worktree；
  ZenithJoy 默认 source 是公开 HTTPS GitHub URL，可由独立环境变量受控覆盖。
- Runner 从冻结 TaskBundle 恢复原 task ID、角色 branch/SHA/sprint 参数；
  planner 由确定性 finalizer 提交并推送 PRD，callback 只有在 Brain 对远端
  branch HEAD 做服务端核验后才投影 `prdExists`。Proposer 从该 SHA 创建新分支。
- US M4 为 planner/proposer/generator/evaluator 签发 Attempt-bound GitHub
  CredentialEnvelope；Worker 用一次消费 marker、FIFO 和容器 tmpfs 注入，
  持久状态仅保留 ref/timestamp/hash，不保留 token 或 base64 payload。Runner
  用父进程内存里的初始 token 洗敏全部 provider stdout/result，任务改写
  `hosts.yml` 也不能绕过；evaluator 同时以 Git 环境配置硬阻断 origin push。
- Workspace Manager 对已验证 writer branch 使用隔离 clone 内的 `switch -C`
  锚到 exact SHA，修复 evaluator/generator-fix 的 existing-ref checkout 冲突。
- `buildRealDeps()` 一取得 pool 就向顶层登记；`runKernelMain()` 捕获其后的
  初始化、观测或派发层未处理 fatal 后，通过
  `finalizeKernelRun()` 精确双写 run/task 终态并关闭 active Attempt；原始 fatal
  仍以非零退出暴露，终态落库失败另行 loud log。
- 回退到 Brain `1.267.154` 前必须停止新的 ZenithJoy Kernel Attempt，并清点
  active workspace/credential envelope；旧版本会 fail-closed 为
  `workspace_repo_not_supported`，也无法恢复新的 Git artifact handoff。

## Fleet Worker preflight startup convergence

- `install-fleet-worker.sh` 仅对 `prerequisite_orbstack` 执行最多 10 次、
  每次 1 秒的有限重试，覆盖 OrbStack 刚从 stopped 切到 running 时
  `_cecelia` 探针短暂不可见的生产竞态。
- Docker/container 等聚合 prerequisite 与其他确定性失败不重试并立即
  fail-closed；次数限制为 1–60，间隔只接受 0–60 的整数秒，避免错误配置
  导致近似无界等待或命令注入。
- 回退到 Brain `1.267.153` 会恢复单次探针，可能再次把刚启动的健康 OrbStack
  误判为 `prerequisite_orbstack` 并让 rollout 保持 drain。

## Manual tick disable survives deploy restart

- `initTickLoop()` 现在与 tick watchdog 使用同一关闭来源语义：
  `source=manual` 是持久人工停机，部署或进程重启不得按关闭时长自动恢复；
  生产 compose 默认的 `CECELIA_TICK_ENABLED=true` 也不能覆盖该人工意图。
  `tryRecoverTickLoop()` 后台恢复路径使用相同判定，确认 manual 后清理 recovery
  timer，避免每五分钟重复尝试。
- `drain`、`alertness` 与未知来源仍保留 `TICK_AUTO_RECOVER_MINUTES` 超时恢复，
  防止临时保护状态永久冻结调度。
- 回退到 Brain `1.267.152` 会恢复旧的 startup auto-recover 行为；需要回退时，
  必须先以 `CECELIA_TICK_HARD_OFF=1` 硬关或在重启后重新调用 tick disable。

## Kernel reconcile precision and acknowledged exceptions

- Trust reconcile 在事务复核 collision evidence 时，以精确 `run_id` 在
  PostgreSQL 内读取原始 `completed_at`；禁止把微秒时间戳经 JavaScript `Date`
  往返后再比较，避免合法历史计划被误判为乐观锁冲突。逐行锁定后还会在数据库内
  复核 v2/terminal/completed/non-trusted/pre-cutover 全部 eligibility；任一漂移
  都作为 optimistic conflict 回滚，不能把失去资格的行标成 reconstructed。
- Terminal mismatch 生产 apply 现在同时绑定 plan SHA、repair 数、blocked 数和
  database name。精确确认 blocked 集合后，只提交彼此独立的 repair；每条 blocked
  finding 以 `blocked_acknowledged` 写入只读审计，绝不覆盖既有人工终态。
- Migration 379 把 active v2 run 的父任务非终态约束下沉到数据库 INSERT trigger。
  trigger 先取得既有 initiative advisory locks，再以 `FOR UPDATE` 锁父 task；
  等待中的 legacy writer 在父任务终态提交后以 `23514` 失败，不能重开 active run。
- 回退到 Brain `1.267.151` 时保留所有 JSONL 审计和已完成的安全 repair；不得用
  旧脚本重跑含微秒的 trust 计划，也不得为通过 reconcile 强改冲突终态；Migration
  379 属于前向安全约束，应用回退时保留。

## Kernel terminal-attempt convergence

- Attempt 创建先以精确 `run_id` 对非终态 v2 run 取得 key-share lock；终态或缺失
  的父 run 一律拒绝。并发 winner 重读也受同一 active-run 栅栏约束，不能在 run
  终态化之后补生 attempt。
- `finalizeKernelRun` 与 canonical exact terminal PATCH 统一按
  `task → run → attempt id` 加锁，并在 run/task 同一事务中把
  `queued/starting/running` attempt 关闭为 `cancelled`、清除租约、记录
  `parent_run_terminal`；回执包含实际关闭数量。callback 与 finalize 竞态只允许
  callback 先终态或 finalize 先取消两种串行结果，不残留 active attempt。
- `kernel-stale-attempt-reconcile.mjs` 只提案“精确终态 v2 父 run + 已过期/空租约”
  的 active attempt。默认 dry-run；生产 apply 绑定数据库、候选数、计划 SHA、
  session advisory lock，并逐条按 `task → run → attempt` 重锁证据。证据漂移不写，
  成功后精确回读并写入独占、fsync、只读 JSONL 审计；二次 dry-run 必须为 0。
- 回退应用到 Brain `1.267.150` 时保留历史审计与 attempt lifecycle 数据；不得恢复
  允许终态 run 新建 attempt 或 run/task 终态与 attempt 分裂提交的路径。

## Kernel asynchronous callback convergence

- Dispatcher 在 launch receipt 持久化后返回 `LAUNCHED`；Loop 只追加
  `effect:attempt_launched` 并重新观测，不再把容器启动误投影成角色完成。
- Worker callback 必须匹配 `run_id + attempt_id + lease_owner +
  lease_generation`；本地 runner 与远程 bridge 都转发完整租约代次，迟到代次在任何
  业务写入前返回 409。
- Attempt 终态与 `verdict:attempt_callback` 在一个 PostgreSQL 事务提交；相同 payload
  重试幂等确认，冲突 payload、旧 owner/代次均不能污染 attempt 或决策账本。
- `needs_context`、基础设施阻塞、语义拒绝、runner failure 与取消分别路由；
  只有结构化 `infrastructure_blocked` 可换执行目标，同一 `unknown_no_pr` 第二次
  出现即原子终结 run/task，不产生第三个 attempt。
- `needs_context` 原子写入版本化 `effect:context_requested` 并暂停；人工答案必须
  通过审批权认证且绑定 `run/task/request hop/callback hop/context version`。答案与
  恢复意图同事务提交，旧答案不能消费新请求；run 保持 `paused`，watchdog 先用
  唯一 `context-resume:<token>` 的 host/pid/heartbeat CAS 领取；新 Controller
  必须用该 token 自己原子写入真实 pid/host/heartbeat 并发布最新 request 的原 phase，
  成功前不得进入 collect/derive/dispatch。Watchdog 不让未过期的恢复 lease 占用
  候选窗口；detached child 仅在真实 `spawn` receipt 后返回，异步 spawn 错误会回滚
  到安全的 paused 状态并保留 5 分钟失败冷却 lease，避免固定窗口重试风暴，且不得
  成为 Brain 未处理异常。
  恢复 Attempt 的 TaskBundle 显式携带版本化答案。
- Generator 的 PR claim 只有同时匹配 Brain 签发的 `workspace_spec.repo/branch` 且由
  GitHub 返回完整 head SHA 才能投影为权威 `pr_url`；legacy attempt 才回退 task
  short-id。generator-fix 复用当前服务端观测到的 PR branch/head，不另开分支。
  原始 callback 以服务端 digest 幂等，终态重放不再查询 GitHub 或重放可变投影，
  冲突 payload 继续 fail closed。
- Migration 378 将 `needs_context` 加入 Attempt failure-class CHECK；回退应用到
  `1.267.147` 时保留该兼容性 schema，不恢复异步 callback 的 split-write 路径。
- 人工 context 列表的数据库读取按来源地址限制为每分钟 60 次；答案与审批写操作
  继续使用每分钟 10 次的独立限额，防止轮询挤占审批动作或形成无界数据库读取。

## Kernel exact run API and trust accounting

- canonical GET/PATCH 只接受完整 `run_id`，initiative 历史按
  `started_at DESC, id DESC` 确定排序；legacy initiative PATCH 在候选不是恰好一条时
  fail closed，并记录 `legacy_relay_mutation` 事件。
- watchdog 的 run/task 终态收口统一走 exact run store 的同一事务；
  selector、attempt cap 与父任务定位都使用 `current_task_id`，缺身份 fail closed。
- Migration 376 增加 `trusted/reconstructed/untrusted` 可信度与 predecessor lineage；
  canonical 新 run 显式标 `trusted`，历史默认保持 `untrusted`。
- Migration 377 在数据库 BEFORE INSERT trigger 中强制同一 initiative/prefix 的事务锁，
  覆盖所有直接 INSERT writer，legacy 唯一候选解析期间不得插入第二条 run。
- `kernel-run-trust-reconcile.mjs` 默认只输出确定性 JSONL 提案；仅同时提供
  `--apply --audit-output <绝对路径> --expected-plan-sha256 <SHA256>
  --expected-proposed <N> --confirm-database <DB>` 才可写入；生产 apply 由 migration
  376 切点、数据库名、候选数、计划摘要、单实例 advisory lock 和乐观并发共同约束。
  生产 apply 每个事务只处理一条 proposal，并按 `Migration 377 advisory key →
  task → id 排序的 initiative runs → attempts` 锁定；分类证据变化即冲突回滚，
  与 canonical terminal writer 保持相同 task→run 次序，不形成反向锁死。
  审计文件独占创建、逐批 fsync 真实 applied/unchanged/conflict 结果并封成只读；
  二次 dry-run 必须报告 `would_change=0`。不得猜测身份或改写原生 trusted run。
- `kernel-terminal-mismatch-reconcile.mjs` 只修复终态 v2 run 与非终态父 task 的
  确定性不一致；混合 run 结果和已终态 task 冲突一律阻断。生产 apply 同样绑定
  数据库、候选数、计划摘要和单实例锁，并以原 task status 作并发栅栏；每条修复后
  必须重新读取精确 run/task，验证一致后审计才标记 `commit_state=verified`。
  同 task 存在 active sibling 时 dry-run 不提案，apply 在 task 行锁内再次检查并拒绝，
  防止旧终态 run 终结正在执行的新 run；orphan-guard 的生产 helper 使用同一栅栏，
  覆盖 liveness probe 后 recovery run 新建的竞态窗口。
- summary 保留全量 phase 账面数，同时拆分 trust 分母；SLO 成功率只统计原生
  `trusted` 且每个任务最新的终态 run，活跃 run 不稀释成功率。
- 回退：部署 Brain `1.267.149`，保留 Migration 376/378 加法字段；legacy adapter
  仍须保持 fail closed，禁止恢复 initiative-wide mutation。

## Kernel run identity and atomic terminalization

- 每条新 v2 run 都必须绑定 `current_task_id` 并记录 `created_source`；
  PostgreSQL 拒绝缺身份的新写入，run store 拒绝 task→initiative 归属不一致。
- 同一个 task 最多只能拥有一条非终态 v2 run。
- create/finalize 统一按 task→run 加锁；Kernel run 的完成/失败与父 task 终态化
  在同一事务提交并记录唯一终态事件，executor 不得 task-only 覆盖。
- `harness_initiative` 与 `golden_path_proposal` 的 Kernel orphan reconciliation
  都不会复活或重新排队 Kernel task：死亡 run 原子失败，已终态 run 精确对账，
  无法证明的历史 NULL 身份保持 untouched/untrusted。
- Fleet synthetic canary 走 schema 合法的 v1 lane，并以
  `orchestrator_host=kernel-fleet-canary` 标识，不作为真实业务 v2 run 或真实
  业务 Canary 验收。
- 回退保持 Migration 375 的加法 schema，应用恢复到上一 Brain image；不得恢复任何
  initiative-wide run mutation，也不得猜测补写历史身份。

## Same-FD pinned toolchain snapshot

- Attestation 只接受 command policy 签发的 command；clone/自冻对象失败关闭。
- canonical tool 以 no-follow 打开，并在同一 FD 上有界哈希及复核 identity。

## Pinned toolchain attestation policy

- `gp-assertion-toolchain.js` 消费 Phase 4A NodeProfile/admission 提供的 expected 与
  actual Runner digest；缺失、格式非法或不一致时不允许盖章。
- 执行前后对 canonical toolchain paths 逐文件 SHA-256，漂移失败关闭；输出仅
  含路径与 digest，不含文件内容，也不接 Runner/receipt。

## Pinned assertion command policy

- `gp-assertion-command.js` 仅接受固定 Vitest、Pytest 与 bash 形态；absolute
  pinned toolchain 与 canonical target 一致，且 target 为精确 tracked 普通文件。
- command/argv/toolchain 与无继承 env 均冻结；不执行 Runner、不写 receipt，
  不接 API/UI。

## Trusted assertion process adapter

- `gp-assertion-process.js` 只消费调用方显式注入的 trusted spawn adapter；
  缺失 adapter 时在启动前 fail closed，不提供 Brain 本机 spawn 默认值。
- 子进程环境只允许 `PATH/LANG/LC_ALL/TMPDIR/TZ`；超时对独立进程组依次
  TERM/KILL，整树清理失败及 signal 退出均成为失败证据。
- 本层不选择命令、不写 receipt、不接 API/UI。

## GP assertion output evidence utility

- `gp-assertion-output.js` 提供 UTF-8 字节安全尾部、凭据遮蔽与真实场景证据
  规范化；不可解码字节严格 fail closed，不拼接出新的凭据或测试语义。
- 本层只提供纯 output/evidence 工具，不执行断言、不写 receipt、不接 API/UI。

## Golden Path §④-1 receipt evidence schema (stack 2)

- Migration 374 可重跑持久化 append-only 受信执行与场景证据，selfcheck 地板
  升到 374；不完整 PASS 不验证。本层不含 Runner、route 或 UI。

## Golden Path §④-1 receipt-state pure model

- `deriveAssertionVerification` 是无副作用的 receipt 状态派生模型：只消费调用方
  提供的断言格与 receipt 历史，按当前 `assertion_revision` 过滤，并稳定选出
  最新失败或最新通过；无当前 revision receipt 时返回 `never_run`。PASS 必须
  带完整执行身份、source/output 摘要、零退出码、非 synthetic 时间戳及场景
  证据；缺任一项都按未执行处理。
- 本层尚不执行断言、不访问或持久化 receipt、不包含 migration、API 或 Runner；
  `verified=true` 只表示输入历史中的当前断言通过，不构成生产“盖章”声明。
- §④ 其余机制与产权变更 B 均未启用。回退：部署 Brain `1.267.138`。

## Golden Path §③ ledger data knife

- Migration 373 对现有 `journey_step_links` 格子做证据诚实回填：底座引用继承
  已批准的真实 feature 锚点，历史决策说明规范为 `decision:`，GP-B 使用既有
  Path 4 业务 smoke；仍无可辩护证据的 green/pending 格 fail closed 为 red。
- 产品 NFR 用 `target_type='journey_step'` 精确归到业务步骤并继承
  `journeys.home`；不伪装成 feature，也不复用旧 Harness `golden_path` 行。
- 产品 `/journey_steps/:step_id/ledger` 直接读取 `journey_step_links` 四区，
  不再把 Brain 内部 `brain_modules` 健康账本字段套到 `journey_features`；
  `/features/ledger` 继续只表示 Brain 内部模块健康。
- readiness gate 要求正向格都有合法锚点、NFR 都有步骤决策、base_ref 不悬空、
  assertion_ref 无自由文本；真实环境 smoke 同时验证数据库和 HTTP 读面。
- 本版本仍不含 §④ 的断言盖章、裁决记账、退役、事故对照或打回率；产权变更 B
  继续 `effective_now=false`。
- 回退：部署 Brain `1.267.133`；Migration 373 的 NFR 决策和诚实红格保留为
  审计数据，旧 Brain 不消费 `journey_step` target。

## Versioned Golden Path contract Gate

- Migration 372 保存严格 7 项 GP 合同的 append-only 版本、规范 SHA-256、
  Owner 签字和 pending-action/decision 审计关联；签字精确绑定
  `contract_id/version/hash`。
- 相同最新内容幂等；任一内容变化自动使旧签字失效并要求重签。运行中的
  Harness task 必须先 drain，尚未执行的旧任务在同一事务中取消。
- Owner 批准签字待办后，judgment、合同 `signed`、唯一 Harness task 和 GP
  `approved` 原子提交；任务 payload 绑定 `gp_contract_id/version/hash`。
- 兼容 `/approve` 不再签字或创建任务，只允许读回最新已签合同的既有任务；
  未签、旧版本或签字/任务漂移均 fail closed。
- 四个 Golden Path Skill 快照锁定
  `zenithjoy-skills#172@d19924f31`，mapper 进入同步清单。
- §③ 与 §④ 不在本版本；断言盖章未上线前，产权变更 B 继续保持
  `effective_now=false`。
- 回退：暂停 GP 签字并 drain/cancel 相关任务，部署 Brain `1.267.132`；
  Migration 372 与审计记录保留，旧 Brain 禁止继续走 GP approve。

## Finalized Golden Path governance decisions

- Migration 370 把 Owner 定版的两条封版判据、拒绝话术、产权变更 B、高风险
  清单、向上默认分类和让路顺序写入 `decisions`，以稳定 `source_ref` 和
  `context.policy_key/policy_version` 供后续合同 Gate 读取。
- `decisions.level` 新增 `global`；Harness line context 一次读取 global 与 area
  invariant，并按 step、journey_feature、global、area 的优先级去重注入。
- 本版本只完成治理 SSOT 与继承入口，不启用产权变更，不包含 GP 合同签字、
  断言盖章或其他 PRD ④机制。
- 回退：部署 Brain `1.267.130`。Migration 370 的 policy rows 可保留为审计记录；
  旧 Brain 不读取 `level='global'`。

## Provider-neutral attempt timeout terminal

- Brain 在 credential/network side effect 前验证
  `TaskBundle.constraints.timeout_seconds`，并把同一值传入 Worker 与 Runner。
- Worker fail closed 拒绝无效 timeout；Runner 对 Codex、Claude、Grok 使用统一的
  TERM/KILL 超时边界，超时产生静态 `provider_timeout` 终态且不包含 provider
  stdout 或 secret。
- Kernel 将结构化 `provider_timeout` 归类为 infrastructure failure，保留既有
  receipt、attestation 与 Commander failover 边界。
- 三机固定 Runner：
  `sha256:21b29766c7c5676f28a1f1c328eebde88e1952fd29cb9dc433874bfff0a1a05d`。
  该 artifact 以已部署的
  `sha256:5a4c1918bd30d44ddddd29da6970a85eb49c8394ec3c734d50d3d6e1b6b807e7`
  为只读基线，仅叠加本版本审阅后的 Runner entrypoint。
- 回退：节点 drain 后恢复上一 Runner digest，并部署 Brain `1.267.126`。

## Writable ephemeral Codex credential tmpfs

- Docker adapter 为 `/home/cecelia/.codex` 的每 Attempt tmpfs 固定为 pinned
  Runner 用户 `uid=999,gid=999,mode=0700`，允许其接收 FIFO 中的一次性
  CredentialEnvelope，并继续拒绝其他 host/container 用户访问。
- Credential payload 经 `docker exec -i` stdin 在 Runner 内部写 FIFO，不再
  依赖 macOS host 与 OrbStack VM 之间的 FIFO 握手，也不进入 argv/env/log。
- `noexec,nosuid,nodev`、terminal cleanup、host credential isolation 与
  Xian 无长期凭据合同保持不变。
- 回退：部署 Brain `1.267.125`。

## OrbStack-safe Fleet attempt mounts

- 生产 runtime 仅把 worktree/runtime 放入 OrbStack 可挂载的共享根；mirror、
  Attempt state、quarantine 与 CredentialEnvelope consumption marker 仍位于
  `_cecelia` 受保护 data root。
- Docker adapter 解析真实 host 路径，直接使用本机 pinned `sha256:` image ID，
  并对单次 workspace、Git admin 与 runtime 精确授予 OrbStack owner ACL。
- ACL 遍历显式跳过 symlink；`.admin` 父目录仅开放 traversal。container
  destination、ownership、read-only 与短期凭据合同保持不变。
- 回退：部署 Brain `1.267.124`。

## Server-seeded Fleet mirror reuse

- Fleet Worker 在准备 workspace 前验证 server-owned mirror 已包含请求的
  `base_sha` 与 `expected_head_sha`；完整时直接复用，不依赖节点访问 GitHub。
- 任一目标 commit 缺失时仍执行既有 fetch，并继续以精确 SHA fail closed。
- 回退：部署 Brain `1.267.123`。

## Unified Fleet Worker production transport wiring

- 生产 Compose 显式启用 Phase 4B 的统一 Fleet Worker transport，并向 Brain
  注入三机共用的 bearer token 与 US Tailscale callback base URL。
- token 缺失或长度不足时仍由 production transport fail closed；配置不向
  Xian 复制任何长期 Codex 凭据，也不改变 Phase 4C/4D/5 合同。
- 回退：恢复 `docker-compose.yml` 的上一版本并部署 Brain `1.267.122`。

## OrbStack-shareable Worker TMPDIR bootstrap

- system Worker 安装器在启动 LaunchDaemon 前创建固定
  `/Users/Shared/cecelia-fleet-tmp`，设置 `_cecelia:_cecelia`、0755，
  使健康探针的临时 worktree 能被 OrbStack bind mount。
- 目录目标必须是节点根下的精确固定路径，符号链接和任意 override 均
  fail closed；不改变 Runner digest、admission 阈值或凭据边界。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.121`。

## Clean-node nodectl pinned Node resolution

- `fleet-nodectl` 在执行 admission evaluator 时优先使用 Fleet baseline
  安装的 pinned Node toolchain；只有固定工具链不存在时才回退交互式 PATH。
- 显式测试/运维 override 仍具有最高优先级；该修正不改变 admission
  判定、不放宽健康合同，也不引入长期凭据。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.120`。

## Clean-node OrbStack Docker socket link

- reconciler 在 OrbStack 首次启动并确认用户 socket 类型为 Unix socket 后，
  幂等创建 `/var/run/docker.sock` 到 rollout owner socket 的精确符号链接，
  使干净节点不依赖 GUI 初始化。
- 已存在的非链接路径或不同链接目标一律 fail closed；不覆盖路径、不放宽
  ACL、不引入凭据。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.119`。

## Clean-node Codex runtime PATH propagation

- reconciler 在检查 pinned Codex CLI 版本时，同样把 pinned Node toolchain
  目录前置到该短生命周期子进程的 PATH，覆盖首次安装后的检查和后续幂等
  检查。
- 不修改 Worker 的长期环境，不引入 HOME，不复制凭据；检查失败继续保持
  节点 drain。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.118`。

## Clean-node Codex bootstrap PATH propagation

- reconciler 安装 pinned Codex CLI 时，仅为 npm 子进程把刚安装的 pinned
  Node toolchain 目录前置到 PATH，支持没有任何全局 Node 的干净 Fleet
  节点。
- 不修改 Worker 或 Codex 的长期环境，不引入 HOME，不复制凭据；失败继续
  保持节点 drain。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.117`。

## Fleet Worker preflight OrbStack home propagation

- installer 的低权限生产 preflight 显式把 reconciler 提供的 OrbStack home
  作为 `CECELIA_ORBSTACK_HOME` 传给 node probe，确保写入 LaunchDaemon 前的
  同一 pinned-version 检查不再因 `_cecelia` 默认 `/var/empty` 误报。
- 该值仍仅由 node probe 用于 `orbctl` 子进程；不传给 Codex/Docker，不复制
  凭据，失败继续恢复 drain。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.116`。

## Fleet Worker production admission stabilization

- system LaunchDaemon 显式记录 OrbStack owner 的 home，仅对 `orbctl`
  子进程设置 HOME，使 `_cecelia` 通过已授权的 OrbStack 路径读取 pinned
  版本；不向 Codex、Docker 或整个 Worker 环境暴露该 HOME，也不复制长期凭据。
- GUI Tailscale CLI 拒绝 system service 用户时，以节点精确的 100.64/10
  listener 地址和成功的 Brain callback 双证据判定连接，任一缺失继续
  fail closed。
- 瞬态失败 health 只短缓存，并在 rollout admission 做 3 次有界重试；最终
  失败仍恢复 drain。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.115`。

## Fleet admission evaluator artifact hotfix

- rollout source archive 补齐 `fleet-nodectl admit` 在节点本地直接加载的
  `node-admission.js`，并由 artifact 合同测试锁定，避免 undrain 后出现
  `ERR_MODULE_NOT_FOUND`。
- 不改变 admission 阈值、Runner pin、凭据或 Phase 4B/4C/4D/5 范围；失败
  继续恢复 drain。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.114`。

## Fleet Worker credential module install hotfix

- system LaunchDaemon installer 将 Worker 已依赖的 `credential-envelope.cjs`
  纳入 generation staging、placement、snapshot 和 rollback 事务，避免正式启动
  出现 `MODULE_NOT_FOUND`。
- 模块以 `0644` 安装，不保存 credential 内容；失败继续完整回滚并保持节点
  drain，Runner pin 与 Phase 4B/4C/4D/5 范围不变。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.113`。

## Fleet rollout bundle HEAD contract hotfix

- rollout 产物仓库将 `HEAD` 指向冻结的 `fleet-rollout` ref，并从 `HEAD`
  创建 Git bundle，使节点 baseline 的既有 `fetch ... HEAD` 契约得到同一
  rollout commit。
- bundle 仍只包含冻结提交；不改变 Runner pin、Worker token、admission 或
  Phase 4B/4C/4D/5 范围，失败继续保持节点 drain。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.112`。

## Fleet disposable bind-mount traversal hotfix

- node probe 在随机临时根目录创建后显式设置 `0755`，允许宿主用户域的
  OrbStack daemon 遍历 `_cecelia` 的 disposable worktree 路径；容器挂载仍为
  readonly，结束时仍清理容器、worktree 和临时根目录。
- 不放宽 repository、凭据或 Docker socket 权限；失败继续保持节点 drain，
  Phase 4B/4C/4D/5 范围不变。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.111`。

## Fleet canonical repository safe-path hotfix

- baseline 先用 `realpath` 规范化 NodeProfile 的受控 bare repository，再把
  规范路径作为进程级 `safe.directory`，兼容 macOS `/var` 指向
  `/private/var` 的系统路径布局。
- 不写入系统/用户 Git 配置；失败继续保持节点 drain，Runner pin、
  Provider 凭据和 Phase 4B/4C/4D/5 范围不变。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.110`。

## Fleet repeat-bootstrap repository ownership hotfix

- baseline 的受控 bare repository Git 操作显式限定 `safe.directory` 为
  NodeProfile repository 路径，允许 root reconcile 重复处理已归属
  `_cecelia` 的仓库，同时不写入或放宽系统/用户级 Git 配置。
- 失败继续保持节点 drain；Runner pin、Provider 凭据和
  Phase 4B/4C/4D/5 范围不变。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.109`。

## Fleet OrbStack service-user path ACL hotfix

- installer 在低权限 node probe 前，为 OrbStack owner home、`.orbstack` 和
  `.orbstack/run` 授予 `_cecelia` 最小 search ACL，再授予 socket
  read/write ACL，避免 `orbctl` 因路径不可遍历而误报 unavailable。
- 安装失败按反向顺序撤销且仅撤销本次新增 ACL；Worker 继续使用
  `_cecelia` system LaunchDaemon，不依赖 GUI LaunchAgent。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.108`。

## Fleet OrbStack user-domain startup hotfix

- baseline 现在通过原始 rollout 管理用户的 launchd 域执行 OrbStack
  `start`、`status` 和升级前 `stop`，不再从 root 域调用用户态 VM。
- 30 秒有界状态核对、失败 drain 和回滚语义保持不变；Fleet Worker 仍是
  `_cecelia` system LaunchDaemon，不依赖 GUI LaunchAgent。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.107`。

## Fleet OrbStack eventual-start hotfix

- baseline 现在把 `orb start` 视为启动请求，并在 30 秒有界窗口内通过
  `orb status` 确认最终状态；OrbStack 异步完成 VM handoff 时不再误回滚。
- 确认窗口耗尽仍返回 `orbstack_start_failed`、保持节点 drain；不改变 Runner
  pin、NodeProfile、Provider 凭据或 Phase 4B/4C/4D/5 语义。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.106`。

## Fleet rollout root-staging executable hotfix

- root-owned `0700` rollout staging 不再由 SSH 普通用户预展开 `*.sh`；脚本权限
  现在由非交互 sudo 下的固定 `/usr/bin/find` 在已校验 staging 子树内设置。
- 该修复只恢复 Phase 4A 既有 drain/bootstrap/admission 生产入口，不改变
  NodeProfile、Runner digest、Provider 凭据或 Phase 4B/4C/4D/5 语义。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.105`。

## Fleet Node macOS admission policy correction

- macOS `15.6.1` 是当前最低支持版本；同一 macOS 15 major 的更高 release/patch
  可以准入，低于 floor、malformed 或未经验证的其他 major 继续 fail closed。
- `15.7.4` 保留为 baseline reconciler 的推荐安全维护目标；`15.6.1` 节点只记录
  非阻塞升级建议，不再仅因补丁号不同而 drain。
- Runner digest、OrbStack/Docker、Worker LaunchDaemon、NodeProfile capacity 和
  Phase 4A 其他合同不变；Phase 4B/4C/4D 与 Phase 5 均未扩展。
- 回退：节点保持 drain，Brain 使用
  `bash scripts/brain-rollback.sh 1.267.104`。

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
