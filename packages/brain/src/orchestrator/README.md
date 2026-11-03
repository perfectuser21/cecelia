# 公共 Activity Runner

现行执行与监督协议见下方「Runner vs Commander」。业务循环由 `runActivityContract` 统一持有；Commander 只监督和指导。

## Kernel 已退役

禁止新建、重启与延迟重派 kernel：Brain relay/run API、Fleet orchestrator prepare/start、直接 CLI 均返回 `kernel_runtime_retired`。无环境变量可重新启用。历史 load/patch/finalize/reconcile 与 Fleet inspect/terminal 保留，不杀在途进程、不释放未知资源。

现行业务使用公共 Runner 的固定 workflow/profile + Commander。编码走 `coding_workflow`。`golden_path_proposal` 尚缺受保护 profile 与验收合同的迁移绑定，因此明确拒绝新派发；不能把退役视为业务已迁移。Fleet attempt transport 仍服务公共 Runner 原子执行，未被退役。

以下为历史实现参考，不是现行启动操作手册。

# Provider-neutral Harness Kernel

本目录是 Harness 的确定性内核。它决定阶段、门禁、重试、合并与恢复；Claude
Code、Codex 等 CLI 只是执行 TaskBundle 的 worker，不拥有流程状态机。

## 通用业务活动执行（显式调用，阶段3）

GP-Anchor: f1/step4（程序产物与执行回执的真实边界）；守卫见
`tests/gp/f1/step4-activity-contract-receipt.test.js`。业务能力本身仍由业务仓库分类。

`activity-contract.js` / `activity-runtime.js` / `activity-process.js` 消费业务仓库
已经组装、解析 ref 的活动 JSON；它们不替代角色 `TaskBundle/HarnessResult`，也未接入
生产 task 路由。业务能力与设备操作仍由活动入口实现。CLI 接收 stdin
`{contract:{workflow,activities},input:{run_tag,...}}`：

```bash
node packages/brain/scripts/activity-contract-run.js --cwd /path/to/activity-directory --receipt /path/to/run.json < request.json
```

CLI stdout 只有一个终态 JSON；exit 0/2/1 对应 completed/partial/failed。
`--receipt` 在每个开始、心跳、完成边界原子更新，最终文件与 stdout 相同。
调用方可注入 `runActivityContract(...,{onEvent})` 接现有 `createRunEventStore`；本入口
不自行建 Brain run 或写任务终态，不声称未运行的数据库对账或业务后置探针已通过。

与 ZenithJoy `product-map/contracts/activity-contract.schema.json` 的 opt-in 扩展对齐：

| runtime 字段 | 程序语义 |
|---|---|
| protocol | 必须为 `json-stdio-v1`；旧 shell 参数说明不作可执行协议 |
| entry / argv | 活动目录下安全相对路径与字符串参数数组，拒绝绝对路径和上级目录；JS 用当前 Node、可执行 SH 直接调用，均不走 shell 拼接 |
| input | 可选目标顶层字段→路径映射；`$.field` 为累计上下文、`$input.field` 为原输入、`$item.field` 为当前条目；缺映射传累计上下文 |
| per_item | `{group,items:'$.collection',input:'item_field',identity:'id_field',when?:{path,equals}}`；仅用于 per_item phase，同组绑定相同且必须连续 |
| on_failure | `continue` / `stop_run`，默认后者；失败回执保留产物并按该策略推进 |
| max_attempts | 1 / 2，默认1；只有结果 retryable 且 failure.retryable 非空才允许第二次 |
| cleanup_grace_s | 1–30，默认5；到预算或取消只向JSON活动根发TERM，由它通知动作在安全边界清理；宽限到期KILL同一进程组 |

