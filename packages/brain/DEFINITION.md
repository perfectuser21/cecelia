# Brain 模块定义

**版本**: 1.272.5

## Unified Map API and dashboard authority

- 五个 Map 读面与健康度共享一致性快照、统一 envelope 和查询时状态，不再消费旧 `src/map` 实现。
- Dashboard 的唯一 `/map` 注册展示三层业务地图、事实锚点与 revision-bound receipt。
- Schema 地板保持 407；回退到 `1.272.4` 会恢复分裂的 Map 读面和重复页面注册。

## Universal Map exact anchors and query-time state

- 显式 scope/repo/ledger adapter 替代同名推断，Feature/Artifact/Assertion 以稳定键进入 active projection。
- snapshot freshness、当前 revision receipt 与目标存在性在查询时现算五态；旧账本颜色不参与权威判断。
- repo 隔离 reverse graph radius 返回受影响业务节点、必跑断言与 Cross-cut 扩展。
- Schema 地板为 406；回退到 `1.271.7` 会失去锚点投影、现算状态与通用影响半径。

## Kernel preflight BLOCKED launch truth

- `generatorSpawned` 只由严格绑定 intent+Attempt 的 launch effect，或 Callback result、provider
  session、heartbeat、runtime provider failure 等正证据推导；裸 Attempt 与 pre-launch failure
  不算启动，真实 Callback 即使缺 launch effect 也能跨崩溃恢复。
- Provider 配额或 Fleet admission 在 launch 前 BLOCKED 时，下一轮继续原 Generator 路径；
  不会把“没有创建 Attempt、所以没有 PR”误判为产品 no-PR 并进入 generator-fix。
- Brain 版本为 `1.267.202`；Fleet Worker 和 Runner digest 不变。回退到 `1.267.201`
  会恢复 infrastructure BLOCKED 后的 `generator_fix_workspace_evidence_missing` 致命路径。

## Kernel Fleet prepare budget and recovery env integrity

- Fleet Worker 的重型 `prepare`（workspace、PostgreSQL、stopped Runner）使用独立、可配置的
  180 秒控制面预算；`start/inspect/cancel/terminal` 继续保持 60 秒，避免放大普通故障等待。
- launchd keepalive 重建生产 Brain 时显式加载 `.env.docker`，不会再把 Fleet shared secret
  以 compose 默认空值覆盖；secret 缺失仍由 transport fail closed。
- Brain 版本为 `1.267.201`，Fleet Worker 与 pinned Runner digest 不变。回退到
  `1.267.200` 会恢复 60 秒误杀真实 prepare 和 keepalive 恢复后 Fleet transport 失效。

## Kernel context resume action identity

- `verdict:context_answer` 现在按绑定的 callback hop 找到原始 needs-context Attempt，再回放
  该 Attempt 之前的精确 spawn action；初始 Generator 与 Generator-fix 不再互相漂移。
- 只允许已知 agent spawn action 进入恢复映射；答案之后已经存在重试 intent 时不再回放，
  保持 append-only、一次性消费和防双派发语义。
- Brain 版本为 `1.267.200`；Fleet Worker 保持 `1.267.100`，共享验证时钟与 Runner digest
  均不变。回退到 `1.267.199` 会恢复初始 Generator context 恢复后误进 fix 的失败路径。

## Kernel shared validation clock

- Controller 在首个 Generator intent 创建唯一验证时钟，并通过 append-only decision log、
  TaskBundle 和 Runner 环境把同一 `pipeline_started_at` / `deadline_at` 原样传给 Generator、
  Evaluator 与 Judge；角色切换、重试和恢复均不得重置 7200 秒窗口。
- 对升级前已启动的 run，从首个持久化 Generator intent 的 `created_at` 确定性恢复时钟；
  下游角色缺失、格式错误或窗口不等于 TaskBundle timeout 时 fail closed。
- Brain 版本为 `1.267.199`，Fleet Worker 三机基线为 `1.267.100`，Runner digest 保持
  `sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a`。
- 回退到 Brain `1.267.198` / Worker `1.267.99` 会恢复角色各自缺失验证时钟的问题；
  回退前保持 Kernel run 与 Fleet 节点 drained。

## Kernel late-bound validation identity

- GAN 合同把当前 Planner/Proposer/Reviewer task bundle 视为 authoring provenance，不再把
  它们的 attempt/account/capability snapshot 固化成未来验收身份。
- 合同批准落库前的确定性 identity gate 会拒绝 attempt/snapshot UUID 字面值，并写入
  锚定同一 contract SHA 的 REVISION；下一轮 Proposer 收到具体 late-bound 修复方向。
- Fleet Worker `1.267.99` 注入当前执行角色的 provider/account/machine/model、capability
  snapshot 与 pinned Runner digest，供 E2E 证据按实际 Attempt 生成。
- Brain 版本为 `1.267.198`，Runner digest 保持
  `sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a`。
- 回退到 Brain `1.267.197` / Worker `1.267.98` 会恢复角色身份追逐和 attestation 缺字段；
  回退前保持 Kernel run 与 Fleet 节点 drained。

## Kernel frozen-contract repository root

- 生产 Brain 的 `buildRealDeps` 现在把部署注入的 `REPO_ROOT` 显式传给冻结 Git 产物读取器；
  容器 cwd 为扁平 `/app` 时，不再把已经批准的跨仓库 PRD、contract draft 和 DoD 误判为缺失。
- 精确批准 SHA、workspace repository allow-list、只读 fetch 与 fail-closed 语义保持不变；
  新回归测试覆盖“镜像 cwd 非 Git 仓库、bind-mounted `REPO_ROOT` 是有效仓库”的生产拓扑。
