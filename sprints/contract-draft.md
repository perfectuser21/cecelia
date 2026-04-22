# Sprint Contract Draft (Round 4)

> Initiative: Harness v6 Reviewer Alignment 哲学真机闭环
> PRD: `sprints/sprint-prd.md`
> Propose round: 4
> Task ID: 2303a935
> 上轮判决: REVISION（1 致命正确性 bug + 1 runtime 漏洞半处置）

本轮针对 Round 3 Reviewer 指出的两个问题做**精确小改**：

1. **致命正确性 bug 修复**（WS1 独立态 it 在 main 上必红 → Initiative 永远到不了 `done`）：删除 `sprints/tests/ws1/iso.test.ts` 里 `it('WS1 独立态：routes 对象仅含 /iso，不含 /timezone 或 /unix')` 这条 BEHAVIOR 断言。它的唯一成立条件是「WS1 单独存在、WS2/WS3 未合并」，一旦 B_task_loop 合并 WS2 后 `routes['/timezone']` 为 function，该 it 必红，Final E2E 永远 fail。物理隔离契约在三层防线（物理 + ARTIFACT + BEHAVIOR 的 "骨架不被污染"）中的 **ARTIFACT 负向字面量层** 已独立充分证伪（time-api.js 源码不含 `/timezone`/`/unix`/`Intl.DateTimeFormat`/`Math.floor` 等），删掉这条对 Mutation 防御强度无损。另一条 `WS1 独立态：time-api.js 源码不含 timezone 或 unix 相关字面量（物理隔离契约）` 实为**全时态合同**（无论哪个 WS 合并，time-api.js 都不应被改），改名为 `time-api.js 源码不含 timezone/unix 相关字面量（物理隔离契约·全时态）`，保留。
2. **Red/Green 信号锁死**（Round 3 只堵住 node:test 空壳、漏未堵死 vitest 发现失败）：**仓库根新增 `vitest.config.ts`**（WS1 范围），`test.include` 显式含 `sprints/tests/**/*.test.ts`。全量 WS DoD 各加 3 条 ARTIFACT：(i) `vitest run sprints/tests/wsN/` stderr/stdout 不含 `No test files found`；(ii) stdout 明确出现本 WS 的 `*.test.ts` 路径；(iii) 摘要行 `Tests N (failed|passed) (N)` 的 `(N)` 精确匹配本合同声明的该 WS 测试数。如果 Generator 不写入 vitest.config.ts、或写了但 include 没有 sprints，这三条都会 FAIL；如果仓库环境升级 vitest 破坏扫描，信号也会立刻变红——彻底堵死 "测试未跑即假通过" 漏洞。

其余架构级改动（routes 分文件、WS 间文件零交集、node:test runtime 兼容层、503 探针、PORT 默认值展开收紧）沿用 Round 3 的设计，Reviewer Round 3 已明确 APPROVED 相应章节。

---

## 架构调整（Round 3 沿用 + Round 4 新增 vitest.config.ts）

### 文件布局（最终态，四个 WS 合并后）

```
<repo-root>/
├── vitest.config.ts              # Round 4 新增，WS1 范围（显式 include sprints/tests/**/*.test.ts）
└── scripts/harness-dogfood/
    ├── time-api.js               # HTTP server 骨架 + 404/405 + 自动加载 routes/ 目录（WS1 专属）
    ├── routes/
    │   ├── iso.js                # GET /iso 实现（WS1 专属）
    │   ├── timezone.js           # GET /timezone 实现（WS2 专属）
    │   └── unix.js               # GET /unix 实现（WS3 专属）
    ├── __tests__/
    │   ├── iso.test.js           # PRD 兼容层 runtime smoke（WS1 专属，node:test）
    │   ├── not-found.test.js     # PRD 兼容层 runtime smoke（WS1 专属，node:test）
    │   ├── timezone.test.js      # PRD 兼容层 runtime smoke（WS2 专属，node:test）
    │   └── unix.test.js          # PRD 兼容层 runtime smoke（WS3 专属，node:test）
    ├── e2e.sh                    # Final E2E 冒烟（WS4 专属）
    └── README.md                 # 使用说明（WS4 专属）
```