每个活动独立传自己的 `budget`，映射与原输入不能覆盖预算；`attempt` 由执行器注入。
`order` 排序后，同组逐条目走完整链才进入下个条目；`when` 不满足记 skipped。
同条目集合输出按 identity 更新该条目，其余 per_item 数组累计；batch 输出替换当前
集合。每次调用的完整 outputs/metrics/evidence/传输结果都保存在 activities.attempts，
聚合 metrics 按活动 key 分开，避免把不同活动的业务计数误算成一个值。
主链错误或取消后仍按顺序执行全部 finalize；finalize 成功不能把主链失败改成成功。
fatal、needs_human、未声明失败分类始终停止主链，即使 on_failure=continue 也不续跑。
事件接收端失败记录 `event_sink_failed` 并停主链，保留已完成产物并执行全部 finalize。
业务探针、锁、重放幂等与远程副作用清理由活动负责，通用执行器不猜业务规则。

实施/验证路径：真实 CLI 子进程 smoke 先报 RED（提交 `ca45f4c219`），再实现并验
`src/orchestrator/__tests__/activity-runtime.test.js`；smoke 入口为
`packages/brain/scripts/smoke/activity-contract-runtime-smoke.sh`。后续上线仍需业务链
等价与真机验收，不因离线测试通过而完成阶段3。

## 灰度启用与回滚

仅对 `orchestrator: "skill-relay"` 的任务生效：

```json
{
  "harness_runtime": "kernel-v1",
  "role_assignments": {
    "generator": { "provider": "codex", "account": "team3" },
    "evaluator": { "provider": "grok", "account": "grok" }
  }
}
```

- `executor: "auto"`：按 capability 选择已注册 provider，不选择 model。
- `executor: "claude"` / `"codex"` / `"grok"`：未配置角色表时的兼容默认值。
- `role_assignments.<role>`：按角色显式选择 `{provider, account}`；每条 attempt
  独立落库，允许 writer 与 reviewer 使用不同厂商和账户。
- `model` 缺省：不向 CLI 传模型，让账号或 CLI 配置决定。
- `model` 显式设置：才透传为 provider 的模型参数。
- 回滚：删除 `harness_runtime` 或改成其他值，立即回到原
  `harness-controller` 路径，不需要迁移或删除 attempt 数据。

当前生产 adapter 为 Claude Code、Codex 与 Grok。新增 provider 时只需实现
`start / resume / inspect / cancel / normalizeResult`，声明 capabilities，并通过
TaskBundle、结构化输出、session 隔离和恢复测试；不要把 provider 专有指令写入
Skill 或状态机。

### Opt-in Commander Phase 2

`commander_mode` 默认仍为 `kernel-only`。只有显式设为 `hybrid` 且任务 payload
声明 `commander.primary`（可带最多三个有序 fallback）的 Run，才在 material
Kernel boundary 创建一个正常的 `harness_attempts.role='commander'` Attempt：

```json
{
  "commander": {
    "primary": {
      "provider": "codex",
      "account": "team4",
      "machine": "us-mac-m4"
    },
    "fallbacks": [
      {
        "provider": "claude",
        "account": "account1",
        "machine": "us-mac-m4"
      }
    ]
  }
}
```

Commander 只返回一条 provider-neutral `commander-directive/v1`。L0 会重新校验
Run/cursor/evidence/role/cost/hop/deadline/capability，并且只允许当前 Kernel boundary
本来合法的动作。`switch_provider` 与 `switch_machine` 在 Phase 2 明确拒绝；
merge、deploy、promote 仍只能经过现有 Kernel gate。Provider fallback 只响应已落库
的白名单基础设施错误，使用新 Attempt、新 session 和保留的 logical-cycle lineage；
语义拒绝、Reviewer/Evaluator 产品失败和未知文本都不会触发跨 Provider。

本阶段不安装节点、不复制凭据、不部署，也不执行真实或 synthetic canary。Xian
机器不得保存长期 Codex 凭据；后续节点配置以 US M4 的 OrbStack 基线为准。

## 契约与 Skill

- `execution-contract.js`：内部 v1 `TaskBundle` / `HarnessResult` schema。
- `skill-bundle.js`：从仓库 `packages/workflows/skills/` 读取 Skill，记录 version、
  `sha256` 和完整内容后再派发；运行时不以 `~/.claude/skills` 为事实源。
