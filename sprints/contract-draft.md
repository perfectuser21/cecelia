# Sprint Contract Draft (Round 3)

> Initiative: Harness v6 Reviewer Alignment 哲学真机闭环
> PRD: `sprints/sprint-prd.md`
> Propose round: 3
> Task ID: 2303a935
> 上轮判决: REVISION（3 阻断/正确性 + 2 小问题）

本轮对 Round 2 做 **架构级改写**：把路由实现从"单文件 + routes 对象 append-only 锚点"改为 **routes/ 物理子目录** —— WS2/WS3 只新增自己的文件，完全不碰 `time-api.js` 与其他 WS 的文件。WS 间文件交集 = ∅，从而一次性解决 Round 2 风险 1（routes 锚点在 BEHAVIOR 层无法证伪）与风险 3（并行合并的 git 冲突未机制化）。PRD 兼容层测试（`scripts/harness-dogfood/__tests__/*.test.js`）改用 Node 18+ 内置 `node:test`，自己启动/打端点/关闭，既满足 PRD 文件交付物，又真能 runtime 跑通，闭合风险 2 的 "runtime-broken 口子"。R6 PORT 匹配收紧为默认值展开形态，WS4 端口空闲测试改为 503 探针服务消除竞争窗口。

---

## 架构调整（Round 3 核心）

### 文件布局（最终态，四个 WS 合并后）

```
scripts/harness-dogfood/
├── time-api.js              # HTTP server 骨架 + 404/405 + 自动加载 routes/ 目录
├── routes/
│   ├── iso.js               # GET /iso 实现（WS1 专属）
│   ├── timezone.js          # GET /timezone 实现（WS2 专属）
│   └── unix.js              # GET /unix 实现（WS3 专属）
├── __tests__/
│   ├── iso.test.js          # PRD 兼容层 runtime smoke（WS1 专属，node:test）
│   ├── not-found.test.js    # PRD 兼容层 runtime smoke（WS1 专属，node:test）
│   ├── timezone.test.js     # PRD 兼容层 runtime smoke（WS2 专属，node:test）
│   └── unix.test.js         # PRD 兼容层 runtime smoke（WS3 专属，node:test）
├── e2e.sh                   # Final E2E 冒烟（WS4 专属）
└── README.md                # 使用说明（WS4 专属）
```

### 各 WS 新增文件（完全不交集）

| WS | 新增文件 | 是否触达其它 WS 文件 |
|---|---|---|
| WS1 | `time-api.js`, `routes/iso.js`, `__tests__/iso.test.js`, `__tests__/not-found.test.js` | 否（本 WS 首次建所有骨架，后续 WS 只新增不改） |
| WS2 | `routes/timezone.js`, `__tests__/timezone.test.js` | **否**（新文件，不改 `time-api.js`，不改 WS1 任何文件） |
| WS3 | `routes/unix.js`, `__tests__/unix.test.js` | **否**（新文件，不改 `time-api.js`，与 WS2 无文件交集） |
| WS4 | `e2e.sh`, `README.md` | **否**（不改任何代码文件） |

**并行合并安全性**：WS2 / WS3 / WS4 的 diff `git diff --name-only` 中**不得出现** `scripts/harness-dogfood/time-api.js` 或其他 WS 新增过的任何文件。两个 PR 同时合并时，git 只需对 `routes/` 目录下不同文件做 add，不会有冲突。

### 自动加载机制（WS1 实现）

`time-api.js` 在初始化 `routes` 对象时扫描 `__dirname/routes/*.js` 目录，逐个 `require` 并按契约形状注册：

```js
// 每个 routes/<name>.js 需默认导出 { path: '/xxx', handler: (req, res) => void }
// time-api.js 的加载逻辑（WS1 写，后续 WS 不碰）：
const routes = {};
const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
  for (const f of fs.readdirSync(routesDir)) {
    if (!f.endsWith('.js')) continue;
    const mod = require(path.join(routesDir, f));
    if (mod && typeof mod.path === 'string' && typeof mod.handler === 'function') {
      routes[mod.path] = mod.handler;
    }
  }
}
```