### 各 WS 新增文件（完全不交集）

| WS | 新增文件 | 是否触达其它 WS 文件 |
|---|---|---|
| WS1 | `vitest.config.ts`, `time-api.js`, `routes/iso.js`, `__tests__/iso.test.js`, `__tests__/not-found.test.js` | 否（本 WS 首次建所有骨架 + 仓库根 vitest 配置） |
| WS2 | `routes/timezone.js`, `__tests__/timezone.test.js` | **否**（新文件，不改 time-api.js / vitest.config.ts / WS1 任何文件） |
| WS3 | `routes/unix.js`, `__tests__/unix.test.js` | **否**（与 WS2 无文件交集） |
| WS4 | `e2e.sh`, `README.md` | **否**（不改任何代码/配置文件） |

**并行合并安全性（物理级）**：WS2/WS3/WS4 的 `git diff --name-only` 中**不得出现** `time-api.js`、`vitest.config.ts` 或其他 WS 新增过的文件。两个 PR 同时合并时 git 只需对不同文件 add，无同行/同区块冲突。

### 自动加载机制（WS1 实现，Round 3 架构，Round 4 不变）

`time-api.js` 在初始化 `routes` 对象时扫描 `__dirname/routes/*.js` 目录，逐个 `require` 并按契约形状注册：

```js
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

WS2/WS3 只需新增 `routes/<name>.js` 文件，`time-api.js` **无需任何修改**。

### 骨架"不被污染"的可观测证据（Round 2 风险 1 解，Round 4 收紧 BEHAVIOR 边界）

- **物理层**: WS2/WS3/WS4 的 PR diff 中文件清单严格等于契约声明，不含 `time-api.js`。
- **ARTIFACT 层**: WS2 合同断言 `time-api.js` 不含 `/timezone`、`Intl.DateTimeFormat`、`resolvedOptions`、`'timezone'`；WS3 合同断言 `time-api.js` 不含 `/unix`、`Math.floor`、`'unix'`。
- **BEHAVIOR 层（全时态）**: WS2/WS3 的测试含 `/iso 仍 200` + `time-api.js 源码不含本 WS 专属字面量` 两类 it。这两类 it **全时态都成立**（WS1/WS2/WS3/WS4 任意合并态下都应通过）——关键设计取舍。
- **（Round 4 删除）**: WS1 "独立态" `routes 仅含 /iso` 这类**时态耦合**的 it 不能出现在 Final E2E 跑的 sprint tests 中。

---

## Feature 1: `/iso` 端点 + HTTP 服务骨架 + 404/405 + routes 目录加载器 + 仓库根 vitest 配置

**行为描述**:
进程启动后对 `127.0.0.1` 监听指定端口（默认 `18080`，`PORT` 环境变量可覆盖）。模块加载时扫描同目录下 `routes/*.js`，对每个导出 `{ path, handler }` 形状的模块，自动注册到 `routes[path]`。`GET /iso` 返回 HTTP 200，Body 为 JSON 对象含 `iso` 字段，值为当前 UTC 时刻 ISO 8601 毫秒精度 Z 结尾字符串。未知路径返回 HTTP 404 + `{"error":"not_found"}`。任意非 GET 方法返回 HTTP 405 + `{"error":"method_not_allowed"}`。所有响应 `Content-Type: application/json`。

模块导出 `createServer(port): Promise<http.Server>` 与 `routes: Record<string, (req, res) => void>`。

**仓库根新建** `vitest.config.ts`，`test.include` 显式含 `sprints/tests/**/*.test.ts`（可与默认通配并存，但必须字面量含 `sprints/tests`），确保 `./node_modules/.bin/vitest run sprints/tests/<wsN>/` 能发现本合同声明的所有 BEHAVIOR 测试文件——为 Red/Green 信号提供环境级锁定。

**硬阈值**:
- `GET /iso` status == 200，Body.iso 匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`，毫秒时间戳与 `Date.now()` 差 ≤ 5000 ms
- 响应头 `content-type` 含 `application/json`
- `GET /unknown-xyz` status == 404，Body == `{"error":"not_found"}`
- `POST /iso` status == 405，Body == `{"error":"method_not_allowed"}`
- `createServer(0)` 返回已监听的 `http.Server`，`server.address().port` 为正整数
- `module.exports.routes` 为对象，**含** `/iso` 键（WS1 全时态断言；WS2/WS3 合并后可能多 `/timezone`、`/unix` 键，**不做排他断言**）
- `time-api.js` 源文件**不含** `/timezone`、`/unix`、`Intl.DateTimeFormat`、`resolvedOptions`、`Math.floor`、`'timezone'`、`'unix'` 字面量（物理隔离契约·全时态合同）
- **PRD 兼容层 runtime**：`node --test scripts/harness-dogfood/__tests__/iso.test.js` exit 0 且 `# pass [1-9]`；`not-found.test.js` 同理
- **仓库根 `vitest.config.ts` 存在**，内容含 `include` 与 `sprints/tests`（Round 4 新增）
- **`./node_modules/.bin/vitest run sprints/tests/ws1/` 扫到 1 个 test file、报告 `Tests N (failed|passed) (9)`**（Round 4 新增）

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/iso.test.ts`，**9 个 it**，Round 4 从 10 删到 9）:
- `it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式')`
- `it('GET /iso 的 Content-Type 为 application/json')`
- `it('GET /iso 的 iso 字段对应时间与当前时间相差不超过 5 秒')`
- `it('GET /unknown-xyz 返回 404 且 body 为 {error:"not_found"}')`
- `it('POST /iso 返回 405 且 body 为 {error:"method_not_allowed"}')`
- `it('createServer(0) 返回已监听的 server，address().port 为正整数')`
- `it('time-api.js 源码不含 timezone/unix 相关字面量（物理隔离契约·全时态）')` — Round 4 改名：去掉"独立态"措辞
- `it('PRD 兼容层 runtime：node --test __tests__/iso.test.js exit 0')`
- `it('PRD 兼容层 runtime：node --test __tests__/not-found.test.js exit 0')`