- `provider-registry.js`：按能力解析 provider，注册顺序是 `auto` 的确定性优先级。
- `providers/`：仅生成 CLI 调用描述并规范化返回，不决定 Harness 流程。

每个 planner / proposer / reviewer / generator / evaluator / judge 都写一条
`harness_attempts`。唯一 `(run_id, hop)` 固定 relay 次序；provider session 在同一
run 内只能属于一个 attempt。回调结果必须匹配 attempt id、provider 和 role。

## 对抗与恢复不变量

1. proposer 与 reviewer、generator 与 evaluator 必须是不同 attempt 和新 session。
2. reviewer/evaluator 的 decision 是必填项；judge 使用独立证据门，不复用 agent
   的自我评价。
3. runner 每 60 秒 heartbeat；lease 未过期时其他进程不得接管。
4. lease 过期且已有 provider session：只 reclaim 并 resume 同一 attempt。
5. 没有可恢复 session：不猜进度，重启 kernel reconcile，从 DB、PR、Git 和产物
   重新推导下一 hop。
6. callback 是幂等终态写入；verdict 以 attempt id 去重并绑定 round / PR SHA。

Reviewer 只读合同，因此使用只读 worktree 和 provider plan/read-only 模式。Evaluator
不是只读角色：其 Skill 必须 checkout PR、安装依赖、真启服务、执行 E2E，并把验收脚本/
证据固化到 PR 分支；因此 evaluator 使用可写 worktree。独立性由不同 attempt、fresh
session、provider/account 分配和 Judge 证据门保证，不能用文件系统只读替代真实验收。

Claude 的本地 session 文件按 attempt 持久化在宿主
`CECELIA_HARNESS_SESSION_DIR`（缺省为系统临时目录下的
`cecelia-harness-sessions/`），容器替换后继续挂载同一目录。跨设备若没有共享该目录，
不要复制 session id 冒充可恢复；watchdog 应关闭旧 attempt，并按 Git/PR/DB 真相重新
推导。Codex thread 由 provider 自身保存，`thread.started` 到达时立即落 attempt。

## 运行与排障

```bash
# 只观测、推导，不写 DB/不派发
node packages/brain/src/orchestrator/run.js --task-id <uuid> --run-id <uuid> --dry-run

# 真实运行（通常由 skill-relay 启动）
node packages/brain/src/orchestrator/run.js --task-id <uuid> --run-id <uuid> \
  --controller-session-id <uuid> --controller-generation <n>

# provider runner 静态契约
bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
```

### 部署前必须重建 Runner 镜像

`docker/cecelia-runner/entrypoint.sh` 由 Dockerfile `COPY` 进
`cecelia/runner:latest`，不是运行时 bind mount。仅更新仓库或重启 Brain 不会刷新已有
镜像；旧镜像不会发送 attempt Bearer token，新 callback 会连续返回 401。

每次部署包含 `Dockerfile`、`entrypoint.sh` 或 provider contract 变更时，必须先执行：

```bash
bash docker/build.sh --no-cache

# 验证实际将运行的镜像，而不是只检查仓库源码
docker run --rm --entrypoint sh cecelia/runner:latest -c \
  'grep -q HARNESS_CALLBACK_TOKEN /usr/local/bin/entrypoint.sh && \
   grep -q PROVIDER_CONTRACT /usr/local/bin/entrypoint.sh && \
   grep -q evaluator-evidence-bridge:start /usr/local/bin/entrypoint.sh'
```

上述验镜失败时禁止启用 `harness_runtime: "kernel-v1"`。`ensureDockerImage()` 只会在
镜像不存在时自动构建，不会判断本地 `latest` 是否落后于仓库源码。

内部 callback：

- `POST /api/brain/harness/attempts/:attemptId/heartbeat`
- `POST /api/brain/harness/attempts/:attemptId/callback`

排障先查 `harness_attempts` 的 status、lease_owner、lease_expires_at、
provider_session_id、error_code，再查 `orchestrator_decision_log`。不要人工复制 session
到另一个 role；需要恢复时让 watchdog 按上述规则接管。

## Kernel 架构铁律

