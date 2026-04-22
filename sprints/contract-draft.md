# Sprint Contract Draft (Round 2)

> Initiative: Harness v6 Reviewer Alignment 哲学真机闭环
> PRD: `sprints/sprint-prd.md`
> Propose round: 2
> Task ID: 2303a935
> 上轮判决: REVISION（6 个风险 / 3 阻断 + 3 正确性）

本轮修订依然把 PRD 的 5 个 Given-When-Then 场景拆为 4 个 Feature、4 个 Workstream；BEHAVIOR 覆盖落在 `sprints/tests/ws{N}/*.test.ts`（SSOT），ARTIFACT 覆盖落在 `sprints/contract-dod-ws{N}.md`。本轮针对 Reviewer 的 6 个风险做了 **逐条修订**，详见末尾 `## 风险处置记录（Round 1 → Round 2）`。

---

## Feature 1: `/iso` 端点 + HTTP 服务骨架 + 404/405 + `routes` 锚点契约

**行为描述**:
进程启动后对 `127.0.0.1` 监听指定端口（默认 `18080`，`PORT` 环境变量可覆盖）。`GET /iso` 返回 HTTP 200，Body 为 JSON 对象，含 `iso` 字段，值为当前 UTC 时刻的 ISO 8601 字符串（毫秒精度、`Z` 结尾）。任意未知路径返回 HTTP 404 + `{"error":"not_found"}`。任意非 GET 方法返回 HTTP 405 + `{"error":"method_not_allowed"}`。所有响应 `Content-Type: application/json`。

模块导出 `createServer(port): Promise<http.Server>` 与 `routes: Record<string, (req, res) => void>` 两个稳定 API。`routes` 是 **append-only 锚点**（后续 WS 的唯一变更点，见 `## 合并顺序与变更隔离`），WS1 结束时 `routes` 仅含 `'/iso'` 一个 key。

**硬阈值**:
- `GET /iso` status code == 200
- Body.iso 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`
- Body.iso 对应毫秒时间戳与 `Date.now()` 差 ≤ 5000 ms
- 响应头 `content-type` 包含 `application/json`
- `GET /unknown-xyz` status == 404，Body == `{"error":"not_found"}`
- `POST /iso` status == 405，Body == `{"error":"method_not_allowed"}`
- `createServer(0)` 返回 `http.Server` 且已监听（`server.address().port` 为正整数）
- `module.exports.routes` 为对象，含 `'/iso'` 键，且值为 function；WS1 阶段不包含 `'/timezone'` / `'/unix'`

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/iso.test.ts`）:
- `it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式')`
- `it('GET /iso 的 Content-Type 为 application/json')`
- `it('GET /iso 的 iso 字段对应时间与当前时间相差不超过 5 秒')`
- `it('GET /unknown-xyz 返回 404 且 body 为 {error:"not_found"}')`
- `it('POST /iso 返回 405 且 body 为 {error:"method_not_allowed"}')`
- `it('createServer(0) 返回已监听的 server，address().port 为正整数')`
- `it('routes 对象导出：WS2/3/4 的 append-only 锚点契约（WS1 阶段只有 /iso）')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws1.md`）:
- `scripts/harness-dogfood/time-api.js` 文件存在
- 该文件导出 `createServer` 函数
- 该文件导出 `routes` 对象（append-only 锚点）
- 该文件含字符串字面量 `'/iso'`、`not_found`、`method_not_allowed`
- 该文件含 `process.env.PORT` 读取逻辑
- 该文件含 `require.main === module` 直跑分支
- 该文件不依赖任何非 Node 内置模块（SC-006）
- PRD 兼容层：`scripts/harness-dogfood/__tests__/iso.test.js` 存在（文件级占位，细节见 `## PRD 兼容层约定`）
- PRD 兼容层：`scripts/harness-dogfood/__tests__/not-found.test.js` 存在

---

## Feature 2: `/timezone` 端点

**行为描述**:
`GET /timezone` 返回 HTTP 200，Body 为 JSON 对象，含 `timezone` 字段，值为当前进程解析的 IANA 时区名，等于 `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`。实现上在 `routes` 对象中追加 `'/timezone'` 键（不得修改 WS1 已有分发骨架）。

