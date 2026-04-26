# Sprint Contract Draft (Round 2)

Sprint: Brain build-info 端点 + Harness 全 graph 闭环验证
PRD: `sprints/sprint-prd.md`

---

## Feature 1: GET /api/brain/build-info — 运行时身份指纹端点

**行为描述**:

Brain 进程暴露一个无需数据库依赖的 HTTP 端点 `GET /api/brain/build-info`。调用方一次拿到三个固定字段：当前 Brain 实例的 `version`、当前进程启动时刻 `build_time`、构建/部署期注入的 `git_sha`。三字段在同一进程生命周期内稳定（version、git_sha 不变；build_time 在进程启动时定一次，跨请求一致）。

**硬阈值**:

- HTTP 200 状态码
- 响应 `Content-Type` 含 `application/json`
- 响应 body 是合法 JSON 对象，包含 `version`、`build_time`、`git_sha` 三个 key
- 三字段值均为非空字符串（`length > 0`）
- `version` 等于 `packages/brain/package.json` 文件 `version` 字段的当前值
- 当 `process.env.GIT_SHA === undefined`（环境变量未设置）时，`git_sha === "unknown"`
- 当 `process.env.GIT_SHA === ""`（环境变量被注入为空字符串）时，`git_sha === "unknown"`（与 undefined 走同一降级分支）
- 当 `process.env.GIT_SHA = "abc123def"` 时，`git_sha === "abc123def"`
- `build_time` 匹配 ISO-8601 格式：`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/`
- 同一 router 实例的两次连续请求，`build_time` 字段严格相等（不承诺跨进程重启稳定，仅承诺单进程生命周期内稳定）
- 处理请求过程中绝不调用数据库（`db.query` 调用次数 = 0）
- 当 `package.json` 读取失败（fs 异常），返回 HTTP 500 + JSON body 含 `error` key（不是 HTML 错误页）

**BEHAVIOR 覆盖**（落在 `tests/ws1/build-info.test.ts`）:

- `it('GET / returns 200 with version, build_time, git_sha as non-empty strings')`
- `it('version field equals packages/brain/package.json version')`
- `it('git_sha is "unknown" when GIT_SHA env var is unset')`
- `it('git_sha is "unknown" when GIT_SHA env var is empty string')` — R3 mitigation：覆盖 `GIT_SHA=""` 的部分注入场景
- `it('git_sha equals process.env.GIT_SHA when env var is set')`
- `it('build_time is a valid ISO-8601 UTC string')`
- `it('build_time stays identical across two consecutive requests')`
- `it('handler never calls the database (db.query count = 0)')` — R1 mitigation：mock pool 强制断言无 DB 副作用
- `it('returns 500 with JSON error body when package.json read fails')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:

- 路由文件 `packages/brain/src/routes/build-info.js` 存在
- 路由文件 `import` 自 `express` 并 `export default` 一个 Router 实例
- `packages/brain/server.js` 含 `import` 语句引入 build-info 路由
- `packages/brain/server.js` 含 `app.use('/api/brain/build-info', ...)` 挂载语句

---

## Feature 2: SC-002 — Harness graph 闭环（运行时验证，非代码改动）

**说明**: 本 Initiative 自身的 task plan 经过 Harness graph（Phase A → inferTaskPlan → fanout → sub-graphs → join → final_e2e → END）执行的过程，本身就是 Sprint 1.x 闭环验证用例。该验证不产生新代码或新测试文件——由 Harness 编排器在执行本 task plan 时自然完成。SC-002 在 Harness Report 阶段由 `harness-report` skill 通过观察 graph 日志（无 fallback 拆分路径）确认。

**硬阈值**（由 Harness 运行时自动校验）:

- task_plan 在 graph 内完整执行，到达 END 节点
- Harness graph 日志中**精确不出现** `task_plan 缺失需外部拆分` 字符串（grep 命中即视为 SC-002 红灯）。这是 R2 mitigation 的可执行实现：在 `harness-report` 阶段对 graph stdout/stderr 整体执行 `grep -F 'task_plan 缺失需外部拆分'`，命中数必须为 0

**为什么不写代码或测试**: PRD「不在范围内」明确声明本 Initiative 不修改 graph 实现；fallback 兜底已在 commit `563388118`（fanout node fallback）合入。SC-002 是一次现成功能的验收性观察，不是新功能开发。

---

## Workstreams

workstream_count: 1

### Workstream 1: build-info 端点实现 + 挂载

**范围**:

- 新增 `packages/brain/src/routes/build-info.js`：Express Router，暴露 `GET /` handler，响应 `{version, build_time, git_sha}` JSON。`build_time` 在模块加载时计算（`new Date().toISOString()`）；`version` 来自 `packages/brain/package.json`；`git_sha` 来自 `process.env.GIT_SHA`，未设置时降级为 `"unknown"`。Handler 内 try/catch，异常时 `res.status(500).json({error: ...})`。
- 修改 `packages/brain/server.js`：新增一行 `import buildInfoRoutes from './src/routes/build-info.js'` 和一行 `app.use('/api/brain/build-info', buildInfoRoutes)`，挂载位置与现有 `/api/brain/manifest` 路由风格一致。

**大小**: S（PRD 预估 <100 行变更，实际新增约 30-50 行 + 2 行 server.js 修改）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/build-info.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/build-info.test.ts` | 200 + 三字段非空 / version 等于 package.json / git_sha 默认 unknown（unset）/ git_sha 默认 unknown（empty string）/ git_sha 读 env / build_time 是 ISO-8601 / build_time 跨请求稳定 / handler 不查 db / package.json 读失败返回 500 JSON | `npx vitest run sprints/tests/ws1/ --reporter=verbose` → 9 failures（模块不存在导致全部 it 块加载失败） |