**（Round 4 删除）** ~~`it('WS1 独立态：routes 对象仅含 /iso，不含 /timezone 或 /unix')`~~——时态耦合，Final E2E 必红，致命正确性 bug。

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws1.md`）:
- `scripts/harness-dogfood/time-api.js` 文件存在
- `scripts/harness-dogfood/routes/iso.js` 文件存在（物理分文件的第一块）
- time-api.js 导出 `createServer`
- time-api.js 导出 `routes` 对象
- time-api.js 含 `fs.readdirSync` 目录扫描（routes 自动加载器）
- time-api.js 含 `process.env.PORT` 读取
- time-api.js 含 `require.main === module` 直跑分支
- time-api.js 含 `not_found`、`method_not_allowed` 字面量
- time-api.js **不含** `/timezone`、`/unix`、`'timezone'`、`'unix'` 字面量
- time-api.js 不引入非 Node 内置模块
- routes/iso.js 导出 `{path: '/iso', handler}` 形状
- routes/iso.js 含 `toISOString` 调用
- `__tests__/iso.test.js` 存在且使用 `node:test`
- `__tests__/not-found.test.js` 存在且使用 `node:test`
- 两个 `__tests__/*.test.js` 可被 `node --test` 运行成功（stdout `^# pass [1-9]`）
- **Round 4 新增**：仓库根 `vitest.config.ts`（或 .mjs/.js/.workspace.ts）存在
- **Round 4 新增**：该 vitest 配置含 `include` 关键字且字面量包含 `sprints/tests`
- **Round 4 新增**：`vitest run sprints/tests/ws1/` stderr/stdout 不含 `No test files found`
- **Round 4 新增**：`vitest run sprints/tests/ws1/` stdout 含路径 `sprints/tests/ws1/iso.test.ts`
- **Round 4 新增**：`vitest run sprints/tests/ws1/` 摘要行 `Test Files N (failed|passed) (1)` 且 `Tests N (failed|passed) (9)` 精确匹配

---

## Feature 2: `/timezone` 端点

**行为描述**:
新增 `scripts/harness-dogfood/routes/timezone.js`，导出 `{path: '/timezone', handler}`。handler 返回 HTTP 200 JSON `{timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`。**不改** `time-api.js` 与 `vitest.config.ts` —— routes 自动加载器会在下次 require 时发现新文件并注册 `routes['/timezone']`。同时新增 `__tests__/timezone.test.js`（node:test runtime 兼容层）。

**硬阈值**:
- `GET /timezone` status == 200
- Body.timezone 为非空 string
- Body.timezone **严格等于** `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`
- 响应头 `content-type` 含 `application/json`
- `module.exports.routes['/timezone']` 为 function（自动加载器识别）
- **WS2 合并后 `/iso` 仍正常 200 响应**（骨架未被污染）
- **WS2 合并后 time-api.js 源码不含** `/timezone`、`Intl.DateTimeFormat`、`resolvedOptions`、`'timezone'` 四个字面量
- **WS2 本次 PR diff 不含** `scripts/harness-dogfood/time-api.js`、`vitest.config.ts`
- `node --test scripts/harness-dogfood/__tests__/timezone.test.js` exit 0（runtime 兼容层）
- **Round 4 新增**：`vitest run sprints/tests/ws2/` 扫到 `timezone.test.ts`，`Tests N (failed|passed) (7)` 精确匹配

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws2/timezone.test.ts`，**7 个 it**）:
- `it('GET /timezone 返回 200 且 timezone 字段为非空字符串')`
- `it('GET /timezone 返回的 timezone 严格等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）')`
- `it('GET /timezone 的 Content-Type 为 application/json')`
- `it('routes["/timezone"] 为 handler 函数（自动加载器识别新文件）')`
- `it('WS2 合并后 /iso 端点仍正常 200 响应（骨架未被污染）')`
- `it('WS2 合并后 time-api.js 源码不含 timezone 相关字面量（物理隔离契约）')`
- `it('PRD 兼容层 runtime：node --test __tests__/timezone.test.js exit 0')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws2.md`）:
- `scripts/harness-dogfood/routes/timezone.js` 存在
- routes/timezone.js 导出 `{path, handler}` 形状
- routes/timezone.js 含 `Intl.DateTimeFormat`、`resolvedOptions`、`/timezone`、`'timezone'` 字面量
- `__tests__/timezone.test.js` 存在且使用 `node:test` + 真 require time-api.js + `node --test` exit 0
- **time-api.js 源文件不含** `/timezone`、`Intl.DateTimeFormat`、`resolvedOptions`、`'timezone'`（负向断言）
- WS1 骨架存续正向断言：time-api.js 仍含 `not_found`、`method_not_allowed`、`readdirSync`
- **Round 4 新增**：`vitest run sprints/tests/ws2/` 发现 timezone.test.ts，摘要 Tests 计数为 7

---

## Feature 3: `/unix` 端点

**行为描述**:
新增 `scripts/harness-dogfood/routes/unix.js`，导出 `{path: '/unix', handler}`。handler 返回 HTTP 200 JSON `{unix: Math.floor(Date.now()/1000)}`，正整数。**不改** `time-api.js` 与 `vitest.config.ts`。新增 `__tests__/unix.test.js`（node:test）。

**硬阈值**:
- `GET /unix` status == 200
- Body.unix 为 integer，`> 0`，`Math.abs(Body.unix - Math.floor(Date.now()/1000)) <= 5`
- Body.unix 不是毫秒级：`Body.unix < Math.floor(Date.now()/1000) * 100`
- 响应头 `content-type` 含 `application/json`
- `module.exports.routes['/unix']` 为 function
- **WS3 合并后 `/iso` 仍正常 200 响应**（骨架未被污染）
- **WS3 合并后 time-api.js 源码不含** `/unix`、`Math.floor`、`'unix'` 字面量
- **WS3 本次 PR diff 不含** `scripts/harness-dogfood/time-api.js`、`vitest.config.ts`
- `node --test scripts/harness-dogfood/__tests__/unix.test.js` exit 0
- **Round 4 新增**：`vitest run sprints/tests/ws3/` 扫到 `unix.test.ts`，`Tests N (failed|passed) (8)` 精确匹配

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws3/unix.test.ts`，**8 个 it**）:
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
- routes/unix.js 导出 `{path, handler}`，含 `Math.floor(Date.now()/1000)`、`/unix`、`'unix'` 字面量
- `__tests__/unix.test.js` 存在且使用 `node:test` + 真 require + `node --test` exit 0
- **time-api.js 源文件不含** `/unix`、`Math.floor`、`'unix'` 字面量（负向断言）
- WS1 骨架存续正向断言：time-api.js 仍含 `not_found` 等
- **Round 4 新增**：`vitest run sprints/tests/ws3/` 发现 unix.test.ts，摘要 Tests 计数为 8

---

## Feature 4: E2E 冒烟脚本 + README

**行为描述**:
`scripts/harness-dogfood/e2e.sh` 为可执行 bash 脚本；**必须读 PORT 环境变量默认值展开形态**（`${PORT:-18080}` / `${PORT-18080}` / `: ${PORT:=18080}` 三种之一；纯硬编码 `PORT=18080` 赋值不算）；按顺序访问 `/iso`、`/timezone`、`/unix`；对每个响应做字段级格式校验（ISO 正则、timezone 非空、unix 秒级正整数）；全部通过 exit 0；任一失败或连接错 exit ≠ 0 + stderr 错误摘要。`README.md` 含启动命令 + E2E 调用说明。

**硬阈值**:
- 服务已启动时，`PORT=<运行端口> bash scripts/harness-dogfood/e2e.sh` exit == 0
- **有探针服务监听端口但只返回 HTTP 503** 时，`PORT=<探针端口> bash scripts/harness-dogfood/e2e.sh` exit != 0（Round 2 "空闲端口 → 竞争窗口" flaky 消除）
- e2e.sh 具备可执行权限位
- e2e.sh 引用 `/iso`、`/timezone`、`/unix` 三个路径
- e2e.sh 含 PORT **默认值展开形态**（正则 `\$\{PORT:-|\$\{PORT-|:\s*\$\{PORT:=`），**不含** 行首硬编码 `PORT=` 赋值
- README.md 存在，含启动命令与 E2E 调用说明
- **Round 4 新增**：`vitest run sprints/tests/ws4/` 扫到 `e2e.test.ts`，`Tests N (failed|passed) (8)` 精确匹配

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws4/e2e.test.ts`，**8 个 it**）:
- `it('e2e.sh 文件存在')`
- `it('e2e.sh 具备可执行权限位')`
- `it('服务已启动 + PORT 环境变量指向运行端口时，e2e.sh exit 0')`
- `it('端口有 503 探针服务时，e2e.sh exit 非 0（无竞争窗口）')`
- `it('e2e.sh 源码含 PORT 默认值展开形态（${PORT:-} 或等效，非硬编码赋值）')`
- `it('README.md 文件存在')`
- `it('README 含启动命令 node scripts/harness-dogfood/time-api.js')`
- `it('README 含 E2E 冒烟脚本调用说明')`

**ARTIFACT 覆盖**（落在 `sprints/contract-dod-ws4.md`）:
- e2e.sh 存在且可执行，bash shebang + `set -e` 族
- e2e.sh 引用三个端点路径
- e2e.sh 含 PORT **默认值展开形态**，**不含** 行首硬编码 `PORT=` 赋值
- README.md 存在，含启动命令 + E2E 说明
- **Round 4 新增**：`vitest run sprints/tests/ws4/` 发现 e2e.test.ts，摘要 Tests 计数为 8

---

## Workstreams

workstream_count: 4

### Workstream 1: HTTP server 骨架 + routes 自动加载器 + /iso + 404/405 + 仓库根 vitest 配置

**范围**: 新建 `scripts/harness-dogfood/time-api.js`（HTTP server + handler dispatch + 404/405 + routes 目录自动加载器 + `require.main === module` 分支读 `PORT` 默认 18080）；新建 `scripts/harness-dogfood/routes/iso.js`（`/iso` 实现）；新建 `scripts/harness-dogfood/__tests__/iso.test.js` 与 `scripts/harness-dogfood/__tests__/not-found.test.js`（均用 Node 内置 `node:test`）；**Round 4 新增** `vitest.config.ts`（仓库根，`test.include` 含 `sprints/tests/**/*.test.ts`）。

**大小**: M（time-api.js ~70-100 行 + routes/iso.js ~10-15 行 + 2 个 node:test 兼容层 ~60-80 行 + vitest.config.ts ~10-15 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/iso.test.ts`（9 个 it）