- 回退到 Brain `1.267.196` 会恢复 `approved_but_contract_artifacts_missing`，使真实 Kernel run
  在 GAN 批准后、Generator 启动前错误终止。

## Kernel r11 control-plane convergence

- GAN 的 `noPushStreak` 与 `noVerdictStreak` 只消费具备
  `spawn intent -> effect:attempt_launched -> identity-bound terminal callback`
  完整证据链的 Attempt；admission-blocked、未启动与未 callback 的 intent 不再冒充
  产品无进展并提前杀死 run。
- 生产 preflight 拆分预算：Brain snapshot/provider HTTP 保持 5 秒，Fleet Worker
  admission 使用 20 秒，外层 capability probe 使用 25 秒；具体、限长的 admission
  reason 随脱敏 evidence 留痕，仍然 fail closed。
- Reviewer/Evaluator/Judge/Reporter 的结构化结果写入既有 per-Attempt runtime mount，
  Runner evidence bridge 使用注入的 `BRAIN_RESULT_FILE`；工作树权限不放宽，task/attempt
  身份不匹配的证据继续拒收。
- Brain 版本为 `1.267.196`，Fleet Worker 为 `1.267.98`，三机 pinned Runner 为
  `sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a`。
- 回退到 Brain `1.267.195`、Worker `1.267.97` 与 Runner
  `sha256:eb4928940827d5c50a86676022309a34a4012d51f17ddd0f951a5b5c8f644009`
  会恢复 r11 的假 streak、5/6 秒冷 admission 误拒和只读结果丢失；回退前保持节点 drained。

## Kernel frozen guard process-scoped hook injection

- 冻结基线的可写 Fleet role 不再向挂载 worktree 的共享 Git admin config 写入
  `core.hooksPath`；Runner 在 Provider 进程边界追加 `GIT_CONFIG_COUNT` 配置，使所有
  Provider 子进程使用同一个 pre-push hook，同时保留既有 process config。
- Runner 在模型启动前校验有效 hook path；Git admin config 不可写时仍可武装，格式错误
  或有效值不一致仍 fail closed。只读 role 与 Provider 退出后的血统断言不变。
- 三机 pinned Runner 基线同步为
  `sha256:eb4928940827d5c50a86676022309a34a4012d51f17ddd0f951a5b5c8f644009`。
- 回退到 `1.267.194` 会让可读 worktree + 不可写 Git admin config 的可写冻结 role 再次在
  Provider 启动前报 `frozen_baseline_guard_unavailable`；回退前保持节点 drained。

## Kernel Fleet remote prepare control-plane budget

- 生产 Fleet transport 对 Worker `prepare/start/inspect/cancel/terminal` 的 HTTP 控制面请求
  使用 60 秒上限，覆盖已预热 mirror 的 per-Attempt workspace clone 与最多 15 秒的冷
  container create；Attempt 自身的 7200 秒业务预算与模型执行超时不变。
- `remote-bridge-transport` 的通用 10 秒默认值继续保留，只有生产组装显式使用 60 秒；
  测试注入的短超时与 fail-closed 语义不变。
- 回退到 Brain `1.267.193` 会恢复 10 秒生产请求预算，并可能把健康的 warm prepare 误判为
  `remote_bridge_prepare_timeout`；回退前保持 Fleet 节点 drained。

## Fleet disposable-container timeout budget

- Fleet Worker `1.267.97` 保留三次 exact-name 清理重试，并只把 disposable Runner
  container 的 `docker create/start` 单次预算从通用 5 秒提升到 15 秒；其余探针命令
  继续使用 5 秒 fail-closed 上限。
- 美国 M4 生产复现为冷 `docker create` 在 5 秒被 code 143 终止，继而让真实 Kernel
  Planner 在 Attempt 创建前收到 `node_not_base_admitted`；现场磁盘占用仅 39%。
- 回退到 Brain `1.267.192` / Worker `1.267.96` 会恢复该误拒；回退前保持 Fleet 节点
  drained。

## Fleet cold-container admission stability

- Fleet Worker `1.267.96` 对 disposable Runner container 的 create/start 最多执行三次
  exact-name 清理重试，覆盖 OrbStack 冷 `docker create` 偶发超过 5 秒的现场故障。
- Brain admission 默认等待 20 秒且硬上限 30 秒，nodectl 等待 30 秒，完整覆盖受控重试；
  重试耗尽、HTTP 超时与任何证据缺失仍 fail closed。
- 回退到 Brain `1.267.191` / Worker `1.267.95` 会恢复冷 container admission 抖动；
  回退前必须保持所有 Fleet 节点 drained。

## Fleet Worker health version alignment

- Fleet Worker 健康探针的默认版本现在与三机 NodeProfile 的 `1.267.95` 一致，避免成功
  bootstrap 后仍因遗留 `1.267.94` 被 admission fail closed。
- 行为测试从 NodeProfile 读取期望值并核对真实 probe 输出，锁住两侧版本的同步更新。
- 回退到 Brain `1.267.190` 会恢复健康版本漂移；回退前必须保持所有 Fleet 节点 drained。

## Kernel Fleet offline PostgreSQL tag recovery

- Fleet Worker `1.267.95` 在离线载入 Runner archive 后，如果 pinned PostgreSQL 的
  repository-qualified digest 尚不可解析，会先验证 archive 已提供完全相同的裸 digest，
  再恢复 `postgres:16-alpine` tag 并复验完整 pinned 引用；缺少精确内容仍 fail closed。