1. 真相只在 Git、GitHub PR、数据库和已落库产物中；worker 对话、进程内状态和容器
   文件都不是事实源。
2. `derive.js` 必须保持纯函数：不得读写 DB、文件、网络，不得包含 provider/account
   分支。账户与 provider 只能在 dispatcher/launcher 边界解析。
3. `orchestrator_decision_log` 是控制流唯一回放源；任何恢复都先重读外部真相，再由
   derive 计算下一 hop。
4. 禁止把 LangGraph checkpoint、thread resume 或 provider session 当成流程真相。
   session resume 只是在同一 attempt、同一 role、同一 provider 下的执行优化，缺失时
   必须回到 Git/PR/DB 重推，绝不能用 checkpoint 猜阶段。
5. Kernel 不得重新引入 LangGraph 状态机。本目录不再存在任何 workflow runtime /
   registry；见下方「目录边界」。

## 目录边界

**本目录 = Provider-neutral Harness Kernel，只此一套流程状态机。**

上一代 Brain v2「L2 Orchestrator」（LangGraph `runWorkflow` + workflow registry）曾住在
这里。它的两个模块 `graph-runtime.js` 与 `workflow-registry.js` 已在死码清理中物理删除
（注册数恒为 0、无任何调用方），Phase C 路线图随之作废。**不要按旧文档或旧 spec
（`docs/design/brain-orchestrator-v2.md` §6）在这里重建它们** —— 那份 spec 只作历史归档，
不是本目录的施工图。

结构性判据，新增文件前先自查：

| 判据 | 结论 |
|---|---|
| 文件是否服务 `run.js` / `loop.js` / `derive.js` 这条 Kernel 主链？ | 是 → 属于本目录 |
| 文件是否引入 `@langchain/langgraph` 的图/状态机/注册表语义？ | 是 → **不属于本目录**，也不得被 Kernel import |
| 文件是否只被 `packages/brain/src/workflows/**` 使用？ | 是 → 归属 `workflows/`，除非落在下方例外 |

### 唯一例外：`pg-checkpointer.js`

`pg-checkpointer.js` 留在本目录，但**它不是 Kernel 的组件，Kernel 任何代码都不得 import 它**。

- 真实归属：它是 LangGraph `PostgresSaver` 的进程单例工厂。全仓真实 import 方只有三处，
  没有一处属于 Kernel：`workflows/consciousness.graph.js`（意识循环在跑）、
  `lib/harness-thread-lookup.js`、`routes/walking-skeleton.js`。
- 为什么不搬到 `workflows/`：路径 `orchestrator/pg-checkpointer.js` 被 20+ 个文件以
  `vi.mock('.../orchestrator/pg-checkpointer.js')` 硬编码引用（含 `tests/integration/**`
  与 `tests/regression/**` 的跨包相对路径）。挪动收益是"位置更贴切"，代价是一次性改
  20+ 处 mock 路径并承担 mock 静默失效（mock 路径写错不报错，只会让测试真连 PG）的风险。
  **稳妥优先：不挪，靠本节说明划清归属。**
- 若将来 consciousness graph 也迁离 LangGraph，本文件应随之删除，而不是被 Kernel 接管。

## 模块

| 文件 | 责任 |
|---|---|
| `run.js` | Kernel 入口；`--dry-run` 只观测推导 |
| `loop.js` / `derive.js` / `ground-truth.js` | 主循环、纯函数推导、外部真相读取 |
| `execution-contract.js` / `skill-bundle.js` / `provider-registry.js` / `providers/` | TaskBundle 契约、Skill 取证、provider 解析与调用描述 |
| `pg-checkpointer.js` | **非 Kernel**：LangGraph `PostgresSaver` 单例工厂，服务 `workflows/`（见上方例外说明）|

## Runner vs Commander

公共 Activity 循环只有 `runActivityContract`。Fleet Worker 的 HTTP 入口和 ZenithJoy 获客适配器复用该实现；业务适配器提供执行者、固定检查器和资源读回，不另选活动或重写循环。不同 Worker 是同一 Runner 的实例。