**硬阈值**:
- `GET /timezone` status == 200
- Body.timezone 为 string 且 length > 0
- Body.timezone **严格等于** `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`（见风险 R4 修订）
- 响应头 `content-type` 包含 `application/json`
- `module.exports.routes['/timezone']` 为 function

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws2/timezone.test.ts`）:
- `it('GET /timezone 返回 200 且 timezone 字段为非空字符串')`
- `it('GET /timezone 返回的 timezone 等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）')`
- `it('GET /timezone 的 Content-Type 为 application/json')`
- `it('routes["/timezone"] 为 handler 函数（WS2 在 WS1 骨架上 append-only 追加）')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws2.md`）:
- time-api.js 含 `'/timezone'` 路由字符串
- time-api.js 含 `Intl.DateTimeFormat` 调用
- time-api.js 含 `timezone` 响应字段名
- PRD 兼容层：`scripts/harness-dogfood/__tests__/timezone.test.js` 存在

---

## Feature 3: `/unix` 端点

**行为描述**:
`GET /unix` 返回 HTTP 200，Body 为 JSON 对象，含 `unix` 字段，值为当前 Unix 秒级时间戳（`Math.floor(Date.now()/1000)`），正整数。实现上在 `routes` 对象中追加 `'/unix'` 键。

**硬阈值**:
- `GET /unix` status == 200
- Body.unix 为 number 且 `Number.isInteger(Body.unix)` 为 true
- Body.unix > 0
- `Math.abs(Body.unix - Math.floor(Date.now()/1000)) <= 5`
- Body.unix **不是毫秒级**（通过 `Body.unix < nowSec * 100` 证伪毫秒实现）
- 响应头 `content-type` 包含 `application/json`
- `module.exports.routes['/unix']` 为 function

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws3/unix.test.ts`）:
- `it('GET /unix 返回 200 且 unix 字段为正整数')`
- `it('GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒')`
- `it('GET /unix 的 unix 字段不是毫秒级（不应比当前秒时间戳大三位数以上）')`
- `it('GET /unix 的 Content-Type 为 application/json')`
- `it('routes["/unix"] 为 handler 函数（WS3 在 WS1 骨架上 append-only 追加）')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws3.md`）:
- time-api.js 含 `'/unix'` 路由字符串
- time-api.js 含 `Math.floor(Date.now()/1000)` 秒级转换
- time-api.js 含 `unix` 响应字段名
- PRD 兼容层：`scripts/harness-dogfood/__tests__/unix.test.js` 存在

---

## Feature 4: E2E 冒烟脚本 + README

**行为描述**:
`scripts/harness-dogfood/e2e.sh` 为可执行 bash 脚本；**必须**读取 `PORT` 环境变量（默认 18080）以连接 time-api 服务；按顺序访问 `/iso`、`/timezone`、`/unix`；对每个响应做字段级格式校验（ISO 正则、timezone 非空、unix 秒级正整数）；全部通过则 `exit 0`；任一失败或连接失败则 `exit` 非 0（且向 stderr 输出错误摘要）。`README.md` 说明 `node scripts/harness-dogfood/time-api.js` 启动方法与 `bash scripts/harness-dogfood/e2e.sh` 跑法。

