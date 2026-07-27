# Provider-neutral Harness Kernel

本目录是 Harness 的确定性内核。它决定阶段、门禁、重试、合并与恢复；Claude
Code、Codex 等 CLI 只是执行 TaskBundle 的 worker，不拥有流程状态机。

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
node packages/brain/src/orchestrator/run.js --task-id <uuid> --run-id <uuid>

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