- rollout producer 在导出 archive 前把已验证的完整 PostgreSQL digest 映射到固定 tag，
  新 archive 不再生成 `RepoTags: null` 的 PostgreSQL 记录；节点 bootstrap 不增加 registry
  依赖，Runner digest、NodeProfile 与 Worker 健康合同保持不变。
- 回退到 Brain `1.267.189` / Worker `1.267.94` 会恢复离线 archive 丢失 PostgreSQL tag
  后的 `postgres_image_unavailable`；回退前必须保持所有 Fleet 节点 drained。

## Kernel Fleet bootstrap TMPDIR isolation

- Fleet Worker `1.267.94` 的 installer 在低权限 preflight 前先创建并归属 canonical
  `/Users/Shared/cecelia-fleet-tmp`，且显式把它作为 `TMPDIR` 传给默认及覆盖 probe。
- bootstrap 不再继承调用者的私有 `/var/folders` 临时目录，因此 OrbStack bind-mount
  disposable container 在首次安装与升级时使用同一可共享路径。
- 回退到 Brain `1.267.188` / Worker `1.267.93` 会恢复调用者 TMPDIR 继承；回退前必须
  drain Fleet 节点，并仅在显式提供共享 TMPDIR 的维护窗口执行 bootstrap。

## Kernel Fleet admission stability and disk-policy SSOT

- Fleet Worker `1.267.93` 对 pinned PostgreSQL disposable runtime probe 最多执行三次
  exact-name 冷启动；每次前后都清理同名容器，三次失败仍 fail closed，单次 OrbStack
  冷启动抖动不再误 drain 健康节点。
- 三机 NodeProfile 的绝对磁盘余量统一为 10 GiB，并继续叠加 85% 使用率上限；installer
  从 NodeProfile 读取同一阈值，不再另写 40 GiB 常量。该余量覆盖八槽节点 worktree、
  pinned runtime 与临时 Attempt 数据，同时不会要求小容量服务器长期空出大半磁盘。
- 回退到 Brain `1.267.187` / Worker `1.267.92` 会恢复单次 PostgreSQL 探针与重复的
  40 GiB bootstrap 硬闸；回退前必须先 drain Fleet 节点。

## Kernel Fleet concurrency and diagnostic containment

- failure-persistence evidence 在 watchdog 边界先统一执行路径、凭据和长度脱敏，
  AggregateError、注入 recovery alert 和默认 P1 alert 共享同一安全输出。
- 通用 failure-persistence sanitizer 契约保持不变。
- Worker 的 in-flight prepare 与 inspect/cancel 以 exact lease 串行化；cancel 不再在
  prepare 落盘前误报 `already_clean`，inspect 也不再假报 `missing`。合法 terminal start
  tombstone 可沿 transport/Dispatcher 幂等回放，malformed 或错配回执仍 fail closed。
- receipt 尚未持久化的 Attempt 只有 TaskBundle 明确声明 `execution_surface=fleet-worker`
  才进入 Fleet recovery；本地 Docker 崩溃窗口不会被远端 missing 证据误终结。
- Fleet Attempt 的 watchdog 只重启 dedicated controller，不再独立 inspect/cancel/reclaim；
  old lease 的 start/heartbeat/cancel/terminal 收敛全部由 expired-attempt reconciler 负责。

## Kernel Fleet two-phase launch and expired-attempt convergence

- Fleet Worker `prepare` 只创建 stopped container 与 Attempt-owned 资源；Brain 必须先
  验证并持久化 exact attested receipt，之后才可调用 `start`。receipt 或 start 失败按原
  lease 精确清理，Runner 不再抢在控制面身份落库前 callback。
- prepare/start/inspect/cancel/terminal 回执全部校验 exact `attempt_id`、原 owner/generation
  与有限状态集合；inspect 只接受带 lease body 的 authenticated POST，旧 GET 与 stale lease
  均拒绝。Worker durable state 不保存 Provider/GitHub 原始凭据；重启后缺少一跳凭据的
  prepared Attempt 形成 terminal tombstone，并仅在 exact cleanup 后进入替换终态。
- normal derive 前先检查过期 Fleet Attempt。已验签存活 Worker 保持原 owner/generation
  续租；未验签存活 Worker 先 exact cancel 再换新 Attempt；Worker missing 时 Attempt
  `infrastructure_blocked` 终态与 bounded decision evidence 同事务写入；该独立 recovery
  evidence 按 callback-equivalent infrastructure result 驱动同角色重试，不消耗产品 fix
  预算。父 Run 终态只重新观测，lease/CAS 并发输家立即让位。
- 协议切换前停止 tick/controller 并证明 DB 无 active Attempt，再用
  `fleet-rollout.sh all --apply --protocol-cutover` 先完成三机全 drain、再开始任一 bootstrap，
  且更新后保持 drained；部署新 Brain、
  完成真实两阶段协议探测后才恢复 admission。PR #1581 的真实业务验收必须新建 Kernel
  Run；旧 Run `92a67d1a-2c3a-4819-9930-09d841f31bd8` 保持 terminal FAILED，Tick 继续
  manual-disabled/off，只运行新 Run 的 dedicated controller。回退到 `1.267.185` 同样
  要求全局 drain 并同时回退 Worker/Brain，禁止跨协议混跑。

## Kernel callback rejection and lease-generation fencing