**硬阈值**:
- 服务已启动时，`PORT=<运行端口> bash scripts/harness-dogfood/e2e.sh` exit == 0
- 端口空闲（无服务）时，`PORT=<空闲端口> bash scripts/harness-dogfood/e2e.sh` exit != 0
- e2e.sh 具备可执行权限位（`stat.mode & 0o111 != 0`）
- e2e.sh 引用 `/iso`、`/timezone`、`/unix` 三个路径
- e2e.sh 含 `${PORT` 或 `$PORT` 或 `PORT=` 环境变量读取（见风险 R6 修订）
- README.md 存在，含启动命令与 E2E 调用说明

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws4/e2e.test.ts`）:
- `it('e2e.sh 文件存在')`
- `it('e2e.sh 具备可执行权限位')`
- `it('服务已启动 + PORT 环境变量指向运行端口时，e2e.sh exit 0')`
- `it('端口空闲（没有服务）时，e2e.sh 以非 0 exit 退出')`（见风险 R5：端口为动态分配而非硬编码）
- `it('README.md 文件存在')`
- `it('README 含启动命令 node scripts/harness-dogfood/time-api.js')`
- `it('README 含 E2E 冒烟脚本调用说明')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws4.md`）:
- e2e.sh 文件存在且可执行
- e2e.sh 使用 bash shebang 且 `set -e`
- e2e.sh 引用 `/iso`、`/timezone`、`/unix`
- e2e.sh 读取 PORT 环境变量（字面量匹配 `PORT` 且为变量展开形态）
- README.md 存在，含启动命令 + E2E 说明
- 本 WS 不新增 `__tests__/` 文件（PRD 未将 e2e.sh 映射到 `__tests__/`）

---

## Workstreams

workstream_count: 4

### Workstream 1: HTTP server 骨架 + `/iso` + 404/405 + `routes` 锚点

**范围**: 新建 `scripts/harness-dogfood/time-api.js`。导出 `createServer(port)`、`handler(req, res)`、`routes` 三个 API。`routes` 对象 WS1 阶段只含 `'/iso'` 一个 key，**明确保留**为后续 WS 的唯一变更点。含 `require.main === module` 分支读 `PORT`（默认 18080）。同时新建 `scripts/harness-dogfood/__tests__/iso.test.js` 与 `scripts/harness-dogfood/__tests__/not-found.test.js` 作为 PRD 兼容层占位（规则见 `## PRD 兼容层约定`）。

**大小**: S（time-api.js 约 60-80 行 + 2 个 PRD 兼容层测试文件）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/iso.test.ts`

**文件独占性声明**: WS1 是唯一允许 **新建 time-api.js / 修改 WS1 已写骨架部分** 的 WS。后续 WS 只能通过 `routes[key] = handler` 追加，不得触及骨架或 handler dispatch 逻辑。

### Workstream 2: `/timezone` 端点

**范围**: 在 `scripts/harness-dogfood/time-api.js` 的 `routes` 对象末尾（WS1 声明的 append-only 锚点）追加 `routes['/timezone'] = (req, res) => {...}`。新建 `scripts/harness-dogfood/__tests__/timezone.test.js`（PRD 兼容层）。**不得**修改 WS1 已写的 handler / createServer / 404 / 405 代码。

**大小**: S（time-api.js diff 约 6-10 行 + 兼容层测试 1 文件）

**依赖**: WS1（需要 routes 锚点存在）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/timezone.test.ts`

**独立可测性**: WS2 合并后（WS3 未合并时），本 WS 的 4 个 it 全通过；WS3 的 `/unix` 端点返回 404 `{error:"not_found"}`（由 WS1 的 404 兜底负责），不影响 WS2 测试。

### Workstream 3: `/unix` 端点

**范围**: 在 `routes` 对象末尾追加 `routes['/unix'] = (req, res) => {...}`。新建 `scripts/harness-dogfood/__tests__/unix.test.js`（PRD 兼容层）。**不得**修改 WS1 / WS2 已写代码。

**大小**: S（time-api.js diff 约 6-10 行 + 兼容层测试 1 文件）

**依赖**: WS1（需要 routes 锚点）；与 WS2 **无顺序耦合**（两者都只在锚点追加，追加顺序对行为无影响）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws3/unix.test.ts`

**独立可测性**: WS3 合并后（WS2 未合并时），本 WS 的 5 个 it 全通过；WS2 的 `/timezone` 返回 404，不影响 WS3 测试。

### Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，**必须读 PORT 环境变量**，三端点字段级校验）+ `scripts/harness-dogfood/README.md`（启动 + E2E 说明）。不触达 time-api.js / 任何 `__tests__/` 文件。

**大小**: S（e2e.sh 约 40-60 行 + README 约 30 行）

**依赖**: WS1 + WS2 + WS3（E2E 需三端点全部在线）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws4/e2e.test.ts`

**独立可测性**: WS4 的 7 个 it 需三端点全部存在（这是 PRD 场景 4 的语义）；在 E2E 测试里 `PORT` 为测试动态分配的空闲端口（非硬编码 59999），避免 flaky。

---

## 合并顺序与变更隔离（对应风险 R3）

**拓扑 DAG**: `WS1 → {WS2, WS3} → WS4`