**文件独占性声明**: WS1 是唯一允许新建 `time-api.js` 与 `vitest.config.ts` 的 WS。WS2/WS3/WS4 的 PR diff **不得**包含这两个文件。

### Workstream 2: `/timezone` 端点（只新增文件，不改 time-api.js / vitest.config.ts）

**范围**: 新建 `scripts/harness-dogfood/routes/timezone.js` 与 `scripts/harness-dogfood/__tests__/timezone.test.js`。**禁止修改** `time-api.js`、`vitest.config.ts`、`routes/iso.js`、`__tests__/iso.test.js`、`__tests__/not-found.test.js`。依赖 WS1 的 routes 自动加载器识别新文件。

**大小**: S（routes/timezone.js ~10-15 行 + 兼容层测试 ~30-40 行）

**依赖**: WS1

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/timezone.test.ts`（7 个 it）

### Workstream 3: `/unix` 端点（只新增文件，不改 time-api.js / vitest.config.ts）

**范围**: 新建 `scripts/harness-dogfood/routes/unix.js` + `scripts/harness-dogfood/__tests__/unix.test.js`。**禁止修改** `time-api.js` / `vitest.config.ts` / WS1 / WS2 任何文件。

**大小**: S（routes/unix.js ~10-15 行 + 兼容层测试 ~30-40 行）

**依赖**: WS1；与 WS2 **无文件交集、无顺序耦合**

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws3/unix.test.ts`（8 个 it）

