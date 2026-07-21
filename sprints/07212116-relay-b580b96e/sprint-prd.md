# Sprint PRD — 执行资源动态调度加厚·续

**TASK_ID**: `b580b96e-74a5-4ce7-aabe-a776e4ac5c69`  
**SPRINT_DIR**: `sprints/07212116-relay-b580b96e`  
**日期**: `2026-07-21`

## 背景

前身任务 `0f7dd3d7` 已交付刀 2「引导员 v1」并随 PR #4158 合入，当前代码锚点是 [`packages/brain/src/dispatch-allocation-guide.js`](/workspace/packages/brain/src/dispatch-allocation-guide.js) 已存在的前置引导员。本任务不是另起新炉灶，而是在这条线上补齐剩余四刀：

- 刀0：接手孤儿 PR #4133，并把交付语义从旧任务 `a598772e` 改绑到当前任务 `b580b96e`
- 刀1：补 `llm_capacity` 账本和三家 poller
- 刀3：把续接层级补到四级，覆盖 `harness_initiative`
- 刀4：给调度侧补一个只读故障哨兵出口，便于看当前容量快照

当前分支可见的核心代码锚点：

- [`packages/brain/src/dispatch-allocation-guide.js`](/workspace/packages/brain/src/dispatch-allocation-guide.js)：
  `GUIDED_TASK_TYPES` 已从仅 `dev` 扩到 `dev + harness_initiative`，版本号升级为 `dispatch-allocation-guide/v2`
- [`packages/brain/src/llm-capacity.js`](/workspace/packages/brain/src/llm-capacity.js)：
  新增三家容量快照、三组 poller、`chooseGuidedExecutor()`、`summarizeLlmCapacity()`、`sentinel`
- [`packages/brain/src/dispatcher.js`](/workspace/packages/brain/src/dispatcher.js)：
  在候选预检和真正触发前两处懒加载 `getLlmCapacitySnapshot()`，并把 `payload.allocation` 持久化回 `tasks.payload`
- [`packages/brain/src/routes/dispatch.js`](/workspace/packages/brain/src/routes/dispatch.js) 与 [`packages/brain/src/routes.js`](/workspace/packages/brain/src/routes.js)：
  新增只读诊断口 `GET /api/brain/dispatch/llm-capacity`

## 任务边界

本 sprint 文档只绑定当前仓库中已经出现的实现与验收口，不把未在本分支看到的外部动作写成已完成。

在范围内：

- 为当前任务 `b580b96e-74a5-4ce7-aabe-a776e4ac5c69` 补齐 sprint 文档产物
- 记录 PR #4133 所承载的当前代码事实：账本、三家 poller、`harness_initiative` 引导接入、L4 grok 兜底、只读容量口
- 明确哪些行为已有单测，哪些仍缺真实链路验证

不在范围内：

- 不修改 GitHub 上 PR #4133 的 title/body
- 不声称已完成真实外部 API 联调、真实 exhaustion 场景压测或真实调度长跑
- 不把旧任务 `a598772e` 的 grok relay 合同直接当成当前任务的实现说明

## Golden Path

1. Brain 拿到一个未显式指定 `payload.executor` / `payload.machine` 的 `dev` 或 `harness_initiative` 任务。
2. `dispatcher.js` 读取 slot budget，并按需拉取 `llm_capacity` 快照。
3. `applyDispatchAllocationGuide()` 复用既有引导员，把选择依据写进 `payload.allocation`。
4. `chooseGuidedExecutor()` 按四级续接顺序决定执行方：
   L1 `claude` 主路径，L2 `codex` 主路径，L3 跨厂商 fallback，L4 `grok` 兜底。
5. 选路结果回写 DB；若选中 `codex` 或 `grok`，顶层 `provider` 与 `payload.executor` 同步。
6. 运维可通过 `GET /api/brain/dispatch/llm-capacity` 读取当前容量账本与 `sentinel` 状态。

## 本次代码快照

### 刀0：PR 接手与任务重绑

- 代码实现仍挂在 `pr-4133` 血缘上的提交 `4658859d0`。
- 当前仓库中的旧 sprint 文档仍锚向 `a598772e`，这正是本任务要补的新文档缺口。
- 因为本次只允许写 `sprints/07212116-relay-b580b96e/`，PR body 的 GitHub 侧修正只能在仓库外完成，不能在本目录内伪装成代码完成。

### 刀1：llm_capacity 账本与三家 poller