**关键性质**：WS2 新增 `routes/timezone.js` 文件后，**无需改 time-api.js**，`routes['/timezone']` 即自动出现——因为加载逻辑在 module 初始化时扫描目录。WS3 同理。这就是 "WS 独立可测" 的物理基础。

### 骨架"不被污染"的可观测证据（Round 2 风险 1 解）

- **BEHAVIOR 层证伪**: WS2 的测试新增 `it('WS2 合并后 /iso 端点仍正常 200 响应，骨架功能未被污染')`；同理 WS3。
- **ARTIFACT 层证伪**: WS2 / WS3 的 DoD 同时写入 **负向字面量断言**：
  - WS2 合并后 `time-api.js` 源文件**不得包含** `/timezone`、`Intl.DateTimeFormat`、`resolvedOptions` 三个 timezone 专属字面量（它们只允许出现在 `routes/timezone.js`）
  - WS3 合并后 `time-api.js` 源文件**不得包含** `/unix`、`Math.floor(Date.now()/1000)`、`'unix'` 响应字段三个字面量
- **物理层证伪**: WS2 / WS3 的 DoD 断言 **本 WS 的 PR 引入的文件不含 `time-api.js`**（通过列 WS 应新增文件、各自存在）

---

## Feature 1: `/iso` 端点 + HTTP 服务骨架 + 404/405 + routes 目录加载器

**行为描述**:
进程启动后对 `127.0.0.1` 监听指定端口（默认 `18080`，`PORT` 环境变量可覆盖）。模块加载时扫描同目录下 `routes/*.js`，对每个导出 `{ path, handler }` 形状的模块，自动注册到 `routes[path]`。`GET /iso` 返回 HTTP 200，Body 为 JSON 对象含 `iso` 字段，值为当前 UTC 时刻 ISO 8601 毫秒精度 Z 结尾字符串。未知路径返回 HTTP 404 + `{"error":"not_found"}`。任意非 GET 方法返回 HTTP 405 + `{"error":"method_not_allowed"}`。所有响应 `Content-Type: application/json`。

模块导出 `createServer(port): Promise<http.Server>` 与 `routes: Record<string, (req, res) => void>`。WS1 完成时 `routes` 仅包含 `/iso` 一个 key（因为只有 `routes/iso.js` 存在）。

**硬阈值**:
- `GET /iso` status == 200，Body.iso 匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`，毫秒时间戳与 `Date.now()` 差 ≤ 5000 ms
- 响应头 `content-type` 含 `application/json`
- `GET /unknown-xyz` status == 404，Body == `{"error":"not_found"}`
- `POST /iso` status == 405，Body == `{"error":"method_not_allowed"}`
- `createServer(0)` 返回已监听的 `http.Server`，`server.address().port` 为正整数
- `module.exports.routes` 为对象，含 `/iso` 键；**不含** `/timezone`、`/unix` 键（WS1 独立态）
- `time-api.js` 源文件**不含** `/timezone`、`/unix`、`timezone`、`unix` 响应字段字面量（物理隔离契约——未来新 route 只能走 `routes/` 目录）
- **PRD 兼容层 runtime**：`node --test scripts/harness-dogfood/__tests__/iso.test.js` exit 0；`node --test scripts/harness-dogfood/__tests__/not-found.test.js` exit 0

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/iso.test.ts`）:
- `it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式')`
- `it('GET /iso 的 Content-Type 为 application/json')`
- `it('GET /iso 的 iso 字段对应时间与当前时间相差不超过 5 秒')`
- `it('GET /unknown-xyz 返回 404 且 body 为 {error:"not_found"}')`
- `it('POST /iso 返回 405 且 body 为 {error:"method_not_allowed"}')`
- `it('createServer(0) 返回已监听的 server，address().port 为正整数')`
- `it('WS1 独立态：routes 对象仅含 /iso，不含 /timezone 或 /unix')`
- `it('WS1 独立态：time-api.js 源码不含 timezone 或 unix 相关字面量（物理隔离契约）')`
- `it('PRD 兼容层 runtime：node --test __tests__/iso.test.js exit 0')`
- `it('PRD 兼容层 runtime：node --test __tests__/not-found.test.js exit 0')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws1.md`）:
- `scripts/harness-dogfood/time-api.js` 文件存在
- `scripts/harness-dogfood/routes/iso.js` 文件存在（物理分文件的第一块）
- time-api.js 导出 `createServer`
- time-api.js 导出 `routes` 对象
- time-api.js 含 `fs.readdirSync` 或等效目录扫描（routes 自动加载器）
- time-api.js 含 `process.env.PORT` 读取
- time-api.js 含 `require.main === module` 直跑分支
- time-api.js 含 `not_found`、`method_not_allowed` 字面量
- time-api.js **不含** `/timezone`、`/unix`、`'timezone'`、`'unix'` 字面量
- time-api.js 不引入非 Node 内置模块
- routes/iso.js 导出 `{path: '/iso', handler}` 形状
- `__tests__/iso.test.js` 存在且使用 `node:test`（文件含 `require('node:test')` 或 `import ... 'node:test'`）
- `__tests__/not-found.test.js` 存在且使用 `node:test`
- `__tests__/iso.test.js` 可被 `node --test` 运行成功（ARTIFACT 层级直接通过 bash 验证）
- `__tests__/not-found.test.js` 可被 `node --test` 运行成功

