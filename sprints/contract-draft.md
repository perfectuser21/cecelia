# Sprint Contract Draft (Round 1)

> 关联 PRD: [sprint-prd.md](./sprint-prd.md)
> Sprint: Brain Health 探针端点
> Proposer Round: 1
> Task ID: bb245cb4-f6c4-44d1-9f93-cecefb0054b3

本合同草案把 PRD 中的 User Stories / 功能需求 / 验收场景 / 边界情况切成**3 个独立 workstream**，每个 workstream 产出独立 PR。
Generator 阶段严格按本合同实现，实现完后合同测试必须全绿；合同外的任何东西一行不加。

---

## Feature 1: Health Payload 构造器（纯逻辑）

**行为描述**:
对外暴露一个纯函数，传入「当前毫秒时间戳、进程启动毫秒时间戳、版本字符串」，返回**严格三字段** `{status, uptime_seconds, version}` 对象。该函数不读数据库、不读外部 IO，除了一个可选的 `readBrainVersion()` 辅助（用于缺省参数场景下从 `packages/brain/package.json` 读取 version）之外，不触发任何副作用。`readBrainVersion()` 自身在 `package.json` 读取失败时必须返回字符串 `"unknown"`，不抛异常。

**硬阈值**:
- 返回对象的键集合**严格等于** `["status", "uptime_seconds", "version"]`（按任意顺序），无额外键
- `status` 字段始终为字符串字面量 `"ok"`
- `uptime_seconds` 为 `Math.floor((nowMs - startedAtMs) / 1000)`，且 `nowMs < startedAtMs` 时返回 `0`（不允许负数或 NaN）
- `version` 缺省时值 === `packages/brain/package.json` 当前 `version` 字段；`readFileSync` 抛错时 === `"unknown"`
- 函数体内不调用 `pool.query` / `fetch` / `child_process.spawn` / 任何网络或 DB API

**BEHAVIOR 覆盖**（这些会在 `tests/ws1/` 里落成真实 `it()` 块）:
- `it('buildHealthPayload 返回对象键集合严格等于 {status, uptime_seconds, version}')`
- `it('buildHealthPayload 返回的 status 恒等于字符串 "ok"')`
- `it('buildHealthPayload 以 Math.floor((now - startedAt)/1000) 计算 uptime_seconds')`
- `it('buildHealthPayload 在 now < startedAt 时返回 uptime_seconds === 0')`
- `it('buildHealthPayload 在 now === startedAt 时返回 uptime_seconds === 0')`
- `it('buildHealthPayload 在运行 3600500ms 后返回 uptime_seconds === 3600')`
- `it('readBrainVersion 读出 packages/brain/package.json 中的 version 值')`
- `it('readBrainVersion 在 package.json 读取抛错时返回字符串 "unknown" 且不抛出')`
- `it('buildHealthPayload 缺省参数调用时 version === package.json 的 version')`

**ARTIFACT 覆盖**（这些写进 `contract-dod-ws1.md`）:
- 文件 `packages/brain/src/health.js` 存在
- 该文件 export `buildHealthPayload` 符号
- 该文件 export `readBrainVersion` 符号
- 该文件 default export 一个 express Router（供 WS2 挂载使用）
- 该文件不 import `./db.js` 或 `pg`（无 DB 依赖）

---

## Feature 2: HTTP 端点 `GET /api/brain/health`（路由集成）

**行为描述**:
在 Brain Express 应用上挂载 `GET /api/brain/health`，请求该路径返回 HTTP 200、`Content-Type: application/json`、body 为 `{status, uptime_seconds, version}` 三字段 JSON。该路由不依赖 `pool`/`db.js`（即使数据库不可用也能响应 200）。在 `server.js` 里通过 `app.use('/api/brain/health', healthRouter)` 或等价注册代码挂载 WS1 产出的 router。