**预期红原因**: 实现文件 `packages/brain/src/routes/build-info.js` 在 commit 1（合同测试落地）时尚未存在，测试文件 `import` 该路径会触发 `Failed to load url` 错误，所有 9 个 `it` 块均报红。这正是 TDD Red 阶段的标准信号。

---

## 跨 Workstream 一致性

- 所有 BEHAVIOR 测试均通过 `supertest` + 本地 `express` mini-app 挂载方式独立验证（与 `packages/brain/src/__tests__/routes/task-tasks.test.js` 同款模式），不依赖真实 Brain 服务进程
- 数据库通过 `vi.mock('../../../packages/brain/src/db.js', ...)` mock 成 reject-on-call pool，从而既阻断真实 DB 连接，又能断言"handler 没调用 db"
- `package.json` 读失败用 `vi.mock('node:fs', ...)` 的 spy 重写 `readFileSync` 路径分支

---

## Risks & Mitigations

> **Reviewer round-1 反馈处理**：上一轮 risk_registered = 3，目标 ≥ 7。本轮新增本独立栏目，登记 4 条具名 risk + 可执行 mitigation（每条都对应到测试断言或 Harness Report 阶段的 grep 命令，CI 红即拦截）。

### R1: build-info handler 意外触发数据库副作用（cascade）

- **风险描述**：build-info handler 实现时，若开发者顺手 `import` 了一个会在模块顶层副作用调用 `pool.query` 的文件（例如 `import './metrics.js'`，而 metrics.js 模块加载时就 `pool.query('SELECT ...')`），端点表面 200 但偷偷拖累 DB 连接池
- **Mitigation**：
  - 测试 `it('handler never calls the database (db.query count = 0)')` 用 `vi.mock` 把 db.js 替换成 reject-on-call pool（`mockPool.query` 一旦被调用即 reject + 断言失败）
  - 该测试位于 `sprints/tests/ws1/build-info.test.ts` line 134-143
  - CI 红即拦截：mockPool.query.mock.calls.length 必须严格为 0

### R2: 本 Initiative fanout 在 graph 中触发 fallback 拆分路径（fanout 退化）

- **风险描述**：本 Initiative 4 个 task 在 Harness graph 跑时，若 `inferTaskPlanNode` 因任何原因（task_plan 字段命名/格式漂移、planner 输出未持久化等）走到 `563388118` 的 fallback 路径，SC-002 表面通过（END 节点到达）但实际验证目标失效
- **Mitigation**：
  - Harness Report 阶段对 graph 的 stdout/stderr 整体 `grep -F 'task_plan 缺失需外部拆分'`
  - 命中数必须为 0；否则 SC-002 报红
  - 该 grep 命令在 SC-002 硬阈值段已落字面值

### R3: GIT_SHA 环境变量在不同启动方式下被部分注入（env 注入漂移）

- **风险描述**：`process.env.GIT_SHA` 可能被 docker-compose / pm2 / systemd / 本地 dev 以不同方式赋值，常见漂移是"未 export 时 undefined / `export GIT_SHA=` 时空字符串"，朴素实现 `process.env.GIT_SHA || 'unknown'` 能覆盖空串但 `process.env.GIT_SHA ?? 'unknown'` 不能
- **Mitigation**：
  - 硬阈值段显式分两条覆盖：`undefined → "unknown"` 和 `"" → "unknown"`，强制实现走 `||` 而非 `??`
  - BEHAVIOR 测试加 `it('git_sha is "unknown" when GIT_SHA env var is empty string')`，与 `it('git_sha is "unknown" when GIT_SHA env var is unset')` 并列两条独立 it 块，防止合并掩盖

### R4: 调用方误以为 build_time 跨进程重启稳定（语义漂移）

- **风险描述**：Dashboard 等上游集成方若把 build_time 当成"构建时刻"缓存到本地，进程重启后版本/SHA 不变但 build_time 变了，会触发误报"实例换了"
- **Mitigation**：
  - 合同硬阈值仅声明"同一 router 实例两次连续请求严格相等"，不承诺跨进程
  - 端点实现需在路由文件顶部加注释明确"build_time = 本进程启动时刻 ISO 字符串，跨重启会变化，调用方不应假设跨进程稳定"（实现侧，由 Generator 在 commit 2 落地）
  - 测试 `it('build_time stays identical across two consecutive requests')` 用 25ms sleep 强行打开"实现错误地每次重新计算 Date.now()"的窗口，把"按请求生成时间戳"的实现一捅就破

### Risk 登记数

- **本轮 risks_registered = 4**（R1-R4），覆盖 cascade / fanout 退化 / env 漂移 / 语义漂移四类正交风险面
- 每条 risk 都有可执行 mitigation（vitest it 块或 Harness grep），且 mitigation 入口在合同里有明确指针（line 号或 grep 字符串）