---

## Feature 2: `/timezone` 端点

**行为描述**:
新增 `scripts/harness-dogfood/routes/timezone.js`，导出 `{path: '/timezone', handler}`。handler 返回 HTTP 200 JSON `{timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`。**不改** `time-api.js` —— routes 自动加载器会在下次 require 时发现新文件并注册 `routes['/timezone']`。同时新增 `__tests__/timezone.test.js`（node:test，runtime 可跑）。

**硬阈值**:
- `GET /timezone` status == 200
- Body.timezone 为非空 string
- Body.timezone **严格等于** `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`
- 响应头 `content-type` 含 `application/json`
- `module.exports.routes['/timezone']` 为 function（自动加载器识别）
- **WS2 合并后 `/iso` 仍正常 200 响应**（骨架未被污染）
- **WS2 合并后 time-api.js 源码**不含** `/timezone`、`Intl.DateTimeFormat`、`resolvedOptions`、`'timezone'` 四个字面量**（物理隔离契约 —— 这些字面量只允许在 `routes/timezone.js`）
- **WS2 本次 PR diff 不含 `scripts/harness-dogfood/time-api.js`**（无共享文件改动）
- `node --test scripts/harness-dogfood/__tests__/timezone.test.js` exit 0（runtime 兼容层）

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws2/timezone.test.ts`）:
- `it('GET /timezone 返回 200 且 timezone 字段为非空字符串')`
- `it('GET /timezone 返回的 timezone 严格等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）')`
- `it('GET /timezone 的 Content-Type 为 application/json')`
- `it('routes["/timezone"] 为 handler 函数（自动加载器识别新文件）')`
- `it('WS2 合并后 /iso 端点仍正常 200 响应（骨架未被污染）')`
- `it('WS2 合并后 time-api.js 源码不含 timezone 相关字面量（物理隔离契约）')`
- `it('PRD 兼容层 runtime：node --test __tests__/timezone.test.js exit 0')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws2.md`）:
- `scripts/harness-dogfood/routes/timezone.js` 存在
- routes/timezone.js 导出 `{path: '/timezone', handler}` 形状
- routes/timezone.js 含 `Intl.DateTimeFormat`
- routes/timezone.js 含 `'/timezone'`、`'timezone'` 字面量
- `__tests__/timezone.test.js` 存在且使用 `node:test`
- `__tests__/timezone.test.js` 可被 `node --test` 运行成功（runtime 兼容层）
- **time-api.js 源文件不含** `/timezone`（负向断言，骨架未被污染）
- **time-api.js 源文件不含** `Intl.DateTimeFormat`（负向断言）
- **time-api.js 源文件不含** `resolvedOptions`（负向断言）
- **time-api.js 源文件不含** `'timezone'` 字面量
- WS1 骨架存续正向断言：time-api.js 含 `not_found`（404 兜底未被污染）

---

## Feature 3: `/unix` 端点

**行为描述**:
新增 `scripts/harness-dogfood/routes/unix.js`，导出 `{path: '/unix', handler}`。handler 返回 HTTP 200 JSON `{unix: Math.floor(Date.now()/1000)}`，正整数。**不改** `time-api.js`。新增 `__tests__/unix.test.js`（node:test）。

**硬阈值**:
- `GET /unix` status == 200
- Body.unix 为 integer，`> 0`，`Math.abs(Body.unix - Math.floor(Date.now()/1000)) <= 5`
- Body.unix 不是毫秒级：`Body.unix < Math.floor(Date.now()/1000) * 100`
- 响应头 `content-type` 含 `application/json`
- `module.exports.routes['/unix']` 为 function
- **WS3 合并后 `/iso` 仍正常 200 响应**（骨架未被污染）
- **WS3 合并后 time-api.js 源码不含** `/unix`、`Math.floor(Date.now()/1000)`、`'unix'` 字面量
- **WS3 本次 PR diff 不含 `scripts/harness-dogfood/time-api.js`**
- `node --test scripts/harness-dogfood/__tests__/unix.test.js` exit 0

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws3/unix.test.ts`）:
- `it('GET /unix 返回 200 且 unix 字段为正整数')`
- `it('GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒')`
- `it('GET /unix 的 unix 字段不是毫秒级（不应比当前秒时间戳大三位数以上）')`
- `it('GET /unix 的 Content-Type 为 application/json')`
- `it('routes["/unix"] 为 handler 函数（自动加载器识别新文件）')`
- `it('WS3 合并后 /iso 端点仍正常 200 响应（骨架未被污染）')`
- `it('WS3 合并后 time-api.js 源码不含 unix 相关字面量（物理隔离契约）')`
- `it('PRD 兼容层 runtime：node --test __tests__/unix.test.js exit 0')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws3.md`）:
- `scripts/harness-dogfood/routes/unix.js` 存在
- routes/unix.js 导出 `{path: '/unix', handler}`
- routes/unix.js 含 `Math.floor(Date.now()/1000)`
- routes/unix.js 含 `'/unix'`、`'unix'` 字面量
- `__tests__/unix.test.js` 存在且使用 `node:test`
- `__tests__/unix.test.js` 可被 `node --test` 运行成功
- **time-api.js 源文件不含** `/unix`、`Math.floor`、`'unix'` 字面量（负向断言）
- WS1 骨架存续正向断言：time-api.js 仍含 `not_found`