- Runner 只在 Brain 返回 HTTP 2xx 后结束 terminal callback；连接错误、408、425、429
  和 5xx 继续续租重试，永久 4xx 退出并交由 Worker 的 full-finalize 回收全部 attempt
  资源，避免错误凭据或冲突 callback 永久占用 capacity。
- heartbeat payload、route 和 Attempt Store SQL 都绑定当前 `lease_generation`；旧代次即使
  持有相同 owner 也无法续活已被接管的租约。
- 三机 pinned Runner 基线同步为
  `sha256:e8979dcf7791b1fd0754276d39fd58adf9c8fc1148323a3d0d3b8abe29ea351f`。
- 回退到 `1.267.182` 会恢复永久拒绝无限重试与缺少 generation fence 的 heartbeat。

## Kernel Evaluator attempt-scoped PostgreSQL

- Dispatcher 将服务端推导的 `postgres` requirement 写入签名 TaskBundle；remote
  transport 仅转发 `{postgres:true}`，Worker 还会与 bundle 再次比对，未知字段或
  caller-supplied secret 均 fail closed。
- PostgreSQL preflight 读取被选节点 admission 的 runtime-resource 能力和 pinned
  digest，不再查询 Brain 本地 pool。
- Fleet Worker `1.267.92` 在 Runner 启动前创建 exact-attempt 私有 network 与 pinned
  PostgreSQL sidecar，短期账号密码只存在于进程内并注入 Runner 环境；不发布 host port，
  不把 URL 写进 attempt state。
- `pg_isready` 有界失败、Runner launch/state persistence 失败、terminal/cancel 与
  orphan reconcile 都有对称回收；历史 attempt 使用其状态内 pinned digest 做 exact
  回收，非“对象已不存在”的清理错误不得吞掉。
- terminal callback 必须先取得 exact leased Worker 的 HMAC cleanup receipt；仅
  `cleaned` / `already_clean` 可提交终态，其余结果保持非终态以便重试。Worker 先释放
  runtime resource、保留 callback Runner，等 Brain 返回成功且 Runner 自然退出后再做
  容器/worktree/state 清理；artifact 校验失败不会提前杀掉重试执行者。
- 三机 NodeProfile/installer/rollout/reconcile 同步固定 PostgreSQL digest，并把其
  真实启动 + `pg_isready` 结果投影到 Worker health/admission，不以 image inspect 假绿。
- durable callback 重试已进入重建 Runner
  `sha256:0f64058c10eb64141c7acabacb8588890723cae5ff3e91b44a1c94dc1b50d109`；
  Brain 2xx 前持续续租重试，cancel 与自然退出 cleanup 按 attempt single-flight。
- 回退到 `1.267.181` 前必须 drain 活跃 runtime-resource attempt。

## Kernel Codex terminal receipt and Planner/Proposer Run isolation

- Runner 仅在 Codex JSONL 最后一个协议事件为 `turn.completed`、没有
  `turn.failed`，且最后 agent message 与 `--output-last-message` 语义一致时，
  接纳带非零 CLI 退出码的已完成 Provider 结果；所有安全闸仍可覆盖为失败。
- Fleet callback 允许并严格校验成对的 `cli_exit_code` 与
  `terminal_receipt=turn.completed`，未知字段、零退出码、缺半边收据继续 409。
- Planner/Proposer handoff branch 都包含 task、run 与 hop，跨 Run 不再复用或
  消费其他 Run 的远端 ref：`cp-harness-prd-<task8>-r<run8>-a<hop>` 与
  `cp-harness-propose-r<round>-<task8>-r<run8>-a<hop>`。部署前 legacy Proposer
  ref 只有在当前 Run 的严格 TaskBundle 明确引用时才兼容。
- 三机 pinned Runner 基线同步为
  `sha256:1ec3542ab56a58c620196a4f32fd04b12e8049ec29dbc121e33b51a0cabc4288`。
- 回退到 `1.267.180` 会恢复已完成 turn 的假 `provider_exit` 与跨 Run 分支碰撞。

## Kernel read-only frozen guard and bootstrap callback convergence

- 冻结基线任务的 Reviewer/Evaluator 保留 Provider 前后两次血统断言，但不再对
  只读 Fleet workspace 写入 `core.hooksPath` 或安装 pre-push hook；只有可写的
  Generator 角色需要提交前钩子。
- Runner 用统一 normalizer 为 TaskBundle、Commander contract、冻结基线闸和
  Evaluator 隔离闸的启动失败补齐 `credential_ref` 与
  `credential_copy_mutated`，使结构化 failed callback 能通过 Brain 校验并落终态。
- 只有确实发生在凭据副本建立前的 `invalid_attempt_timeout` 与
  `credential_envelope_invalid` 可缺少 copy 证据；所有状态的未知 metadata 字段
  仍一律拒绝，普通 `provider_exit` 或成功回调也仍强制完整凭据证明。
- 三台 NodeProfile 与 rollout/reconcile 统一固定到含本修复的 Runner
  `sha256:7d6c52d18713a356aefa8bae7efc9b485e9277645bcea8b5250ecceaca7086d7`。
- 回退到 Brain `1.267.179` 会让冻结任务的只读角色再次在模型启动前因
  repository config 只读失败，且失败回调被 409 拒绝后卡在 `starting`。

## Kernel repository slug clone boundary

- `ensureHarnessWorktree` 现在把标准 `owner/repo` 仓库标识在 clone 边界规范化为
  `https://github.com/owner/repo.git`，同时继续接受现有的本地仓库路径和完整远端 URL。