**变更隔离机制**：
- WS1 在 `time-api.js` 定义 `routes` 对象，作为 **append-only 锚点**（合同级契约）
- WS2 / WS3 的 diff **只能**是 `routes['/<path>'] = handler;` 形态的一行追加 + 对应 handler 函数定义；不得触达 WS1 骨架（`createServer` / `handler` / 404 / 405 逻辑）
- WS2 / WS3 的 append 在 routes 对象的不同行（按合并顺序各自占用独立位置），两个 PR 的 diff 天然不重叠
- WS4 不触达 time-api.js

**文件级 ARTIFACT 断言（CI 层强约束）**：
- WS2 的 DoD 含 "time-api.js 的 `routes['/iso']` 仍为 function（WS1 骨架未被 WS2 破坏）"
- WS3 的 DoD 含同样的 `routes['/iso']` 存续断言
- 详见 `contract-dod-ws{2,3}.md`

---

## PRD 兼容层约定（对应风险 R1）

PRD "预期受影响文件" 列出 4 个 `scripts/harness-dogfood/__tests__/*.test.js`。本合同将其作为 **PRD 交付物占位**（ARTIFACT 级）纳入 WS 覆盖，但 **BEHAVIOR 断言的 SSOT 仍在 `sprints/tests/ws{N}/`**（避免"一个行为两份断言"）。

**映射**：

| PRD `__tests__/` 文件 | 所属 WS | 占位内容（Generator 需写入） |
|---|---|---|
| `__tests__/iso.test.js` | WS1 | 文件级 smoke：require time-api → 启动 createServer(0) → 打 `/iso` → 断言 status 200 + iso 字段存在；至少 1 个 it |
| `__tests__/not-found.test.js` | WS1 | smoke：打 `/unknown-xyz` → 断言 status 404 + error===`not_found`；至少 1 个 it |
| `__tests__/timezone.test.js` | WS2 | smoke：打 `/timezone` → 断言 status 200 + timezone 非空；至少 1 个 it |
| `__tests__/unix.test.js` | WS3 | smoke：打 `/unix` → 断言 status 200 + unix 为正整数；至少 1 个 it |

**设计原则**：
- `__tests__/*.test.js` 为 **文件存在 + 至少 1 个 it + 打端点不崩溃** 的最小 smoke，不复刻 `sprints/tests/ws{N}/` 的深度断言
- ARTIFACT 层面只校验 "文件存在 + 匹配 `it(` 出现 ≥ 1 次" 这类静态谓词，不调用 runtime（runtime 在 BEHAVIOR 侧）
- 如 PRD 存在 jest 配置并期望 `__tests__/*.test.js` 被自动发现：`SC-006` 声明"无外部依赖"，本合同不引入 jest；`__tests__/` 用 Node 原生 `node --test` 最小语法或仅 `describe/it` 结构存根（Generator 决定，只需满足 ARTIFACT 断言）

---

## Test Contract