### Workstream 4: E2E 冒烟脚本 + README

**范围**: 新建 `scripts/harness-dogfood/e2e.sh`（可执行 bash，PORT 默认值展开形态） + `scripts/harness-dogfood/README.md`。**不触达**任何 .js 文件或 vitest 配置文件。

**大小**: S（e2e.sh ~40-60 行 + README ~30 行）

**依赖**: WS1 + WS2 + WS3

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws4/e2e.test.ts`（8 个 it）

---

## 合并顺序与变更隔离

**拓扑 DAG**: `WS1 → {WS2, WS3} → WS4`

**git 冲突消除机制（物理级）**:
- WS 间文件交集 = ∅（见 `## 架构调整` 表格）
- WS2 与 WS3 **并行提交并同时合并**时，git 只需对不同文件 add，无任何文件同行/同区块改动
- 每个 WS 的 DoD 含 "本 WS 引入的文件列表严格等于契约声明" + "time-api.js 在本 WS 未被修改" 两条断言（Round 4 扩展：vitest.config.ts 同样不得被 WS2/3/4 修改）

**骨架不被污染的三层防线（Round 4 仍然三层，但 BEHAVIOR 层只留全时态合同）**:
1. **物理层**：WS2/WS3/WS4 的 diff 根本不含 time-api.js/vitest.config.ts → `git diff --name-only` 断言
2. **ARTIFACT 层**：time-api.js 源码不得含该 WS 专属字面量 → DoD 负向断言（全时态成立）
3. **BEHAVIOR 层（全时态）**：WS2/WS3 合并后 `/iso` 仍正常 200 响应 + time-api.js 源码不含该 WS 字面量（全时态）→ tests/ws{2,3}/ 显式 it

