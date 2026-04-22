# Sprint Contract Draft (Round 1)

> Initiative: Harness v6 Reviewer Alignment 哲学真机闭环
> PRD: `sprints/sprint-prd.md`
> Propose round: 1
> Task ID: 2303a935

本合同把 PRD 的 5 个 Given-When-Then 场景拆为 4 个 Feature，再切 4 个独立可测试 Workstream。BEHAVIOR 覆盖（跑起来看行为）放 `sprints/tests/ws{N}/*.test.ts`；ARTIFACT 覆盖（静态产物）放 `sprints/contract-dod-ws{N}.md`。

---

## Feature 1: `/iso` 端点 + HTTP 服务骨架 + 404/405 兜底

**行为描述**:
进程启动后对 `127.0.0.1` 监听指定端口（默认 18080，`PORT` 环境变量可覆盖）。`GET /iso` 返回 HTTP 200，Body 为 JSON 对象，含 `iso` 字段，值为当前 UTC 时刻的 ISO 8601 字符串（毫秒精度、`Z` 结尾）。任意未知路径返回 HTTP 404 + `{"error":"not_found"}`。任意非 GET 方法返回 HTTP 405 + `{"error":"method_not_allowed"}`。所有响应 `Content-Type: application/json`。

**硬阈值**:
- `GET /iso` status code == 200
- Body.iso 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`
- Body.iso 对应的毫秒时间戳与 `Date.now()` 差 ≤ 5000 ms
- 响应头 `content-type` 包含 `application/json`
- `GET /unknown-path-xyz` status == 404，Body == `{"error":"not_found"}`
- `POST /iso` status == 405，Body == `{"error":"method_not_allowed"}`
- `createServer(0)` 解析为正在监听的 `http.Server`，`server.address().port` 为正整数

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/iso.test.ts`）:
- `it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式')`
- `it('GET /iso 的 Content-Type 为 application/json')`
- `it('GET /iso 的 iso 字段对应时间与现在相差不超过 5 秒')`
- `it('GET /unknown-xyz 返回 404 且 body 为 {error:not_found}')`
- `it('POST /iso 返回 405 且 body 为 {error:method_not_allowed}')`
- `it('createServer(0) 返回已监听的 server，address().port 为正整数')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws1.md`）:
- `scripts/harness-dogfood/time-api.js` 文件存在
- 该文件 `module.exports` 包含 `createServer`
- 该文件含字符串字面量 `'/iso'`、`not_found`、`method_not_allowed`
- 该文件含 `PORT` 环境变量读取逻辑
- 该文件 `require.main === module` 分支存在（支持 `node time-api.js` 直接启动）

---

## Feature 2: `/timezone` 端点

**行为描述**:
`GET /timezone` 返回 HTTP 200，Body 为 JSON 对象含 `timezone` 字段，值为当前进程解析的 IANA 时区名（例如 `Asia/Shanghai`、`UTC`）。字段必为非空字符串。

**硬阈值**:
- `GET /timezone` status == 200
- Body.timezone 为 string 类型
- Body.timezone.length > 0
- 响应头 `content-type` 包含 `application/json`

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws2/timezone.test.ts`）:
- `it('GET /timezone 返回 200 且 timezone 字段为非空字符串')`
- `it('GET /timezone 的 timezone 字段等于 Intl.DateTimeFormat().resolvedOptions().timeZone 或 UTC')`
- `it('GET /timezone 的 Content-Type 为 application/json')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws2.md`）:
- `scripts/harness-dogfood/time-api.js` 含字符串字面量 `'/timezone'`
- 该文件含 `Intl.DateTimeFormat` 调用

---

## Feature 3: `/unix` 端点

**行为描述**:
`GET /unix` 返回 HTTP 200，Body 为 JSON 对象含 `unix` 字段，值为当前 Unix 秒级时间戳（正整数）。字段值与调用方当前系统秒级时间戳差 ≤ 5 秒。

**硬阈值**:
- `GET /unix` status == 200
- Body.unix 为 number 类型
- Number.isInteger(Body.unix) == true
- Body.unix > 0
- `Math.abs(Body.unix - Math.floor(Date.now()/1000)) <= 5`
- 响应头 `content-type` 包含 `application/json`

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws3/unix.test.ts`）:
- `it('GET /unix 返回 200 且 unix 字段为正整数')`
- `it('GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒')`
- `it('GET /unix 的 Content-Type 为 application/json')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws3.md`）:
- `scripts/harness-dogfood/time-api.js` 含字符串字面量 `'/unix'`
- 该文件含对 `Date.now()` 的使用

---

## Feature 4: E2E 冒烟脚本 + README

**行为描述**:
`scripts/harness-dogfood/e2e.sh` 是可执行 bash 脚本，接受环境变量 `PORT`（默认 18080）指向一个已启动的 time-api 服务。脚本按顺序访问 `/iso`、`/timezone`、`/unix` 三个端点，全部通过格式/取值校验则 `exit 0`；任一校验失败则 `exit` 非 0 并输出错误摘要到 stderr。`README.md` 说明如何用 `node scripts/harness-dogfood/time-api.js` 启动、如何跑 e2e.sh。