---

## Feature 4: E2E 冒烟脚本 + README

**行为描述**:
`scripts/harness-dogfood/e2e.sh` 为可执行 bash 脚本；**必须读 PORT 环境变量默认值展开形态**（`${PORT:-18080}` 或 `${PORT-18080}` 或 `: ${PORT:=18080}`——纯硬编码 `PORT=18080` 赋值不算）；按顺序访问 `/iso`、`/timezone`、`/unix`；对每个响应做字段级格式校验（ISO 正则、timezone 非空、unix 秒级正整数）；全部通过 exit 0；任一失败或连接错 exit ≠ 0 + stderr 错误摘要。`README.md` 含启动命令 + E2E 调用说明。

**硬阈值**:
- 服务已启动时，`PORT=<运行端口> bash scripts/harness-dogfood/e2e.sh` exit == 0
- **有探针服务监听端口但只返回 HTTP 503** 时，`PORT=<探针端口> bash scripts/harness-dogfood/e2e.sh` exit != 0（消除 Round 2 "空闲端口 → 竞争窗口" flaky）
- e2e.sh 具备可执行权限位
- e2e.sh 引用 `/iso`、`/timezone`、`/unix` 三个路径
- e2e.sh 含 **默认值展开形态** 的 PORT 读取（正则 `\$\{PORT:-|\$\{PORT-|:\s*\$\{PORT:=`，**排除**纯 `PORT=18080` 硬编码赋值）
- README.md 存在，含启动命令与 E2E 调用说明

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws4/e2e.test.ts`）:
- `it('e2e.sh 文件存在')`
- `it('e2e.sh 具备可执行权限位')`
- `it('服务已启动 + PORT 环境变量指向运行端口时，e2e.sh exit 0')`
- `it('端口有 503 探针服务时，e2e.sh exit 非 0（无竞争窗口）')`
- `it('e2e.sh 源码含 PORT 默认值展开形态（${PORT:-} 或等效，非硬编码赋值）')`
- `it('README.md 文件存在')`
- `it('README 含启动命令 node scripts/harness-dogfood/time-api.js')`
- `it('README 含 E2E 冒烟脚本调用说明')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws4.md`）:
- e2e.sh 存在且可执行
- e2e.sh bash shebang + `set -e` 族
- e2e.sh 引用三个端点路径
- e2e.sh 含 PORT **默认值展开形态**（收紧后的正则；拒绝纯硬编码 `PORT=18080`）
- README.md 存在，含启动命令 + E2E 说明

---

## Workstreams

workstream_count: 4

### Workstream 1: HTTP server 骨架 + routes 自动加载器 + /iso + 404/405

**范围**: 新建 `scripts/harness-dogfood/time-api.js`（HTTP server + handler dispatch + 404/405 + routes 目录自动加载器 + `require.main === module` 分支读 `PORT` 默认 18080）；新建 `scripts/harness-dogfood/routes/iso.js`（`/iso` 实现）；新建 `scripts/harness-dogfood/__tests__/iso.test.js` 与 `scripts/harness-dogfood/__tests__/not-found.test.js`（均用 Node 内置 `node:test`，自己启动/打端点/关闭）。

**大小**: M（time-api.js 约 70-100 行 + routes/iso.js 约 10-15 行 + 2 个 node:test 兼容层约 60-80 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/iso.test.ts`（10 个 it）