- 数据库、TaskBundle 与 Fleet workspace contract 仍保存 provider-neutral 的仓库 slug；
  只有需要调用 Git 的旧本机 workspace 适配层才生成 clone URL，凭据注入后仍会把
  origin 还原成无 token 的干净 URL。
- 生产实弹任务 `635b4360` 已证明旧实现会在 Kernel run 建档前执行
  `git clone ... perfectuser21/zenithjoy-workspace` 并报 repository does not exist；本修复
  让手动派发和自动派发共用同一归一化边界，不修改 Skills、角色、模型或 Kernel 状态机。
- 回退到 Brain `1.267.178` 会让以 `owner/repo` 作为 `payload.base_repo` 的新 Kernel
  任务再次在首个 Attempt 前失败；回退前应 drain 此类 active task。

## Kernel frozen-baseline lineage guard

- `createWorkspaceSpecResolver` 把「任务钉死了 `payload.base_sha`」这一事实固化成
  `workspace_spec.frozen_baseline`（strict schema，默认 false）。
  `remote-bridge-transport` 的 `WORKSPACE_SPEC_FIELDS` 与 Fleet Worker
  `workspace-manager.cjs` 的 `SPEC_FIELDS` 同步收下该字段；`prepare()` 把它与自己观测到的
  `head_sha`（`expected_head_sha ?? base_sha` 实际 checkout 的那个）一起挂到 workspace 上，
  `attempt-runner.cjs` 据此注入 `HARNESS_WORKSPACE_START_SHA` / `HARNESS_FROZEN_BASELINE`。
- `entrypoint.sh` 新增 `frozen-baseline-guard` 段：`install_frozen_baseline_guard` 在
  Provider 启动前校验 HEAD 恰为 start SHA，快照当前所有 `refs/heads` + `refs/remotes` 的
  tip 到 `baseline-refs`，生成 `lineage-check.sh`（START SHA 与快照路径烤进脚本）与
  `core.hooksPath` 下的 `pre-push`；`assert_frozen_baseline_lineage` 在 Provider 退出后
  复用同一脚本。判据 = `git rev-list --count START..<commit>` 必须等于
  `git rev-list --count <commit> ^START ^<每个快照 tip>`，即引入的每个 commit 都是本
  Attempt 新写的。武装失败 → `frozen_baseline_guard_unavailable`；事后断言失败 →
  provider_success 置 false、exit 1。
- `commit-lineage-resolver.js` 用 GitHub compare API 返回
  `{ is_ancestor, merge_base_sha }`；`harness-callback.js` 的 `verifyFrozenLineage`
  对冻结 Attempt 要求 (1) `compare(start, head).status ∈ {ahead, identical}`，
  (2) `compare('main', head).merge_base_commit.sha` 等于 start SHA，或（generator-fix
  从 PR head 续跑的合法情形）start SHA 是该分叉点的后代。resolver 抛错 → 503
  `pull_request_verification_unavailable`。
- 反面判据留痕：单纯的 `git merge-base --is-ancestor start HEAD` **不是**冻结判据。
  生产 run `d9785137` 里 main `676fed7d` 本身就是冻结基线 `0dc4e3c0` 的后代，
  rebase 上去祖先关系照样成立。

## Kernel generator string PR artifact normalization

- `verifyGeneratorPullRequestClaims` 把 Generator callback 里裸字符串形态的 GitHub PR
  URL 当作 claim **候选**（宽匹配 `github.com/<owner>/<repo>/pull/`），随后走与结构化
  artifact 同一条服务端校验链：严格 URL 形状 → `parseBaseRepo` 仓库归属 → PR identity
  解析 → 分支归属（`workspace_spec.branch` 精确匹配，缺省回落 task short-id）→ HEAD SHA
  归一化。只有全部通过才输出结构化 `{type:'pull_request', url, head_sha, head_ref,
  verification_status:'verified', normalized_from:'string_artifact'}`。
- 生产实弹 run `a75ccbbf`：`harness_attempts.result.artifacts` =
  `["https://github.com/perfectuser21/zenithjoy-workspace/pull/1578", "Red commit: 5c7a7740",
  "Green commit: 7629efe6"]`；旧实现只按 `artifact?.type === 'pull_request'` 过滤，
  字符串被原样透传 → `verifiedPullRequestArtifact` 找不到证据 → `initiative_runs.pr_url`
  未投影 → `derive.js` 走 `generatorNoPrRoute`。
- 信任边界不放宽：字符串从不被直接采信；`repository_mismatch` / `branch_mismatch` /
  `invalid_url`（含带 query、fragment 等非严格形态，不做猜测式改写）一律降级为
  `unverified_pull_request_claim`；identity resolver 抛错继续 503
  `pull_request_verification_unavailable`（fail closed，callback 可重试）。
- 既有行为全部保持：结构化 artifact 路径与其附加字段透传不变；非 PR 形态字符串
  （如 `Red commit: ...`）原样透传；generator-fix 无证据时的 `server_observed` 回退不变。

## Kernel cross-repository approved-SHA contract materialization

- `persist_contract_approval` 从 task `payload.base_repo` 解析权威仓库（复用既有
  GitHub allowlist 解析），并把它传给 immutable git artifact reader；本地缺该对象时
  按精确 40 位 SHA 从该仓库 fetch 后再 `git show <sha>:<path>`。
- 生产实弹 run `4925488b`：Reviewer 第 8 轮 APPROVED 后，批准分支
  `cp-harness-propose-r8-7194e308-a137` / SHA `487037a7` 位于
  `perfectuser21/zenithjoy-workspace`，而 reader 只从 Cecelia `origin` fetch，
  导致 `approved_but_contract_artifacts_missing`。