**硬阈值**:
- `GET /api/brain/health` 响应码严格等于 `200`
- `Content-Type` header 包含字符串 `application/json`
- 响应 body 能被 `JSON.parse`，解析后键集合**严格等于** `{status, uptime_seconds, version}`
- body.status 严格等于 `"ok"`
- body.version 严格等于 `packages/brain/package.json` 的 `version` 字段
- typeof body.uptime_seconds === `"number"` 且 `body.uptime_seconds >= 0`
- 5 个并发请求均返回 200，且每个响应 body 均满足上述 schema

**BEHAVIOR 覆盖**（这些会在 `tests/ws2/` 里落成真实 `it()` 块）:
- `it('GET /api/brain/health 返回 HTTP 200')`
- `it('GET /api/brain/health 响应 Content-Type 含 application/json')`
- `it('GET /api/brain/health 响应 body 键集合严格等于 {status, uptime_seconds, version}')`
- `it('GET /api/brain/health 响应 body.status 严格等于 "ok"')`
- `it('GET /api/brain/health 响应 body.version 严格等于 package.json 的 version')`
- `it('GET /api/brain/health 响应 body.uptime_seconds 是非负 number')`
- `it('GET /api/brain/health 5 个并发请求全部返回 200 且 body schema 正确')`

**ARTIFACT 覆盖**（这些写进 `contract-dod-ws2.md`）:
- `packages/brain/server.js` 含 `app.use('/api/brain/health', healthRouter)` 或 `app.get('/api/brain/health', ...)` 注册代码
- `packages/brain/server.js` 从 `./src/health.js` import health router（含 import 语句）

---

## Feature 3: 外部巡检脚本 + 文档登记（健康信号接入）

**行为描述**:
新增一个**独立的**健康巡检脚本 `packages/brain/scripts/health-probe.mjs`，接受环境变量 `HEALTH_URL` 指定目标 URL（默认 `http://localhost:5221/api/brain/health`），以 HTTP GET 请求该 URL。脚本读取响应后严格校验 schema（HTTP 200 + body 含三字段且 `status === "ok"`），校验通过则 `process.exit(0)`，任一条件不满足则 `process.exit(1)` 并在 stderr 输出具体失败原因。同时，`docs/current/README.md` 的「自动巡检状态（PATROL-REGISTRY）」表中新增一行登记该探针。

**硬阈值**（退出码精确契约，避免"无脑 exit 1 假实现"蒙混）:
- **exit 0** = healthy: HTTP 200 + body 严格含 `{status, uptime_seconds, version}` + `status === "ok"`
- **exit 1** = validation 失败: HTTP 非 200 / body schema 缺字段 / `status ≠ "ok"`
- **exit 2** = 连接失败: ECONNREFUSED / DNS 失败 / 请求超时
- `docs/current/README.md` 的「自动巡检状态」表中存在包含字符串 `/api/brain/health` 的行

**BEHAVIOR 覆盖**（这些会在 `tests/ws3/` 里落成真实 `it()` 块）:
- `it('health-probe 对合法 200 + 三字段响应退出码为 0')`
- `it('health-probe 对缺失 version 字段的响应退出码严格等于 1（validation 失败）')`
- `it('health-probe 对 HTTP 500 响应退出码严格等于 1（validation 失败）')`
- `it('health-probe 对 status=degraded 的响应退出码严格等于 1（validation 失败）')`
- `it('health-probe 对不可达 URL（ECONNREFUSED）退出码严格等于 2（连接失败）')`

**ARTIFACT 覆盖**（这些写进 `contract-dod-ws3.md`）:
- 文件 `packages/brain/scripts/health-probe.mjs` 存在且可执行
- `docs/current/README.md` 的「自动巡检状态」表新增含 `/api/brain/health` 的行

---

## Workstreams

workstream_count: 3

### Workstream 1: Health Handler 核心模块