**文件独占性声明**: WS1 是唯一允许新建 `time-api.js` 的 WS。WS2/WS3/WS4 的 PR diff **不得**包含 `time-api.js`。

### Workstream 2: `/timezone` 端点（只新增文件，不改 time-api.js）

**范围**: 新建 `scripts/harness-dogfood/routes/timezone.js`（导出 `{path, handler}`）与 `scripts/harness-dogfood/__tests__/timezone.test.js`（node:test）。**禁止修改** `time-api.js`、`routes/iso.js`、`__tests__/iso.test.js`、`__tests__/not-found.test.js`。依赖 WS1 的 routes 自动加载器识别新文件。

**大小**: S（routes/timezone.js 约 10-15 行 + 兼容层测试约 30-40 行）

**依赖**: WS1（需要 routes 加载器骨架就位）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/timezone.test.ts`（7 个 it）

**独立可测性 + 并行合并安全**: WS2 本次 PR diff 只新增 `routes/timezone.js` + `__tests__/timezone.test.js`，与 WS3 的 `routes/unix.js` + `__tests__/unix.test.js` 无文件交集，git 自动 3-way merge 无冲突。合并后 `/unix` 仍然 404（由 WS1 的 404 兜底负责），不影响 WS2 测试通过。

### Workstream 3: `/unix` 端点（只新增文件，不改 time-api.js）

**范围**: 新建 `scripts/harness-dogfood/routes/unix.js` + `scripts/harness-dogfood/__tests__/unix.test.js`。**禁止修改** `time-api.js` / WS1 / WS2 任何文件。

**大小**: S（routes/unix.js 约 10-15 行 + 兼容层测试约 30-40 行）

**依赖**: WS1（routes 加载器）；与 WS2 **无文件交集、无顺序耦合**

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws3/unix.test.ts`（8 个 it）

### Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，**PORT 必须是默认值展开形态**） + `scripts/harness-dogfood/README.md`。**不触达**任何 .js 文件。

**大小**: S（e2e.sh 约 40-60 行 + README 约 30 行）

**依赖**: WS1 + WS2 + WS3（需三端点全在线）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws4/e2e.test.ts`（8 个 it）

---

## 合并顺序与变更隔离（对应 Round 2 风险 3）

**拓扑 DAG**: `WS1 → {WS2, WS3} → WS4`

**git 冲突消除机制（物理级）**:
- WS 间文件交集 = ∅（见 `## 架构调整` 表格）
- WS2 与 WS3 **并行提交并同时合并**时，git 只需对不同文件做 add，无任何文件同行/同区块改动
- 每个 WS 的 DoD 含 "本 WS 引入的文件列表严格等于契约声明" + "time-api.js 在本 WS 未被修改" 两条断言

**骨架不被污染的三层防线**:
1. **物理层**：WS2/WS3 的 diff 根本不含 time-api.js → `git diff --name-only` 断言
2. **ARTIFACT 层**：time-api.js 源码不得含该 WS 专属字面量（/timezone、Intl.DateTimeFormat、/unix、Math.floor 等）→ DoD 负向断言
3. **BEHAVIOR 层**：该 WS 合并后 `/iso` 仍正常 200 响应 → tests/ws{2,3}/ 的显式 it

这三层同时失守才算骨架被破，Mutation testing 打掉任何一层都会被其它层抓到。

---

## PRD 兼容层：Round 3 改为 runtime 真跑（对应 Round 2 风险 2）

PRD "预期受影响文件" 列的 4 个 `__tests__/*.test.js` 在 Round 2 仅做"文件存在 + it( 出现 ≥ 1 次"的静态校验，留了 "占位文件写 `it('x', () => {})` 空实现" 的 runtime-broken 口子。Round 3 修订：

| 文件 | 所属 WS | Round 3 合同要求 |
|---|---|---|
| `__tests__/iso.test.js` | WS1 | 使用 Node 18+ 内置 `node:test` + `node:assert/strict`；自己 `require('../time-api.js')` → `createServer(0)` → `fetch '/iso'` → 断言 status 200 + `body.iso` 匹配 ISO 8601 正则 → close server；**`node --test` 执行 exit 0** |
| `__tests__/not-found.test.js` | WS1 | 同上骨架，`fetch '/unknown-xyz'` → status 404 + `body.error === 'not_found'`；**node --test exit 0** |
| `__tests__/timezone.test.js` | WS2 | 同上骨架，`fetch '/timezone'` → status 200 + body.timezone 非空；**node --test exit 0** |
| `__tests__/unix.test.js` | WS3 | 同上骨架，`fetch '/unix'` → status 200 + `Number.isInteger(body.unix) && body.unix > 0`；**node --test exit 0** |