**硬阈值**:
- 启动 time-api.js 后运行 `bash scripts/harness-dogfood/e2e.sh` 的 exit code == 0
- 停掉 time-api.js（端口空闲）后运行 `bash scripts/harness-dogfood/e2e.sh` 的 exit code != 0
- e2e.sh 文件可执行（权限位含 `x`）
- README.md 含"启动"和"E2E"两个章节关键字

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws4/e2e.test.ts`）:
- `it('服务已启动时运行 e2e.sh 以 exit code 0 退出')`
- `it('服务未启动时运行 e2e.sh 以非 0 exit code 退出')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws4.md`）:
- `scripts/harness-dogfood/e2e.sh` 文件存在
- e2e.sh 文件权限含 `x`（可执行）
- e2e.sh 含对 `/iso`、`/timezone`、`/unix` 三个路径的引用
- `scripts/harness-dogfood/README.md` 文件存在
- README 含 `node scripts/harness-dogfood/time-api.js` 启动命令
- README 含 `bash scripts/harness-dogfood/e2e.sh` 或等价 E2E 调用说明

---

## Workstreams

workstream_count: 4

### Workstream 1: HTTP server 骨架 + `/iso` + 404/405

**范围**: 新建 `scripts/harness-dogfood/time-api.js`，导出 `createServer(port): Promise<http.Server>` 和 `handler(req, res)` 两个函数；含 `/iso` 路由；未知路径返回 404 `{error:not_found}`；非 GET 方法返回 405 `{error:method_not_allowed}`；`require.main === module` 时读取 `PORT` 环境变量（默认 18080）并启动。

**大小**: S（单文件约 50-70 行）

**依赖**: 无（基础骨架）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/iso.test.ts`

### Workstream 2: `/timezone` 端点

**范围**: 修改 `scripts/harness-dogfood/time-api.js`，在 handler 中为 `/timezone` 路径返回 `{timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`。

**大小**: S（diff 约 5-10 行）

**依赖**: WS1（需要 handler 骨架存在）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/timezone.test.ts`

### Workstream 3: `/unix` 端点

**范围**: 修改 `scripts/harness-dogfood/time-api.js`，在 handler 中为 `/unix` 路径返回 `{unix: Math.floor(Date.now()/1000)}`。

**大小**: S（diff 约 5-10 行）

**依赖**: WS1（需要 handler 骨架存在）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws3/unix.test.ts`

### Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，三端点校验）+ `scripts/harness-dogfood/README.md`（启动 + E2E 说明）。

**大小**: S（e2e.sh 约 40 行 + README 约 30 行）

**依赖**: WS1 + WS2 + WS3（E2E 需三个端点全部在线）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws4/e2e.test.ts`

---

## Test Contract

| Workstream | Test File | it() 数 | 预期红证据（Round 1 本地观测） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/iso.test.ts` | 6 | `npx vitest run sprints/tests/ws1/` → Test Files 1 failed，beforeAll `await import('.../time-api.js')` 抛 ERR_MODULE_NOT_FOUND，6 个 it 全部 skipped |
| WS2 | `sprints/tests/ws2/timezone.test.ts` | 3 | `npx vitest run sprints/tests/ws2/` → Test Files 1 failed，ERR_MODULE_NOT_FOUND，3 个 it 全部 skipped |
| WS3 | `sprints/tests/ws3/unix.test.ts` | 3 | `npx vitest run sprints/tests/ws3/` → Test Files 1 failed，ERR_MODULE_NOT_FOUND，3 个 it 全部 skipped |
| WS4 | `sprints/tests/ws4/e2e.test.ts` | 2 | `npx vitest run sprints/tests/ws4/` → Test Files 1 failed，beforeAll 主动 throw `E2E script missing`，2 个 it 全部 skipped |

**全量本地跑**: `npx vitest run sprints/tests/` → `Test Files 4 failed (4) / Tests 14 skipped (14)`。总计 4 个 test 文件 / 14 个 it() 块 / 14 个 Red（suite-level FAIL + test-level SKIP）。

**Green 判据**: Generator 把 `scripts/harness-dogfood/time-api.js` 与 `scripts/harness-dogfood/e2e.sh` 实现后，同命令应输出 `Test Files 4 passed / Tests 14 passed`。

---

## 合同外不做（CONTRACT IS LAW 边界）

根据 PRD "不在范围内"章节，Generator 不得实现：鉴权 / HTTPS / CORS / 日志系统 / 指标 / 写接口 / 持久化 / Brain 注册 / Docker。

对 PRD"预期受影响文件"中列出的 `scripts/harness-dogfood/__tests__/*.test.js` 四个文件：**不纳入本合同范围**。理由：本合同的 BEHAVIOR 验证已统一归集到 `sprints/tests/ws{N}/*.test.ts`（Harness v6 合同测试标准位置）。重复在 `__tests__/` 维护等价测试会造成断言漂移，违反 "一个行为一份断言"。如 Reviewer 认为 PRD 强制该路径，可在对抗轮提出，本轮不主动创建。