| Workstream | BEHAVIOR Test File | it() 数 | 预期红证据（本地实测） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/iso.test.ts` | 7 | `./node_modules/.bin/vitest run sprints/tests/ws1/` → `Test Files 1 failed (1) / Tests 7 failed (7)` |
| WS2 | `sprints/tests/ws2/timezone.test.ts` | 4 | `./node_modules/.bin/vitest run sprints/tests/ws2/` → `Test Files 1 failed (1) / Tests 4 failed (4)` |
| WS3 | `sprints/tests/ws3/unix.test.ts` | 5 | `./node_modules/.bin/vitest run sprints/tests/ws3/` → `Test Files 1 failed (1) / Tests 5 failed (5)` |
| WS4 | `sprints/tests/ws4/e2e.test.ts` | 7 | `./node_modules/.bin/vitest run sprints/tests/ws4/` → `Test Files 1 failed (1) / Tests 7 failed (7)` |

**全量本地跑**: `./node_modules/.bin/vitest run sprints/tests/` → `Test Files 4 failed (4) / Tests 23 failed (23)`。**每个 it() 都是 failed（非 skipped）**——通过每个 it 内部 dynamic import 实现模块、失败直接让 it assertion fail 来达成（见风险 R2 修订）。

**Green 判据**: Generator 把 `scripts/harness-dogfood/time-api.js` + `scripts/harness-dogfood/__tests__/*.test.js` + `scripts/harness-dogfood/e2e.sh` + README 实现后，同命令应输出 `Test Files 4 passed / Tests 23 passed`（所有 it 翻绿）。

---

## 合同外不做（CONTRACT IS LAW 边界）

根据 PRD "不在范围内"章节，Generator 不得实现：鉴权 / HTTPS / CORS / 日志系统 / 指标 / 写接口 / 持久化 / Brain 注册 / Docker。

PRD "预期受影响文件" 的 4 个 `__tests__/*.test.js` **全部纳入** 本合同（见 `## PRD 兼容层约定`）。

---

## 风险处置记录（Round 1 → Round 2）

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| R1 | PRD "预期受影响文件"列的 4 个 `__tests__/*.test.js` 被 Round 1 合同单方面裁剪，违反"PRD 是 SSOT"原则 | 阻断 | **纳入**：在各 WS 的 ARTIFACT 中加入 `__tests__/*.test.js` 文件存在 + `it(` 出现 ≥ 1 次的校验；细节见 `## PRD 兼容层约定`。BEHAVIOR 断言的 SSOT 仍在 `sprints/tests/ws{N}/`，`__tests__/` 为"文件占位 + 最小 smoke" |
| R2 | Round 1 的 Red 证据是"suite-level load failure + 14 tests skipped"，无法区分测试强度（Mutation 把测试文件清空也一样 4 suite failed） | 阻断 | 重写所有 BEHAVIOR 测试：移除文件顶部的 dynamic import 与 `beforeAll`，改为每个 `it()` 内部 `await loadModule()` 并自行 start/close server；失败表现为 `Tests N failed (N)`（Round 2 本地实测 23/23 全部 failed） |
| R3 | Round 1 WS2/3/4 都修改同一 `time-api.js`，切分非独立可测（Reviewer 评语"部分违反"） | 阻断 | 在 WS1 合同中定义 `routes` 对象为 append-only 锚点；WS2/3 的 diff 形态**限定**为 `routes['/<path>'] = handler` 一行追加 + handler 函数定义，**禁止**触达 WS1 骨架；DoD 层加"`routes['/iso']` 仍为 function"的存续断言（WS2/WS3 DoD），见 `## 合并顺序与变更隔离` |
| R4 | Round 1 WS2 断言 `expect([expected,'UTC']).toContain(body.timezone)` 过弱：实现只要硬编码返回 `'UTC'` 无论 process timezone 为何都过 | 正确性 | Round 2 收紧为 `expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')`——只有返回进程真实 timezone 才 pass |
| R5 | Round 1 WS4 测试"服务未启动"分支用硬编码端口 `59999`，在 CI runner 上可能被占用导致 flaky | 稳定性 | Round 2 加 `pickIdlePort()` helper：`net.createServer().listen(0)` 获取内核分配的空闲端口并关闭后使用，确保每次跑都用真空端口 |
| R6 | Round 1 合同未强制 `e2e.sh` 读 `PORT` 环境变量；如果 Generator 硬编码 `localhost:18080`，BEHAVIOR 测试动态端口 + 子进程传 PORT 就会 fail，但合同层面没写清楚这是 Generator 必须满足的契约 | 正确性 | Round 2 在 Feature 4 硬阈值和 WS4 ARTIFACT 同时增加"e2e.sh 读 PORT 环境变量"约束；测试也用动态端口 + `env.PORT` 传递，保证 Generator 必须实现 PORT 读取 |

**修订完整性**：以上 6 条全部在本合同 + 4 个 DoD + 4 个测试文件里落地，可被下一轮 Reviewer 对抗性验证。

---

**Round 2 合规性自检**:

| 条目 | 结果 |
|---|---|
| 每个 GWT 场景被覆盖（1/2/3/4/5） | ✓ 场景 1+5 → WS1；场景 2 → WS2；场景 3 → WS3；场景 4 → WS4 |
| BEHAVIOR 测试路径规范 `sprints/tests/ws{N}/*.test.ts` | ✓ |
| ARTIFACT DoD 文件 `sprints/contract-dod-ws{N}.md` | ✓ |
| Workstream 切分独立可测 | ✓ append-only 锚点 + 不同行追加 + DoD 存续断言 |
| Red 证据可复现 | ✓ 本地 `./node_modules/.bin/vitest run sprints/tests/` → 23/23 per-it failed |
| PRD "预期受影响文件"完整覆盖 | ✓ 4 个 `__tests__/*.test.js` 全部纳入 ARTIFACT |
