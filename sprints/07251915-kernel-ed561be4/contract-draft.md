# Sprint Contract Draft (Round 1)

## 合同边界

- PRD 是唯一功能边界；本合同不新增 telemetry schema、不改跨 run contract 继承语义、不执行生产数据库写入。
- 实现优先落在 `packages/brain/src/orchestrator/preflight*` 或 `packages/brain/src/orchestrator/capability-gate*`；`dispatcher/derive/loop` 只允许最小接线。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A — 本任务无新增 HTTP 响应；对外可观测契约是 capability snapshot、attempt 是否创建、结构化 failure_class / review 路由、告警和测试退出码。

Registry 读取结果：
- `api_registry`: 可用，但无本任务专属 HTTP schema；本合同不引入新端点。
- `db_registry`: 可用，现有 JSON/运行账本可承载 snapshot 与 failure 证据，优先复用既有表/列而非新 schema。
- `test_registry`: 可用，现有风格为 `vitest` + `describe/it`；新测试跟进此风格。

## 已知约束（来自回归测试与累积 FR）

- `[回归测试] packages/brain/src/orchestrator/__tests__/provider-registry.test.js` → `auto` 只能按 capability 选 provider，显式 provider 缺 capability 必须 fail-fast。
- `[回归测试] packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → proposer/generator/evaluator bundle 输入字段和分支推导是稳定契约，不能破坏 `contract_branch` / `propose_branch` 组装。
- `[回归测试] packages/brain/src/orchestrator/__tests__/derive.test.js` → product failure 默认走 `spawn:generator-fix`；merged/human review/no-progress 等终局路由不能回退。
- `[回归测试] packages/brain/src/__tests__/pre-flight-check.test.js` → preflight 现有失败/提示结构为 `{passed, issues, suggestions}`，并已有 insight constraint / retry 相关约束。
- `[回归测试] packages/brain/src/__tests__/task-tasks-preflight-revival.test.js` → `pre_flight_rejected`/blocked 相关状态和计数清理已有恢复路径，不能引入新账本分叉。
- `[回归测试] packages/brain/src/__tests__/executor-codex-review-preflight.test.js` → 配置/二进制缺失属于 preflight/config error，必须在 spawn 前阻断，不制造假失败回调。
- `[累积FR] context-manifest: unavailable`（2026-07-25 查询 `GET /api/brain/line/74d3dbc0-7f36-4422-9f7a-138cc66c0174/context-manifest` 返回 `Cannot GET`，故无额外 line 累积 FR 可继承）。

## 真实调用方请求 shape

本任务无新增 HTTP 调用方；真实调用方 shape 是 Brain 内核在派发前组装的结构化输入，必须逐字段保持现有调用形态，不得改成第二套 body/header 语义：

| 调用方 | 入口 | 真实字段/约束 |
|---|---|---|
| Kernel dispatcher | `packages/brain/src/orchestrator/dispatcher.js` `buildBundle()` + `dispatch()` | `inputs.task_id` / `inputs.sprint_dir` / `inputs.worktree_path` / `constraints.timeout_seconds` / `role_assignments.<role>.provider/account` |
| Provider 解析 | `packages/brain/src/orchestrator/provider-registry.js` `resolve({provider, requires})` | `provider='auto'` 时只按 capability 选 adapter；显式 provider 缺 capability 直接 throw |
| Attempt 创建 | `attemptStore.createAttempt(...)` | 仅在 preflight 通过后创建；失败时不得制造白跑 attempt |
| 路由判定 | `derive(observed)` | 只读 `observed.pr / evaluateVerdict / judgeVerdict / decisionLog` 等结构化证据；不得读 agent 自然语言 |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 在合同批准/attempt 启动前形成 server-owned capability snapshot，并在 provider auth、GitHub、PostgreSQL/测试依赖、外部模型能力缺失时结构化阻断与分类。 |
| **NFR（做得多好）** | 非功能需求 | preflight 必须有超时预算；网络瞬断允许有限重试；同签名重复失败受收敛闸限制；测试仅用注入依赖，不打真实外部服务。 |
| **Invariant（永不违反）** | 安全/一致性 | 不创建白跑 attempt；product failure 与 infrastructure/capability mismatch 不混流；不修改 telemetry schema 与跨 run contract 继承；不从自然语言猜状态。 |
| **判定点（怎么知道）** | 现实状态判断 | 见下方登记表。 |
| **保质期（何时过期）** | 数据/能力寿命 | capability snapshot 绑定当前合同/当前 dispatch 尝试；签名复用时以最近一次结构化 evidence 为准，跨 SHA/跨合同不得偷复用。 |
| **死亡告警（停了谁知道）** | 停止工作后的发现 | capability mismatch / infrastructure_blocked 必须落告警与结构化 failure_class；重复签名熔断后转人审。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | provider auth/GitHub/PG/model capability 缺失 → 阻断且不建 attempt；网络瞬断 → 有限重试；product assertion fail → 继续 generator-fix。 |
| **效果确认（已发≠已生效）** | 真实生效回执 | 以 `createAttempt` 是否发生、`observed`/decision log 中 capability snapshot 与 failure_class、路由动作和告警调用作为回执。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ provider/account 是否可用 | A. 读 agent 自然语言报错；B. preflight probe 返回结构化 auth/capability 结果 | B. 结构化 probe 结果 | PRD 明示“只使用结构化证据，不从自然语言猜状态” | 把环境故障误判成 product failure，进入错误 generator-fix 循环 |
| ⚠️ 合同能力与执行环境是否匹配 | A. 只看 provider 名；B. capability snapshot 与合同要求逐项比对 | B. 逐项 capability 比对 | provider 名本身不足以证明 PG/model/GitHub 可用 | 冻结合同与真环境冲突时仍白跑 attempt |
| 网络瞬断是否可重试 | A. 任意错误都重试；B. 仅 transient/network 类签名有限重试 | B. transient 签名有限重试 | PRD要求“网络瞬断可重试但同签名受收敛闸约束” | 无限重试耗尽 attempt 或过早转人审 |
| failure_class 应走哪条路由 | A. 统一 generator-fix；B. product vs infrastructure/capability mismatch 分流 | B. 分流 | 现有 derive 已把 product failure 视作 fix 路径 | product 修复被阻断或基础设施故障被错送 generator |

上述 4 个判定点均已在 PRD 中明确，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| provider 未登录 / auth probe 明确失败 | 标记 `infrastructure_blocked`，不创建 attempt | 是；同签名可去重 | 转人审并告警 |
| GitHub / PostgreSQL / 测试依赖 / 外部模型 capability 缺失 | 标记 capability mismatch，不进入 generator-fix | 是；同签名可去重 | 转人审并告警 |
| 网络瞬断 / probe timeout | 记录 transient 签名并有限重试 | 是 | 超过收敛闸后阻断并人审 |
| product assertion fail 且 snapshot 满足 | 继续既有 `spawn:generator-fix` | 是 | 不改变现有 fix 路由 |
| preflight 模块自身异常 | 视作基础设施阻断，不泄露凭据 | 是 | 告警并人审 |

### 输入对抗面

N/A — 本任务不新增对外 agent/API 输入面；只消费现有结构化 task payload、provider assignment 与注入依赖的 probe 结果。

## Golden Path

独立小路（无父路）

[冻结合同要求] → [server-owned capability snapshot] → [attempt 前结构化 preflight] → [缺能力阻断且不建 attempt] → [product / infrastructure 分流] → [瞬断有限重试与收敛闸] → [PR 保持 OPEN，版本/回归齐备]

### Step 1: 在合同批准后形成 server-owned capability snapshot

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、范围限定、验收 2。

**可观测行为**: 服务器基于冻结合同和执行分配生成 capability snapshot，至少列出 provider auth、GitHub、PostgreSQL/测试依赖、外部模型能力；snapshot 属于 Brain 自有账本，不依赖 agent 文本。

**验证命令**:
```bash
bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t 'server-owned capability snapshot'"
```

**硬阈值**: 测试 exit code = 0；snapshot 字段覆盖四类能力；结果写入既有 JSON/账本字段，不新增 telemetry schema。

### Step 2: 在 createAttempt 前执行有时限的结构化 capability preflight

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2-3 步、边界情况第 1-3 条、NFR 超时约束。

**可观测行为**: preflight 在 `attemptStore.createAttempt()` 之前运行；provider 未登录、GitHub 不可用、PostgreSQL/测试依赖缺失或模型 capability 不满足时，派发直接阻断，不创建白跑 attempt。

**验证命令**:
```bash
bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t 'createAttempt 前阻断'"
```

**硬阈值**: 测试 exit code = 0；`createAttempt` 调用次数 = 0；failure_class 为 `infrastructure_blocked` 或 capability mismatch；每个 probe 都受明确 timeout 约束。

### Step 3: provider auth / GitHub / PostgreSQL / model capability 缺失走基础设施或能力不匹配分类

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3-4 步、边界情况第 1-2 条。

**可观测行为**: 缺能力失败以结构化分类和缺口列表返回；controller/Kernel 不把这类失败归为 product failure，也不进入 generator-fix。

**验证命令**:
```bash
bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t 'capability mismatch 路由人审和告警'"
```

**硬阈值**: 测试 exit code = 0；路由结果是 `wait:human_review` 或等价人审/告警动作；`spawn:generator-fix` 调用次数 = 0。

### Step 4: product failure 保持既有 generator-fix 路由

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步、边界情况第 4 条、范围限定“失败分类与 generator-fix 分流”。

**可观测行为**: 当 capability snapshot 满足、真实问题属于产品断言失败时，系统仍按现有 product failure 路由进入 generator-fix，不误阻断。

**验证命令**:
```bash
bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t 'product failure 保持 generator-fix 路由'"
```

**硬阈值**: 测试 exit code = 0；derive/loop 结果维持 `spawn:generator-fix`；不产生 capability mismatch 告警。

### Step 5: 网络瞬断允许有限重试，但同签名重复失败受收敛闸约束

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步、边界情况第 3 条、验收 4。

**可观测行为**: transient/network probe 失败可按同一结构化签名有限重试；相同签名重复失败达到阈值后阻断，不无限派发。

**验证命令**:
```bash
bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t '同签名网络瞬断重试受收敛闸约束'"
```

**硬阈值**: 测试 exit code = 0；首次 transient 允许重试；重复同签名到阈值后返回 blocked/review；不会重复创建无限 attempt。

### Step 6: 测试只用注入依赖，且不改 contract 继承与 telemetry schema

**来源**: `[FROM_PRD]` — PRD 验收 5-6、范围限定“不修改跨 run contract 继承和 telemetry schema”。

**可观测行为**: 回归测试使用注入依赖伪造 auth/GitHub/PG/model probe，不访问真实外部服务；合同继承与 telemetry schema 相关文件保持不变。

**验证命令**:
```bash
bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t '不修改 contract 继承和 telemetry schema'"
```

**硬阈值**: 测试 exit code = 0；probe 依赖来自注入 mock/fake；受保护文件无新增 schema 变更。

### Step 7: Brain 源码变更保持版本账本同步，PR 保持 OPEN 等独立复审

**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 步、预期受影响文件、NFR 版本要求。

**可观测行为**: 生成器实现后必须更新 `DEFINITION.md`、`.brain-versions`、`VERSION` 与既有版本账本；PR 不自动 merge，正文保留根因、Red→Green、回归池、CI rollup、剩余风险。

**验证命令**:
```bash
bash -lc "cd /workspace && bash scripts/devgate/check-version-sync.sh"
```

**硬阈值**: 命令 exit code = 0；版本文件同步；不出现自动 merge 行为。

## 接缝清单

1. `dispatcher` / `attemptStore.createAttempt` ↔ capability preflight：必须先 preflight 后建 attempt，未通过时调用次数 = 0。
2. `provider-registry` / provider account home / auth probe ↔ capability snapshot：缺 capability 要用结构化缺口，不允许靠自然语言或 provider 名猜测。
3. `derive/loop` ↔ 人审/告警分流：capability mismatch 必须离开 generator-fix 路径，product failure 必须保留原 fix 路径。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/dispatcher.js` ↔ `attempt-store.js`（本单改的是“建 attempt 前”的接缝，测试必须真跑 dispatcher 逻辑并断言 createAttempt 是否被调用）。
- `packages/brain/src/orchestrator/dispatcher.js` ↔ `provider-registry.js`（显式 provider 缺 capability 的 fail-fast 不能被 mock 掉相邻模块语义）。
- `packages/brain/src/orchestrator/derive.js` / `loop.js` ↔ capability classification（本单改分流语义，测试必须跑真实 derive/loop，不可只 mock 最终 action 字符串）。
- 代码 ↔ 既有 JSON 账本字段（snapshot/failure evidence 必须复用现有列，不得以“假写入”替代真实持久化路径契约）。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| 真实 provider 登录态 / GitHub / PostgreSQL / 外部模型在线探测 | PRD 明确要求回归测试不得调用真实外部服务 | 通过注入依赖模拟结构化 probe 结果；上线前由运维/人工在真实环境做一次 smoke |
| 真实告警渠道送达 | 本单只要求结构化分类与告警调用，不要求外部通知链路 E2E | 保持现有告警模块契约，由独立告警 smoke 覆盖 |
| 最终 PR 正文内容 | proposer 只定义合同，不产出最终 PR | generator/report 阶段按合同补齐 |

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /workspace

npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts

bash scripts/devgate/check-version-sync.sh
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| capability gate 合同骨架 | `tests/capability-gate.contract.test.ts` | `server-owned capability snapshot`、`createAttempt 前阻断`、`capability mismatch 路由人审和告警`、`product failure 保持 generator-fix 路由`、`同签名网络瞬断重试受收敛闸约束`、`不修改 contract 继承和 telemetry schema` | 缺 `packages/brain/src/orchestrator/capability-gate.js` / 缺导出 / 缺接线路由时 Vitest Red |