Runner 按冻结合同顺序执行，每步先检查前置条件、再调用执行者、再独立验收，按 `on_status` 将 done/retry/failed/empty/partial/needs_review 路由到 next/retry/stop/pause。未知状态转 needs_review；重试须有上限与 retry_safe，恢复须有 recovery_safe。checkpoint 在 start/end 两处都只记录，hard 的缺证据或失败阻断。旧合同保留兼容解析；未配置检查的探索步骤标记 unchecked，不成为正式通过证据。

Commander 在 run 开始唤醒，结束休眠，接收 progress/question/error/stall/check_result，只能 answer、steer、abort、none。它不能判定状态或批准外部动作。不可达时记录 unavailable，按代码规则继续；一次失败检查最多给一次恢复机会，指导进入固定 Skill 下一回合，再次独立验收。没有安全恢复适配器就待审，未知副作用只允许只读恢复。旧执行停止未知时跳过现场清场、保留占用；根进程退出不能证明脱离子进程或远程动作停止。

受保护 profile 的 `commander` 配置使用 `{kind:"openclaw",skill:{entry,version},timeout_s,budget}`，或 `{kind:"process",entry,argv,skill,timeout_s,budget}`；入口、Skill 和所有依赖必须列入 `files` 的 SHA-256。预算含 max_steers、max_recovery_turns（0或1）、max_calls、timeout_ms；若指定 max_cost，须同时提供每次调用预留上界 max_call_cost。Skill 正文真身在 zenithjoy-skills 的 runner-commander@1.0.0，业务仓通过 `.skills-source.json` 固定。没有可用配置会记录 unavailable，不把它当业务失败。OpenClaw沿现场既有登录调用，不创建账号或改凭据。

标准进程默认使用原 JSON/EOF 协议；agent adapter 显式设 `runtime.interactive=true` 后才使用 JSONL 输入。stderr 的 `activity-agent-event/v1` progress/question/error 由 Runner 转给 Commander，纠正写入下一行 stdin；adapter须实际消费，不能把发送成功当成执行成功。stall 根据最后一次真实进展计算，不以心跳冒充进展。

每个 Activity 保留 commander_interventions、rescued、validator_verdict，代码失败与 Skill 救援分别计数。交流、检查和路由属于观察记录，不得代替执行证据。Recorder 持久落盘并在中央内容读回后 ACK，包括最终 sleep 事件；断网只补记录，不重做业务。失败及待审只生成未确认样本候选，不自动升级成熟度或样本。

| 入口 | 当前代码行为 |
|---|---|
| 公共 Worker、固定 Activity CLI、编码主链、获客101–104 | 同一公共循环；编码 PR 后处理 Commander 只读，不再改规格、追加额度或豁免 QA |
| Skill Invocation 与 authoring | 按冻结快照逐Activity调用独立子任务；父回调必须匹配公共Runner签发摘要，整包Agent编排已停用 |
| native assembly 对账 | 原数据库会话锁内执行一个有界代码Activity；交流逐条持久化并读回，最后sleep先于终态落账 |
| 普通发布与Commander V2新单 | 经固定来源适配公共HTTP Runner，保留task/run身份；缺正式profile、输入或验收实现时拒绝启动，无旧执行器回退 |
| Kernel | 关闭registry、relay、run创建、CLI、Fleet与live smoke全部新启动入口；历史读回和安全收尾保留 |
| 旧Factory派发 | 新启动明确needs_review/common_runner_migration_required；缺停止证明不释放旧手机占用 |

**尚未完成的业务迁移**：GP提案、Factory缺公共固定合同及独立验收绑定；现发布合同与旧Ai办公室任务账号和素材输入冲突，且prepare/publish/verify实现manifest未完整。Invocation文字质量标准缺正式独立Validator时保留unknown/needs_review。具体发布缺口见 `docs/current/WORKFLOW_COMMON_RUNNER_MIGRATION.md`。不能换账号、猜素材、包装整块旧AI流程或把schema通过算作质量通过。本次代码不改在途身份、不重放发送、不部署；代码测试不等于生产或真实模型指导质量验收。