**范围**:
- 新建 `packages/brain/src/health.js`
- 导出 `buildHealthPayload(opts?)` 纯函数 + `readBrainVersion()` 辅助函数
- default export 一个 express Router（GET `/` → 返回 `buildHealthPayload()` 结果）
- 模块内严禁 import `./db.js` / `pg` / 任何网络库

**大小**: S（<100 行实现代码）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/health-handler.test.ts`

### Workstream 2: HTTP 端点注册到 Brain Server

**范围**:
- 修改 `packages/brain/server.js`
- import WS1 产出的 health router
- 用 `app.use('/api/brain/health', healthRouter)` 注册路径
- 路由挂载点**必须在** `/api/brain/context` 等业务路由之前或同级位置（不依赖 DB 中间件）

**大小**: S（server.js 改动 <10 行）
**依赖**: Workstream 1 完成后
**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/health-endpoint.test.ts`

### Workstream 3: 巡检脚本 + 文档登记

**范围**:
- 新建 `packages/brain/scripts/health-probe.mjs`（Node.js ESM 脚本，仅用标准库 `node:http`/`node:https`，不引入第三方依赖）
- 更新 `docs/current/README.md` 在「自动巡检状态」表新增一行

**大小**: S（脚本 <80 行 + 文档 1 行）
**依赖**: 无（脚本本身不依赖 WS1/WS2 的实现文件；合同测试通过本地 http.Server mock 验证脚本行为）
**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws3/selfcheck-probe.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 数） | 预期红证据（Proposer 本地实测） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/health-handler.test.ts` | 9 | `npx vitest run sprints/tests/ws1/` → **9 failed / 9 total**（buildHealthPayload 返回空对象、readBrainVersion 返回空串、uptime/status/version 三字段断言均 AssertionError） |
| WS2 | `sprints/tests/ws2/health-endpoint.test.ts` | 7 | `npx vitest run sprints/tests/ws2/` → **7 failed / 7 total**（stub router 无 handler，supertest 打到 `/api/brain/health` 返回 404，status/content-type/body schema/并发断言均 FAIL） |
| WS3 | `sprints/tests/ws3/selfcheck-probe.test.ts` | 5 | `npx vitest run sprints/tests/ws3/` → **5 failed / 5 total**（stub 脚本 exit 99，与精确契约 0/1/2 全部不匹配） |

**Red 合计**: 3 个文件 × 21 个 it() → 实测 21/21 FAIL，符合"FAIL ≥ it 数"硬门槛。

---

## Proposer 本地 Red 执行证据（Step 2d）

Red evidence 采集方式：Proposer 在 Red 阶段临时创建 `packages/brain/src/health.js`（空实现 stub）与 `packages/brain/scripts/health-probe.mjs`（exit 99 stub），让 vitest 能加载测试文件并产生**单 it 级别**的 FAIL 行（而非 suite 级 import error）。stub **在本 commit 中已删除**——提交体只含 sprint 合同产物。Generator 在 Green 阶段从零创建这两个文件的真实实现。

实测运行摘要（sprints/tests/_red-evidence/ws{1,2,3}-red.log，不入仓库）：

```
ws1-red.log → Test Files  1 failed (1) | Tests  9 failed (9)
ws2-red.log → Test Files  1 failed (1) | Tests  7 failed (7)
ws3-red.log → Test Files  1 failed (1) | Tests  5 failed (5)
```

测试 Mutation 强度自检（防止假实现蒙混）:

- WS1 每个 it 使用**具体值**断言（`.toBe(3600)` / `.toBe("ok")` / `.toEqual(['status','uptime_seconds','version'])`），fake 实现返回 `{}` 或 `''` 均无法蒙混
- WS2 对 HTTP 200/Content-Type/body schema 分别独立断言，空 router / 仅挂不返 JSON 的 handler 都能被揪出
- WS3 采用 **exit 0/1/2 精确退出码契约**，避免"脚本无脑 `process.exit(1)`"恰好让"非零"断言变绿的 false positive