- 边界不放宽反而收紧：repo 先要求 `owner/repo` 形状（拒绝任意 URL / shell 注入形态），
  再必须命中 `workspace-spec.js` 的 `WORKSPACE_REPOSITORIES` allow-list——与
  `workspace_repo_not_supported` 同一条信任边界，形状合法的第三方仓库（如
  `perfectuser21/zenithjoy-skills`）不能成为合同产物来源。解析为本仓 origin 时继续走
  `origin`；full-SHA 校验、repository-relative path 校验、不回退到可变 branch / 工作区
  文件、真正缺失仍 fail closed，全部保持不变。
- 真实冒烟（生产同类凭据环境）：全新仓库 origin=cecelia，按 `base_repo` 解析出
  `perfectuser21/zenithjoy-workspace` 后精确 fetch `487037a7`，读回 Round 8
  `contract-draft.md`（10088 bytes）与 `contract-dod.md`。
- 回退到 Brain `1.267.175` 会恢复跨仓库合同产物读取失败，回退前必须 drain 相关
  active Kernel run。

## Kernel repository-aware proposal discovery

- Ground Truth 按 task payload 的 `base_repo` 查询远端 proposal refs，不再把运行
  ZenithJoy 等跨仓库任务时的 proposal branch 错查到 Brain 自己的 `origin`。
- 远端仓库 identity 继续复用既有 GitHub allowlist 解析，并再次限制为安全的
  `owner/repo` 形状；未知旧任务保留 `origin` 兼容路径，不接受任意 shell remote。
- 这使已发布的 Proposer branch 能投影为权威 `proposeBranchRn/Sha`，Reviewer
  因而成为合法 Kernel boundary；Commander 的角色、证据和 Directive Gate 不放宽。
- 回退到 Brain `1.267.174` 会让跨仓库 Kernel run 再次把 proposal 轮次观测为 0，
  并在 `illegal_role_at_kernel_boundary` 后重复派发 Proposer；回退前必须 drain
  此类 active run。

## Fleet workspace bounded cleanup

- Fleet Worker `1.267.91` 在 OrbStack bind mount 前，为固定 LaunchDaemon 用户
  `_cecelia` 增加仅限 Worker-owned workspace/admin/runtime 根的继承 ACL；容器新建的
  `node_modules` 等目录不再阻断宿主清理。
- `git worktree remove` 只在已知的 macOS bind-mount `.git` validation/ENOTEMPTY
  失败上，回退到删除经过 attempt UUID 与受控根双重校验的精确 workspace/admin；
  未知错误仍进入 quarantine，安全边界不放宽。
- 这阻止每个成功 Attempt 把约 0.8 GiB 可再生工作树永久堆入 quarantine 并最终
  触发 `disk_free_below_floor`；既有 Attempt result、Git branch/commit 和 JSON 元数据
  仍是权威证据。
- 回退 Worker `1.267.90` 前必须 drain active Attempt；旧 Worker 会恢复无继承 ACL
  和无界 quarantine 增长。

## Runner Commander complete strict response schema

- Commander Provider schema 的根对象与 `route` 子对象都把全部 property 列入
  `required`，可选字段改用显式 nullable 类型，完整满足当前 Codex strict JSON Schema。
- Provider 成功后由 Runner 可信规范化逻辑移除根层和 `route` 内的 `null` 可选字段，
  再交给既有 `commander-directive/v1` Zod 合同；action、evidence、Provider、凭据、
  workspace、Fleet admission 与 callback 边界不变。
- 三节点统一固定 Runner
  `sha256:0ac225b0878550b6fbbb1f3b960be392630e52139df3fab761f4d5fe5cc4f721`。
- 回退：先 drain active Hybrid run，再恢复 Brain `1.267.173` 与上一 Runner digest；
  旧组合会在首个 Commander Attempt 恢复嵌套 `required` 不完整的
  `invalid_json_schema`。

## Runner Commander strict response schema

- Commander Provider 的结构化输出 schema 为 `schema` 字段补齐 `type: string`，同时
  保留 `const: commander-directive/v1`，满足当前 Codex API 的 strict JSON Schema。
- 三节点统一固定 Runner
  `sha256:c4c37787247cf0cb211b87f1ba7500e0e738bfa00228ddea7561821ff80f3189`；
  不改变 Provider、凭据、workspace、Fleet admission 或 callback 的信任边界。
- 回退：先 drain active Hybrid run，再恢复 Brain `1.267.172` 与上一 Runner digest；
  旧组合会在首个 Commander Attempt 恢复 `invalid_json_schema`。

## Fleet Worker Commander role admission

- Fleet Worker 的目标角色 allow-list 接受规范 `commander`，对齐 Hybrid Kernel 首跳
  已经生成的 Commander Attempt 与 TaskBundle 合同。
- 未知角色仍在凭据消费、workspace materialization 和 Docker launch 前拒绝；不改变
  Provider、GitHub credential、机器或 pinned Runner digest 边界。
- 回退到 `1.267.171` 前必须 drain active `hybrid` run，否则后续 Commander Attempt
  会重新被 Worker admission 以 HTTP 400 拒绝。

## Commander auth failure status redaction boundary

- 递归秘密扫描器允许唯一的布尔运行状态键 `auth_failed`，避免 Ground Truth 的
  `lastAgentExit.auth_failed=false` 在首个 Hybrid Commander Attempt 前被误判为凭据。
- 同名非布尔值与 `authorization`、token、secret、password、API key 等真实秘密
  材料继续 fail closed；不改变 Provider 凭据、Fleet 或 CredentialEnvelope 边界。