- `claude`：通过 `getAccountUsage()` 聚合现有用量数据。
- `codex`：读取本机 `~/.codex-team1` 到 `~/.codex-team5` 的 `auth.json`，只使用 `access_token` 和 `account_id` 调用 `https://chatgpt.com/backend-api/wham/usage`。
- `grok`：只检查 `~/.grok/auth.json` 是否存在，作为只读可用性探针；当前代码没有写入、刷新或改写 `refresh_token`。
- 快照结果统一落成 `vendors + errors + sentinel + healthy + cache_ttl_ms` 结构。

### 刀3：四级续接

- `dispatch-allocation-guide.js` 已把 `harness_initiative` 纳入引导范围。
- `chooseGuidedExecutor()` 当前分级是真实代码，不是规划文本：
  - `L1_primary_claude`
  - `L2_primary_codex`
  - `L3_cross_vendor_fallback`
  - `L4_grok_fallback`
  - 全不可用时 `L4_fail_open`
- `dispatcher.js` 在预检和派发前都会应用引导员，避免只在候选阶段判定、真正触发时丢账本。

### 刀4：故障哨兵

- 本任务在调度容量侧新增的哨兵不是新的写口，而是 `llm_capacity` 快照内的 `sentinel` 字段与只读路由 `GET /api/brain/dispatch/llm-capacity`。
- `sentinel` 取值当前为：
  - `ok`：无 poller 错误且至少一家可用
  - `degraded`：存在 poller 错误
  - `exhausted`：无错误但所有厂商 `available_count=0`

## Invariant 约束

- 账本必须挂接现有 [`dispatch-allocation-guide.js`](/workspace/packages/brain/src/dispatch-allocation-guide.js)；不得另起第二套路由决策器。
- `GUIDED_TASK_TYPES` 的扩围必须以真实可派发类型为准；当前只允许 `dev` 与 `harness_initiative`，不得把无验证类型顺手带入。
- 对已有显式 `payload.executor` 或 `payload.machine` 的任务，必须保留调用方覆盖权。
- `payload.allocation` 必须可持久化回 `tasks.payload`，否则此功能只剩内存态、无法审计。
- `codex` poller 只读 `auth.json` 的 `access_token` / `account_id`；`grok` poller 只做 `auth.json` 存在性检查，不得写 token、不碰 `refresh_token`。
- `grok` 只允许作为 L4 兜底；不得在 `claude` 或 `codex` 可用时抢主路。
- `/api/brain/dispatch/llm-capacity` 只能是只读观测口，不承担改写容量、切换执行方或手工覆写哨兵的职责。

## 累积 FR

- FR1：引导员继续复用既有 `applyDispatchAllocationGuide()`，而不是改 `executor.js` 主判定路径。
- FR2：`harness_initiative` 与 `dev` 一样，能在无显式 executor 时写入 `payload.allocation`。
- FR3：`llm_capacity` 快照同时暴露 `claude`、`codex`、`grok` 三家容量视图。
- FR4：四级续接顺序已经落到 `chooseGuidedExecutor()`，并带 `continuation_level` / `reason`。
- FR5：`dispatcher.js` 会把引导结果持久化回 DB；选到 `codex` 或 `grok` 时还会同步顶层 `provider`。
- FR6：运维可以经 `GET /api/brain/dispatch/llm-capacity` 读取 `sentinel` 与各 vendor 摘要。

## NFR

- 读缓存：`llm_capacity` 快照缓存 TTL 为 60 秒，避免每次派发都打满外部接口。
- 外部调用时限：Codex usage API 请求超时为 8 秒，失败后按 `poll_error:*` 或 `http_*` 记账，不中断派发流程。
- 失败策略：dispatcher 获取快照失败时仅告警并 fail-open，不得把整个 dispatch loop 打死。
- 最小敏感面：代码只读本机凭据文件，不在日志中输出 token 值，不新增任何 refresh/writeback 流程。
- 低侵入回归：本任务不改已有显式 executor 路径；相关保护集中由现有单测覆盖。

## 风险与未完成项

- `llm-capacity.test.js` 主要验证选路纯函数，不是对真实 Claude/Codex/Grok 上游的在线验收。
- `/dispatch/llm-capacity` 路由已有单测，但当前目录下没有真实启动 Brain 后的 API 抓证。
- PR #4133 的 GitHub 侧旧 task id / 旧 body 漂移，需要在仓库外修正；本 sprint 文档只负责把 repo 内产物改绑到当前任务。

journey_type: autonomous
target_environment: local_api