---

## PRD 兼容层：Round 3 架构沿用（Round 4 不变）

PRD "预期受影响文件" 列的 4 个 `__tests__/*.test.js` 使用 Node 18+ 内置 `node:test` + `node:assert/strict`，自己 `require('../time-api.js')` → `createServer(0)` → fetch → 断言 → close server。

| 文件 | 所属 WS | 合同要求 |
|---|---|---|
| `__tests__/iso.test.js` | WS1 | `node --test` exit 0 + `^# pass [1-9]` |
| `__tests__/not-found.test.js` | WS1 | 同上 |
| `__tests__/timezone.test.js` | WS2 | 同上 |
| `__tests__/unix.test.js` | WS3 | 同上 |

**为何 node:test 不违反 SC-006**: Node 18+ 原生内置 `node:test` 与 `node:assert`，属于"仅 Node 标准库"范畴。

---

## R6 PORT 匹配收紧（Round 3 架构沿用）

`e2e.sh` 源码必须含正则 `\$\{PORT:-|\$\{PORT-|:\s*\$\{PORT:=` 三种默认值展开形态之一；**不得**含行首硬编码 `PORT=` 赋值（`^PORT=` 或 `^PORT="` 或 `^PORT='`）。

---

## WS4 端口空闲测试改 503 探针（Round 3 架构沿用）