- 回退到 `1.267.170` 前必须 drain active `hybrid` run，否则这些 run 会在下一个
  material boundary 恢复失败。

## Public Kernel run commander mode creation

- canonical 与 legacy Relay run 创建入口共用 allow-list 信任边界，允许显式选择
  `legacy-session`、`kernel-only` 或 `hybrid`，省略时保持 `kernel-only`。
- Kernel run Store 独立复核模式，并在创建事务的 INSERT 中原子持久化
  `commander_mode`；按 run ID 和 active task 读取时都返回该字段。
- 回退到 Brain `1.267.169` 前必须 drain active `hybrid` run；旧版本不会从公开入口
  创建 hybrid run，且读取时会把未投影的模式按 `kernel-only` 处理。

## Kernel Evaluator Provider schema UID boundary

- Runner 在 root 可信前置生成结果 schema 后，将该公开输出合同固定为 `0444`，
  再把 Evaluator Provider 降权到 UID 999；Provider 可读但不可改 schema。
- evidence capsule 继续为 root 所有、目录 `0555`、文件 `0444`，GitHub credential
  仍在 Provider 启动前销毁；本修复不放宽证据、凭据或 worktree 边界。
- 三节点固定 Runner
  `sha256:f57591df89aa1a15e49019f306abcc5606039314ebf5d293d884c055cbfe1d00`。
- 回退：先 drain active Evaluator Attempt，再恢复 Brain `1.267.168` 与 Runner
  `sha256:c78084e09c363601b00b968f47bca1e726ad14811feb438a91b70346e5fa4d33`；
  旧组合会恢复 root `0600` schema 导致 Provider 启动前失败。

## Kernel Evaluator PR identity completeness

- Ground Truth 的 GitHub PR observation 现在包含不可变 `number`，Evaluator TaskBundle
  因而能把 `pull_request.number` 与 `github_evidence_request.pr_number` 做同源校验。
- exact-head、workflow、run、artifact、CredentialEnvelope 与 Provider 无 GitHub authority
  的边界均保持不变；缺失或不匹配的 PR number 继续 fail-closed。
- 回退到 Brain `1.267.167` 会恢复 evidence preflight 的
  `github_evidence_identity_mismatch`；存在 active Evaluator Attempt 时不得回退。

## Kernel Evaluator trusted evidence capsule

- Evaluator 的 GitHub CredentialEnvelope 只由 Runner 的可信前置消费；Provider 启动前
  必须完成 exact-head 取证并销毁 `hosts.yml` 与内存变量中的 token。
- `github-evidence-capsule/v1` 绑定 repo、PR、head、workflow、run、artifact 及 SHA-256；
  Provider 退出后以父进程未导出的 digest 复核，篡改即 fail-closed。
- `harness-evaluator` 不再执行 GitHub CLI，远端 Windows/Android 证据全部由胶囊提供。
- 三节点固定 Runner `sha256:c78084e09c363601b00b968f47bca1e726ad14811feb438a91b70346e5fa4d33`。
- 回退：先 drain Evaluator Attempt，再恢复 Brain `1.267.166` 与上一 Runner digest；
  旧组合会恢复 Evaluator 运行期 GitHub authority，禁止带 active Evaluator 回退。

## Kernel Evaluator structured evidence transport

- Provider/Fleet Runner 的 HarnessResult schema 允许 `checks[]` 保存结构化行为测试，
  callback、Attempt Store 与 `evaluatorBrainResult` 原样把证据交给 Independent Judge。
- Judge 的机械闸未放宽：每项仍必须有非空 `command`、数字 `exit_code` 和非空
  `log_tail`；传输层不会从摘要字符串合成或伪造证据。
- 三台 Fleet 节点固定 Runner
  `sha256:e4300138e571fbb80ebf2952f2fc1d9510066a18a218adf1c4c5259e1eaae979`。
- 回退：先 drain active Attempt，再恢复 Brain `1.267.165` 和上一 Runner digest；
  旧组合会再次把 Evaluator 结构化输出限制为字符串。

## Fleet Judge embedded-contract mechanical evidence

- Independent Judge 的机械合同测试闸现在直接统计 Fleet TaskBundle 内锁版本
  `contract_content` 的具体 `[BEHAVIOR]` 条目；provider-neutral bundle 继续不携带
  宿主 `worktree_path`，不会因路径安全边界误报 `contract_tests=0`。
- Sprint 测试文件与 `contract-dod.md`/`contract-draft.md` 扫描只作旧本地 run 的兼容
  fallback；Evaluator 自报计数、空标题和空列表项仍不能满足机械闸。
- 回退到 Brain `1.267.164` 会恢复 path-free Fleet Judge 的假
  `contract_tests=0`；存在等待 Independent Judge 的 active Kernel run 时不得回退。

## Provider-neutral Kernel Judge evidence

- Independent Judge 优先使用 Fleet TaskBundle 内经批准且锁版本的
  `contract_content/prd_content`，provider-neutral bundle 继续禁止宿主
  `worktree_path`；旧本地 run 保留 sprint 文件兼容回退。
- 证据门只按实际解析出的合同 E2E 或 Golden Path 步骤决定是否运行；两者都缺失
  仍 fail-safe `NEEDS_CONTEXT`，结构化阶段闸、机械闸与人工合同 Gate 均不变。
- 回退到 Brain `1.267.163` 会恢复 Fleet Judge 丢合同证据问题；存在此类 active
  Kernel run 时不得回退。

## Kernel Evaluator concerns verdict normalization

