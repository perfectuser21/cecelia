# Sprint PRD — Harness v6 Reviewer Alignment 真机闭环（载体：GET /api/brain/time 最小端点）

**Task ID**: 2303a935-3082-41d9-895e-42551b1c5cc4
**Initiative ID**: 2303a935-3082-41d9-895e-42551b1c5cc4
**Sprint Dir**: sprints
**生成时间**: 2026-04-23

## OKR 对齐

- **对应 KR**：Harness v6（Reviewer 哲学对齐 + GAN MAX_ROUNDS 硬 cap）GA 闭环验证方向的 KR
- **当前进度**：[ASSUMPTION: `curl localhost:5221/api/brain/context` 在当前执行环境内不可达；Step 0 上下文采集失败，以最近合入的 #2547（Reviewer rubric + skeptical persona）与 #2546（cascade middleware）为基线]
- **本次推进预期**：本 Initiative 并非新增业务能力，而是 Harness v6（Reviewer alignment + MAX_ROUNDS 硬 cap）哲学改造后的首次真机端到端闭环验证；预期推进 Harness v6 GA KR 5-10%。
- **说明**：真正的交付价值在于走通 Planner → Proposer/Reviewer GAN 对抗（1-3 轮 APPROVED） → B_task_loop → 子 Task 派 Generator → 子 PR 合并 → runPhaseCIfReady → Final E2E → phase=done 的完整链路。时间端点只是验证载体，必须保持最小实现，避免把验证焦点从流水本身转移到业务细节。

## 背景

Harness v6 近期合入两件事：
1. **#2547**：GAN MAX_ROUNDS 硬 cap（默认 5 轮）+ Reviewer rubric（5 维 0-10 分）+ skeptical persona，对齐 Anthropic "5-15 迭代硬上限 + 每维硬阈值" 的原则。
2. **#2546**：cascade middleware 填充 opts.cascade 供 account-rotation 使用。

改造的直接诱因是 Initiative 2303a935 在 v5 框架下卡在 Round 10、Reviewer 无限 micro-revision、合同从 108 行膨胀到 216 行 anti-fraud 元数据。v6 的 Reviewer 哲学从"防测试作弊"转向"spec 对齐用户真需求 + 可量化 criteria + happy/error/boundary 全覆盖"。

现在需要一次真机闭环验证：Planner 拆 Task DAG → Proposer/Reviewer 在 1-3 轮内 APPROVED（而非撞硬 cap）→ B_task_loop 自动派 Generator → 子 PR 合并 → Final E2E → phase=done，全链路无人工介入。

选用"新增 `GET /api/brain/time` 端点"作为验证载体，理由：
- 范围极小，单 Task 估时 20-30 分钟可完成；
- 无外部依赖（无 DB schema 变更、无新包、无新权限）；
- 响应结构固定 `{iso, timezone, unix}`，便于 DoD 的 [BEHAVIOR] 测试精确断言；
- 与 Brain 现有 `packages/brain/src/routes/*.js` 目录结构完全一致，新增一个 route 文件即可挂载；
- 验收天然是"三字段一致性 + 200 OK"，对 Reviewer 的新哲学（可量化）是理想试金石。

## 目标

让调用方通过 `GET /api/brain/time` 获取 Brain 进程的当前时间信息，一次返回 ISO 8601 字符串、IANA 时区标识、Unix 时间戳三个字段；并通过该端点的 PR 流水走通 Harness v6 完整闭环。

## User Stories

**US-001**（P0）：作为 **Harness 流水调用方**，我希望 `GET /api/brain/time` 返回当前时间的 ISO / 时区 / Unix 三元组，以便在 agent 侧做时间对齐和日志标注。

**US-002**（P0）：作为 **运维/巡检脚本**，我希望该端点稳定可用（200 OK + 固定 JSON schema），以便作为 Brain 存活探针和时钟偏移探测点使用。

**US-003**（P0）：作为 **Harness v6 守护者**，我希望本 Initiative 在 Reviewer 新哲学（5 维 rubric + skeptical persona + MAX_ROUNDS=5）下于 ≤ 3 轮 GAN 内达成 APPROVED（而非撞硬 cap forcedApproval），以此证明哲学改造有效、Reviewer 不再陷入 micro-revision 死循环。

## 验收场景（Given-When-Then）

**场景 1**（US-001 — 成功返回时间三元组）：
- Given Brain 进程已启动并监听 5221 端口
- When 调用 `GET http://localhost:5221/api/brain/time`
- Then 响应 HTTP 200，Content-Type `application/json`
- And 响应 body 为 JSON 对象，包含恰好三个顶层字段 `iso`、`timezone`、`unix`
- And `iso` 为合法 ISO 8601 字符串（可被 `new Date(iso)` 解析且 `!isNaN(d.getTime())`）
- And `timezone` 为非空字符串（IANA 时区标识，例如 `Asia/Shanghai` 或 `UTC`）
- And `unix` 为正整数（秒级 Unix 时间戳）

**场景 2**（US-002 — 时间值一致性）：
- Given 在同一次响应里
- When 解析 `iso` 得到 Date 对象 D
- Then `Math.floor(D.getTime()/1000) === unix` 成立（允许 ±1 秒漂移）

**场景 3**（US-002 — 幂等可重复调用 & 单调性）：
- Given 连续两次调用该端点（前后间隔 ≥ 0 秒）
- When 两次响应均为 200
- Then 两次响应的 `timezone` 字段完全一致
- And 两次 `unix` 的差值 ≥ 0（单调不减）

**场景 4**（US-003 — Harness v6 真机闭环）：
- Given 本 Initiative 的 Planner PRD 已产出并入库
- When 进入 Phase A GAN（Proposer/Reviewer）
- Then 在 MAX_ROUNDS=5 范围内以 `verdict=APPROVED`（非 `forcedApproval=true`）收敛
- And Phase A → B_task_loop → Final E2E → `phase=done` 全链路无人工介入
- And Final E2E 中 `curl localhost:5221/api/brain/time` 响应通过场景 1/2/3 断言

## 功能需求

- **FR-001**: 在 Brain 注册新路由 `GET /api/brain/time`（挂载到既有 `/api/brain` 前缀下）。
- **FR-002**: 响应 body 为 JSON 对象，**恰好**包含 `iso`（ISO 8601 字符串）、`timezone`（IANA 字符串）、`unix`（整数秒）三个顶层字段，且无其他多余字段。
- **FR-003**: 该端点无需鉴权、无 query/body 参数、幂等可重复调用、响应时间 < 100ms（进程内运算）。
- **FR-004**: 该端点具备独立单元测试覆盖，断言三字段 shape 与 iso/unix 一致性。
- **FR-005**: 在 `docs/current/SYSTEM_MAP.md` 或等价 Brain 路由目录文档中新增 `/api/brain/time` 条目，含一句话说明。

## 成功标准

- **SC-001**: `curl -s localhost:5221/api/brain/time` 返回 HTTP 200 且响应可被 `JSON.parse` 成功解析，顶层 keys 严格等于 `["iso","timezone","unix"]`。
- **SC-002**: 响应对象三字段类型与场景 1 的断言全部通过；场景 2/3 的一致性/单调性全部通过。
- **SC-003**: Brain CI（brain-ci.yml）在该分支上绿，新增单元测试 PASS。
- **SC-004**: Harness v6 Initiative 2303a935 从 Planner → Final E2E → `phase=done` 全链路无人工介入完成；Phase A GAN 在 ≤ 3 轮内以 `verdict=APPROVED`（非 forcedApproval）收敛。

## 假设

- [ASSUMPTION: Brain 路由文件位于 `packages/brain/src/routes/*.js`，采用 `import { Router } from 'express'` + `router.get(...)` + `export default router` 的模式，与 `status.js` 一致]
- [ASSUMPTION: 主入口在 `packages/brain/src/server.js`（或 `packages/brain/server.js`），以 `import xxxRoutes from './routes/xxx.js'` + `app.use('/api/brain', xxxRoutes)` 形式注册子路由]
- [ASSUMPTION: Brain 默认时区读取 `process.env.TZ`，若未设置则 fallback 到 `Intl.DateTimeFormat().resolvedOptions().timeZone`，保证 `timezone` 字段始终非空]
- [ASSUMPTION: 单元测试与既有 `packages/brain/src/__tests__/` 保持相同技术栈（Generator 按 repo 现状选择 node --test / jest / vitest），不引入新依赖]
- [ASSUMPTION: `docs/current/SYSTEM_MAP.md` 存在且含有一个"Brain API 路由列表"或等价小节可供追加；若不存在，回退追加到 `packages/brain/README.md`]

## 边界情况

- **时区未配置**：`process.env.TZ` 不存在时，`timezone` 字段必须为非空字符串（通过 Intl API 兜底），不得返回空串 / `null` / `undefined`。
- **闰秒/时钟跳变**：同一次响应内 `iso` 与 `unix` 允许 ≤ 1 秒偏差（见场景 2），测试断言用 `Math.abs(floor(iso_ms/1000) - unix) <= 1`。
- **并发**：端点无状态，不需要并发控制；多请求串行/并行返回结果互不影响。
- **响应 schema 严格**：多返回或少返回字段均视为违反 FR-002，测试必须断言 `Object.keys(body).sort()` 严格等于 `["iso","timezone","unix"]`。

## 范围限定

**在范围内**:
- 新增 `GET /api/brain/time` 路由（handler 文件 + server 注册 + 单元测试）。
- 在 `docs/current/SYSTEM_MAP.md`（或 Brain README）路由表追加一行。

**不在范围内**:
- 鉴权 / 限流 / 缓存中间件。
- 时区切换、用户级时区偏好、历史时间查询。
- 前端消费方改造、dashboard 接入。
- 任何与 `/time` 无关的 Brain 路由重构、依赖升级。
- Harness v6 框架本身的改动（rubric / MAX_ROUNDS 已在 #2547 合入，本 Initiative 只作为被它调度的 payload）。

## 预期受影响文件

- `packages/brain/src/routes/time.js`：新增 — route handler 实现（handler 函数 + Router export）。
- `packages/brain/src/server.js` 或 `packages/brain/server.js`：修改 — 新增一行 `import timeRoutes from './routes/time.js'` + 一行 `app.use('/api/brain', timeRoutes)` 或等价注册。
- `packages/brain/src/__tests__/time.test.js`：新增 — 单元测试，覆盖 shape / 一致性 / 单调性三个场景。
- `docs/current/SYSTEM_MAP.md`（或 `packages/brain/README.md` fallback）：修改 — Brain API 路由表追加一行 `GET /api/brain/time → {iso,timezone,unix}`。