测试启一个永远返回 HTTP 503 的 probe server 持续占住端口，e2e.sh 拿到 503 必 exit ≠ 0。无竞争窗口。

---

## Round 4 新增：Red/Green 信号锁死（vitest discovery 契约）

对 Round 3 Reviewer 指出的 "空 test() 壳绕过" 担忧，Round 4 追加**第二道环境级防线**（node:test TAP 已是第一道）：

### 为什么需要

vitest 1.6.1 没有 `vitest list` 子命令；vitest 默认扫 `**/*.{test,spec}.{js,ts,tsx}`。如果仓库环境变动（例如后续有人加个 `vitest.config.ts` 限制 include 路径），我们的 BEHAVIOR 测试可能被 silently skipped——Red 看似"未 FAIL"（因为根本没跑），Green 看似"passed"（同样没跑）。

### 锁死机制

**WS1 DoD 新增**（仓库根 vitest 配置）:
1. 仓库根存在 `vitest.config.ts`（或 .mjs/.js/.workspace.ts）
2. 该文件内容含 `include` 且字面量含 `sprints/tests`

**每 WS DoD 新增**（`vitest run sprints/tests/wsN/` 三元锁）:
1. `vitest run sprints/tests/wsN/` stderr/stdout 不含 `No test files found`
2. stdout 明确含 `sprints/tests/wsN/<file>.test.ts` 路径（vitest 扫到本 WS 文件的硬证据）
3. 摘要 `Tests N (failed|passed) (<N>)` 的 `(<N>)` 精确匹配本合同声明数：WS1=9 / WS2=7 / WS3=8 / WS4=8

三条同时满足才算通过。任一 FAIL 都说明"测试没真跑"，自动 REVISION。Red 阶段期望 `N failed (<N>)`；Green 阶段期望 `N passed (<N>)`——数字一致即合规。

### 对 Generator 的合规选项

最简实现：仓库根创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'sprints/tests/**/*.test.ts',
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
  },
});
```

（第一条显式 sprints，第二条保留默认兼容已有子包测试）

---

## Test Contract

| WS | BEHAVIOR Test File | it() 数 | Red 本地实测 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/iso.test.ts` | **9**（Round 4：10→9，删 WS1 独立态 routes it） | `./node_modules/.bin/vitest run sprints/tests/ws1/` → `Test Files 1 failed (1) / Tests 9 failed (9)` |
| WS2 | `sprints/tests/ws2/timezone.test.ts` | 7 | `./node_modules/.bin/vitest run sprints/tests/ws2/` → `Test Files 1 failed (1) / Tests 7 failed (7)` |
| WS3 | `sprints/tests/ws3/unix.test.ts` | 8 | `./node_modules/.bin/vitest run sprints/tests/ws3/` → `Test Files 1 failed (1) / Tests 8 failed (8)` |
| WS4 | `sprints/tests/ws4/e2e.test.ts` | 8 | `./node_modules/.bin/vitest run sprints/tests/ws4/` → `Test Files 1 failed (1) / Tests 8 failed (8)` |

**全量本地跑**: `./node_modules/.bin/vitest run sprints/tests/` → `Test Files 4 failed (4) / Tests 32 failed (32)`（本地实测已复现，见本轮 commit 推送前 terminal 输出）。

**Green 判据**: Generator 按四个 DoD 实现后，上述命令应输出 `Test Files 4 passed (4) / Tests 32 passed (32)`。

---

## 合同外不做（CONTRACT IS LAW 边界）

PRD "不在范围内"：Generator 不得实现鉴权 / HTTPS / CORS / 日志 / 指标 / 写接口 / 持久化 / Brain 注册 / Docker。