- Evaluator 的 `PASS_WITH_CONCERNS` 现在规范化为 append-only `PASS` verdict，
  不再被错误投影为 `FAIL` 并派发 Generator；未知 outcome 仍然 fail closed。
- Attempt 继续保存 `completed_with_concerns` 终态、完整 summary 和 concern reason，
  因而 Independent Judge 与 review-required Gate 仍会执行，不会把 concerns 静默吞掉。
- callback route 与原子 Attempt Store 共用同一个 verdict normalizer，避免旧兼容入口
  与生产事务路径再次漂移。
- 回退到 Brain `1.267.162` 会把 `PASS_WITH_CONCERNS` 再次误判为 `FAIL`；存在
  此类 Evaluator callback 的 active Kernel run 时不得回退。

## Kernel Evaluator feedback handoff

- `spawn:generator-fix` 的 TaskBundle 现在携带与当前 PR head SHA 和失败
  Evaluator Attempt ID 同时绑定的 `evaluator_feedback`，包含 verdict、
  summary、decision reason 与最多 20 条机械检查证据。Generator 不再需要从
  任务描述猜测失败原因，也不会在同一 SHA 上无进展重跑。
- 只有当前 SHA 的 `FAIL` verdict、同一 Attempt 的成功终态 HarnessResult 和
  非空诊断同时成立时才交接；stale SHA、PASS、畸形或身份不一致的结果全部
  fail closed。
- handoff 只重建固定字段，不复制 provider metadata、credential reference、
  transcript 或其他私有结果；所有文本复用 Brain diagnostic 脱敏并分别截断到
  2,000 字符。
- 回退到 Brain `1.267.161` 会再次丢失 Evaluator→Generator 修复上下文，可能
  触发同 SHA `no_progress_same_sha`；有 active repair run 时不得回退。

## Kernel Reviewer feedback handoff

- GAN Reviewer 的完整结果继续以 `harness_attempts.result` 为权威；下一轮
  Proposer TaskBundle 现在显式携带有界的 `review_feedback`，包含
  Attempt ID、合同轮次、合同 SHA、summary 与 decision reason。
- Ground truth 只接受与当前远端 proposal branch 的 round 和 SHA 同时匹配，
  且 canonical TaskBundle/HarnessResult 身份与状态一致的 completed Reviewer
  Attempt；旧轮、分支移动、缺 SHA 或畸形结果全部 fail closed，不得污染下一轮
  修订。
- 反馈 handoff 不结构化复制 provider metadata/transcript；summary/reason 复用
  Brain diagnostic 脱敏并分别截断到 2,000 字符。它不要求 Worker 反查 Brain
  API，不改变 Commander/Fleet 架构与 Reviewer fresh/read-only 隔离。
- 回退到 Brain `1.267.160` 会再次丢失跨轮 Reviewer 反馈，可能导致 GAN
  重复发现相同缺口；有 active GAN run 时不得回退。

## Planner receipt server attestation

- `completed_with_concerns` 是 Kernel 合同中的成功终态：concerns 进入决策日志，
  但已认证、lease-fenced 且服务端验证过的 planner Git artifact receipt 可以
  推进 `prdExists`，不再重复派发 planner。
- callback 与 Attempt 必须使用同一成功状态，并继续精确绑定 run、Attempt、
  lease generation、机器 attestation、仓库、分支、SHA 与 sprint path。
- 服务端 Git 校验会生成调用方无法注入的
  `server_verification.planner_git_artifact`，并在同一事务中写入 Attempt 与
  callback event；消费侧要求两份证明与 artifact 完全一致，修复前 receipt
  自动失效。
- 历史 snapshot 只有携带 Brain 生成、路径一致的
  `prdEvidence.source=brain_file_observation` 才能回放；裸
  `observed.prdExists=true` 不再具有权威性。
- Migration 381 将全新数据库的 `execution_transport` 约束补齐
  `fleet-worker`，收敛 migration 363 与生产 schema 的差异。
- 回退到 Brain `1.267.158` 前应确认没有 active run 正依赖 concerns receipt；
  旧版本会把这类成功 artifact 误判为 `no_prd`。

## Fleet Runner credential contract pin

- 三台 Fleet 节点统一固定 Runner
  `sha256:99168f93f9bba7815eea8f1934a1d1b411b78cb7acf6094719cdd674fa598e50`；
  该 artifact 同时实现 GitHub 与 Codex 一次性 CredentialEnvelope。
- Fleet rollout 在导出和传输实际 pinned image 前，直接检查镜像内 entrypoint
  的两类凭据协议；source 与 artifact 漂移时以
  `runner_image_contract_invalid` fail closed。
- blue-green sidecar 的主部署与 fallback 都显式读取 `.env.docker`，避免重建
  Brain 时把 Fleet bridge token 解析为空值。
- 回退：先 drain 全部 Fleet 节点，再恢复上一 Runner digest 并部署 Brain
  `1.267.157`；旧 Runner 不得接收需要 GitHub envelope 的角色。

## Fleet Worker GitHub envelope installer

- Fleet Worker 的事务安装、升级和回滚包含
  `github-credential-envelope.cjs`，避免 LaunchDaemon 因缺少运行时模块启动失败。

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
  `sha256:99168f93f9bba7815eea8f1934a1d1b411b78cb7acf6094719cdd674fa598e50`。
  发布前必须由 rollout 对实际 artifact 验证 GitHub 与 Codex 两类
  CredentialEnvelope 协议，不能用源码存在相应逻辑替代镜像实检。
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