**校验方式（二元）**:
- **ARTIFACT 层**: `bash -c "cd \$(git rev-parse --show-toplevel) && timeout 30 node --test scripts/harness-dogfood/__tests__/iso.test.js"` 退出码 == 0（单个文件；不依赖任何其它 WS 的 runtime）
- **BEHAVIOR 层**: tests/ws{1,2,3}/*.test.ts 内用 `spawnSync('node', ['--test', '<path>'])` 子进程运行，断言 `.status === 0`

**为何 node:test 不违反 SC-006**: Node 18+ 原生内置 `node:test` 与 `node:assert`，属于"仅 Node 标准库"范畴（SC-006 明文允许）。不引入任何外部 npm 依赖。

---

## R6 PORT 匹配收紧（对应 Round 2 小问题 1）

Round 2 的 ARTIFACT 正则 `\$\{?PORT(?::-[^}]*)?\}?` 会把 `PORT=18080`（纯硬编码赋值）也当成合规。Round 3 收紧为：

```
\$\{PORT:-|\$\{PORT-|:\s*\$\{PORT:=
```

三种合规形态：
1. `${PORT:-18080}` — 标准默认值（空字符串也替换）
2. `${PORT-18080}` — 仅未设置时替换
3. `: ${PORT:=18080}` — 赋值默认值（POSIX 惯用）

**拒绝**：`PORT=18080`、`PORT="18080"`、`PORT='18080'`、`PORT=$DEFAULT`（裸赋值，不是展开）。

DoD 加一条 ARTIFACT 负向断言：e2e.sh 源码**不得**含 `^PORT=` 或 `^PORT="` 或 `^PORT='` 这类硬编码赋值行（行首匹配）。

---

## WS4 端口空闲测试改 503 探针（对应 Round 2 小问题 2）

Round 2 的 `pickIdlePort` 在 close 与 e2e.sh 启动间有竞争窗口。Round 3 改为：

```ts
// 启动一个永远返回 HTTP 503 的探针 server，监听动态端口
const probe = http.createServer((req, res) => {
  res.writeHead(503, { 'Content-Type': 'text/plain' });
  res.end('probe: service_unavailable');
});
await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
const probePort = (probe.address() as AddressInfo).port;
try {
  const result = runE2E(probePort);
  expect(result.status).not.toBe(0);  // e2e.sh 拿到 503 → 字段校验 fail → exit ≠ 0
} finally {
  probe.close();
}
```

**端口在整个测试期间持续被占用**，无竞争窗口。e2e.sh 收到 503 响应或非 JSON/缺字段，必然 exit ≠ 0。

---

## Test Contract

| WS | BEHAVIOR Test File | it() 数 | 预期红证据（本地实测命令） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/iso.test.ts` | 10 | `./node_modules/.bin/vitest run sprints/tests/ws1/` → `Test Files 1 failed (1) / Tests 10 failed (10)` |
| WS2 | `sprints/tests/ws2/timezone.test.ts` | 7 | `./node_modules/.bin/vitest run sprints/tests/ws2/` → `Test Files 1 failed (1) / Tests 7 failed (7)` |
| WS3 | `sprints/tests/ws3/unix.test.ts` | 8 | `./node_modules/.bin/vitest run sprints/tests/ws3/` → `Test Files 1 failed (1) / Tests 8 failed (8)` |
| WS4 | `sprints/tests/ws4/e2e.test.ts` | 8 | `./node_modules/.bin/vitest run sprints/tests/ws4/` → `Test Files 1 failed (1) / Tests 8 failed (8)` |

**全量本地跑**: `./node_modules/.bin/vitest run sprints/tests/` → `Test Files 4 failed (4) / Tests 33 failed (33)`。每个 it 都是 `FAIL`（不是 suite-level load failure），通过 it 内部 `await loadModule()` 与 `spawnSync` 触发失败路径。

**Green 判据**: Generator 按四个 DoD 实现后，上述命令应输出 `Test Files 4 passed / Tests 33 passed`。

---

## 合同外不做（CONTRACT IS LAW 边界）

根据 PRD "不在范围内"：Generator 不得实现鉴权 / HTTPS / CORS / 日志 / 指标 / 写接口 / 持久化 / Brain 注册 / Docker。

PRD "预期受影响文件" 的 4 个 `__tests__/*.test.js` 全部纳入，**且必须 runtime 可跑**（见上文 PRD 兼容层章节）。

---

## 风险处置记录（Round 2 → Round 3）

| # | Round 2 风险 | 等级 | Round 3 处置 |
|---|---|---|---|
| 1 | routes 锚点概念只在 ARTIFACT 负向断言层声明，BEHAVIOR 层无法证伪（Mutation 把 "append-only" 改成 "整块覆盖" 合同抓不到） | 阻断 | **架构级改写**：路由实现物理分文件到 `routes/<name>.js`，WS2/WS3 新建自己文件而非改共享文件。三层防线：(a) 物理层 WS 间文件零交集（DoD 断言 WS 新增文件清单 + time-api.js 未被本 WS 修改） (b) ARTIFACT 层 time-api.js 源文件**不得**含该 WS 专属字面量（/timezone、Intl.DateTimeFormat、/unix、Math.floor 等负向断言） (c) BEHAVIOR 层 WS2/3 合并后 `/iso` 仍正常 200（显式 it） |
| 2 | PRD 兼容层 `__tests__/*.test.js` 仅校验文件存在 + `it(` ≥ 1，允许写入空 `it('x', () => {})` 僵尸占位，runtime-broken | 正确性 | `__tests__/*.test.js` 改用 Node 18+ 内置 `node:test` + `node:assert/strict`，自己 `require('../time-api.js')` → 启 server → fetch → 断言 → close server。ARTIFACT 增加 `node --test` 子进程 exit 0 断言；BEHAVIOR 增加 `it('spawnSync node --test exit 0')` |
| 3 | 并行合并 git 冲突未机制化（WS2/WS3 都向 routes 对象末尾追加，git 3-way 可能冲突） | 威胁 SC-007 | WS2/WS3 的 PR **物理上不改 time-api.js**，只新增 `routes/<name>.js` + `__tests__/<name>.test.js`。任意两个 WS 的 `git diff --name-only` 交集 = ∅，3-way merge 必成功。DoD 增断言 "本 WS 的 PR 未触达 time-api.js" |
| 小 1 | R6 的 `PORT=` 字面量匹配过宽，会命中 `PORT=18080` 硬编码赋值 | 次要 | DoD 正则收紧为 `\$\{PORT:-\|\$\{PORT-\|:\s*\$\{PORT:=`（三种真正默认值展开形态），并加负向断言"e2e.sh 不得含 `^PORT=` 硬编码行" |
| 小 2 | WS4 "空闲端口 exit != 0" 测试在 pickIdlePort → close → e2e.sh 启动间有竞争窗口，CI 下可能 race | 次要 | 改用 503 探针服务：测试里启一个永远返回 503 的 HTTP server 持续占住端口，e2e.sh 拿到 503 必 exit ≠ 0。无竞争窗口 |

**Mutation 挑战预案**：
- 若 Generator 把 WS2 的 `routes/timezone.js` 的 timezone 实现"搬"回 time-api.js → 被 WS2 的 ARTIFACT 负向断言抓（time-api.js 不含 Intl.DateTimeFormat）
- 若 Generator 删掉 WS1 的 `/iso` handler → 被 WS2 的 BEHAVIOR `it('WS2 合并后 /iso 端点仍正常 200 响应')` 抓
- 若 Generator 在 `__tests__/*.test.js` 写空壳 `test('x', () => {})` → 被 ARTIFACT `node --test` 子进程 exit 0 断言抓（空 test 会通过；但真实 `assert.strictEqual(res.status, 200)` 在 server 未启时会抛 fetch error，所以必须真跑才过）—— 额外防线：`node --test` 输出必须含 `# pass 1` 或等效非零测试数（见 ARTIFACT 细节）

---

**Round 3 合规性自检**:

| 条目 | 结果 |
|---|---|
| 每个 GWT 场景被覆盖（1/2/3/4/5） | ✓ 场景 1+5 → WS1；场景 2 → WS2；场景 3 → WS3；场景 4 → WS4 |
| BEHAVIOR 测试路径规范 `sprints/tests/ws{N}/*.test.ts` | ✓ |
| ARTIFACT DoD 文件 `sprints/contract-dod-ws{N}.md` 仅 [ARTIFACT] 条目 | ✓ |
| Workstream 切分独立可测 | ✓ 文件交集 = ∅ + 自动加载器 + 三层防线 |
| Red 证据可复现 | ✓ 本地 `./node_modules/.bin/vitest run sprints/tests/` → 33/33 per-it FAIL |
| PRD "预期受影响文件"完整覆盖 | ✓ 4 个 `__tests__/*.test.js` 全部纳入，且 runtime 真跑 |
| 消除 Round 2 阻断风险 1/2/3 | ✓ 架构级改写 + node:test + 物理分文件 |
| 消除 Round 2 小问题 R6/WS4 | ✓ PORT 正则收紧 + 503 探针 |