PRD "预期受影响文件" 的 4 个 `__tests__/*.test.js` 全部纳入且 runtime 真跑。Round 4 新增的 `vitest.config.ts` 虽不在 PRD "预期受影响文件" 列，但 PRD SC-006 "仅 Node 标准库" 说的是**时间服务**本身，测试配置不在此限；vitest 是本仓库既有 devDependency，配置文件符合仓库惯例。

---

## 风险处置记录（Round 3 → Round 4）

| # | Round 3 问题 | 等级 | Round 4 处置 |
|---|---|---|---|
| 1 | WS1 独立态 `it('routes 仅含 /iso，不含 /timezone 或 /unix')` 在 main 上 WS2 合并后必红（routes['/timezone'] 变 function），Final E2E 永远 fail → Initiative 永远到不了 `done` | **致命正确性** | 删除该 it。物理隔离契约已在 ARTIFACT 负向字面量层独立充分证伪（time-api.js 不含 /timezone/…）。另一条 `time-api.js 源码不含 timezone/unix 字面量` 改名去掉"独立态"措辞——它实为**全时态合同**，全时态成立。WS1 从 10 it → 9 it |
| 2 | Round 3 只堵 node:test 空壳（`# pass [1-9]` 校验），没堵 vitest 本身发现失败——如果 vitest 配置被改或仓库环境变动，BEHAVIOR 测试 silently skip，Red 看似"未 FAIL"、Green 看似"passed"，信号失灵 | 正确性 | **WS1 范围新增**仓库根 `vitest.config.ts`（显式 `test.include` 含 `sprints/tests/**/*.test.ts`）+ **每 WS DoD 新增 3 条 ARTIFACT**（未报 No test files / stdout 含本 WS 测试文件路径 / 摘要 Tests 计数精确匹配合同声明数）。任一 FAIL 说明测试没真跑，REVISION |

**Mutation 挑战预案（Round 4 补强）**：
- Generator 如果不写 vitest.config.ts → WS1 DoD 的 "vitest.config.ts 存在" ARTIFACT FAIL
- Generator 如果 vitest.config.ts 的 include 写成 `'nonsense'` → WS1 DoD 的 "include 含 sprints/tests" ARTIFACT FAIL
- Generator 如果 vitest.config.ts 的 include 排除了 ws2 → WS2 DoD 的 "vitest run ws2 stdout 含 timezone.test.ts" ARTIFACT FAIL
- Generator 如果只写 1 个真 it + 8 个 skipped/empty test 假通过 → WS1 DoD 的 "Tests N (passed) (9)" 摘要行 `(9)` 检查 FAIL（跑 Green 阶段时 skipped 会是 `skipped (N)` 不是 `passed (N)`）
- Round 3 已有的 Mutation 预案（搬 timezone 实现回 time-api.js / 删 /iso handler / node:test 空壳）全部保留有效

---

## Round 4 合规性自检

| 条目 | 结果 |
|---|---|
| 每个 GWT 场景被覆盖（1/2/3/4/5） | ✓ 场景 1+5 → WS1；场景 2 → WS2；场景 3 → WS3；场景 4 → WS4 |
| BEHAVIOR 测试路径规范 `sprints/tests/ws{N}/*.test.ts` | ✓ |
| ARTIFACT DoD 文件 `sprints/contract-dod-ws{N}.md` 仅 [ARTIFACT] 条目 | ✓ |
| Workstream 切分独立可测，文件交集 = ∅ | ✓（含 vitest.config.ts） |
| Red 证据可复现 | ✓ 本地 `./node_modules/.bin/vitest run sprints/tests/` → 32/32 per-it FAIL（9+7+8+8=32） |
| PRD "预期受影响文件"完整覆盖 | ✓ 4 个 `__tests__/*.test.js` + runtime 真跑 |
| 致命正确性 bug 修复（WS1 独立态 it）| ✓ 已删 `it('routes 仅含 /iso...')`，保留全时态合同 it |
| Red/Green 信号锁死（vitest discovery）| ✓ WS1 新增 vitest.config.ts + 每 WS 3 条锁死 ARTIFACT |
