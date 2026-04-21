# Sprint Contract Draft (Round 2)

对应 PRD: `sprints/sprint-prd.md` — Brain GET /api/brain/time 端点

## Round 1 Reviewer 反馈回应

| 风险 | Reviewer 指出 | Round 2 回应 |
|---|---|---|
| 风险 2（timezone 硬阈值弱） | `typeof === 'string' && length > 0` 放行 `"abc"` / `"1"` / `""`（trim 前） | 新增硬阈值：timezone 必须匹配 IANA 正则 `^(UTC\|[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?)$`；新增 `timezone round-trips through Intl.DateTimeFormat` 测试（非法 IANA 会抛 RangeError）|
| 风险 3（BEHAVIOR 从未触碰 server.js） | 7 个 it 全挂私有 `express()`，笔误 `/api/brain/times` 或条件分支注册都能过 | 双管齐下：① 合同侧新增 `[BEHAVIOR-STATIC]` describe，以 `readFileSync(server.js)` 做严格静态语义检查（路径字面量精确、顶层注册、import 精确）② DoD 新增 [ARTIFACT]，强制 `packages/brain/tests/time.test.js` import `packages/brain/server.js` default export 做真实 supertest，把"从 server.js 入口可达"锁到 Green commit |

## Feature 1: GET /api/brain/time 时间探针端点

**行为描述**:
Brain 暴露一个无鉴权、无副作用的只读 HTTP 端点，调用方通过 `GET /api/brain/time` 拿到 Brain 进程当前的标准化时间信息。每次调用独立计算当前时间，不缓存，字段严格为 `iso` / `timezone` / `unix` 三项。三个字段同源同一时刻，`iso` 与 `unix` 之间必须自洽。路由必须从 `packages/brain/server.js` 顶层入口挂载到 `/api/brain/time`，不能放在任何条件分支内。

**硬阈值**:

- HTTP 状态码严格 `200`
- 响应 `Content-Type` 以 `application/json` 开头
- 响应体顶层字段名排序后等于 `['iso', 'timezone', 'unix']`（不多不少）
- `iso` 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（UTC 毫秒 ISO-8601）
- `timezone` 满足：
  - `typeof === 'string'` 且 `length > 0`
  - 匹配 IANA 正则 `^(UTC|[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?)$`
  - 能被 `new Intl.DateTimeFormat('en-US', { timeZone })` 接受（非法值会抛 RangeError）
- `unix` 满足 `Number.isInteger === true`，且落在调用前后 1 秒窗口内
- `|Math.floor(new Date(iso).getTime()/1000) - unix| <= 1`
- 两次调用之间 sleep 1.1 秒，`unix` 严格递增（禁止缓存/静态值）
- **server.js 挂载点**：字面量 `'/api/brain/time'`（禁止 `/api/brain/times` 等形变）；`app.use(...)` 注册行出现在 server.js 顶层（零缩进），不在 `if`/`try`/`else`/`function` 块内
- **生产侧测试可达性**：`packages/brain/tests/time.test.js` 必须 `import` server.js default export 并用 supertest 请求 `GET /api/brain/time` 返回 200（保证 SC-001 自动化）

**BEHAVIOR 覆盖**（落在 `sprints/tests/ws1/time.test.js`）:

*第一组 — 私有 express 挂载 router（功能行为）*:

- `it('responds with HTTP 200 and application/json on GET /api/brain/time')`
- `it('response body has exactly three keys: iso, timezone, unix')`
- `it('iso is an ISO-8601 UTC millisecond string')`
- `it('timezone is a valid IANA zone matching UTC or Area/Location(/Sub)')`
- `it('timezone round-trips through Intl.DateTimeFormat without throwing')`
- `it('unix is an integer within 1 second of current wall clock')`
- `it('iso and unix represent the same moment within 1 second tolerance')`
- `it('two consecutive calls spaced 1.1 seconds return different unix values')`

*第二组 — server.js 静态语义完整性（挂载点）*:

- `it('server.js can be read and contains no obvious typo around /api/brain/time')` — 负向前瞻禁 `/api/brain/times`
- `it('server.js imports timeRoutes default export from ./src/routes/time.js')` — 行级精确 import
- `it('server.js registers app.use with exact path /api/brain/time bound to timeRoutes')` — 路径+参数双向精确
- `it('app.use(/api/brain/time, ...) line is at top level (not nested in if/try/else block)')` — 零缩进行检查

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:

- `packages/brain/src/routes/time.js` 存在且 `export default` 是 Express Router
- 路由文件注册 `GET /` 处理器
- `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'`（行级精确）
- `packages/brain/server.js` 注册 `app.use('/api/brain/time', timeRoutes)`（路径字面量精确，禁 `/api/brain/times` 形变）
- `packages/brain/server.js` 注册行为顶层（零缩进）—— Reviewer 风险 3 回应
- `packages/brain/tests/time.test.js` 存在
- `packages/brain/tests/time.test.js` 既 import 实际路由模块，也 **import `packages/brain/server.js` default export 做 supertest**（Reviewer 风险 3 回应）
- `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 区块包含字面量 `/api/brain/time`

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**:

1. 新增 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}`）
2. 在 `packages/brain/server.js` 顶部 import 时间路由 + 在路由注册区（顶层，零缩进）增加 `app.use('/api/brain/time', timeRoutes)`
3. 新增 `packages/brain/tests/time.test.js`（必须 import server.js 做真实 supertest，不仅是私有 express app）
4. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 追加一行说明此端点

**大小**: S（总改动预计 <100 行）

**依赖**: 无（纯增量，不依赖其他 workstream）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.js`

**时区取值策略**（对应 PRD ASSUMPTION）:

1. 优先 `process.env.TZ`（必须先用 `Intl.DateTimeFormat` 校验 IANA 合法性，不合法降级）
2. 次选 `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. 仍缺或非 IANA → `'UTC'`

每次响应都重新计算，禁止模块级缓存。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | 8 个功能 it + 4 个 server.js 静态完整性 it = **12 个** | `npx vitest run --config ./vitest.sprint.config.mjs` → **12 tests failed (12)**（功能组：动态 import `packages/brain/src/routes/time.js` 不存在 → 8 failed；静态组：server.js 尚未写入 import 与 app.use → 4 failed）|

**运行命令**:

```bash
npx vitest run --config ./vitest.sprint.config.mjs --reporter=verbose
```

---

## Red 证据说明（Round 2 本地实跑）

```
 Test Files  1 failed (1)
      Tests  12 failed (12)
```

分组：

- 功能 BEHAVIOR（8）：`Failed to load url ../../../packages/brain/src/routes/time.js. Does the file exist?` — 每个 it 独立红
- 静态 BEHAVIOR（4）：
  - `server.js can be read and contains no obvious typo...` → server.js 当前不含 `/api/brain/time` 字面量，regex 不命中
  - `server.js imports timeRoutes...` → 当前无此 import 行
  - `server.js registers app.use with exact path...` → 当前无此注册
  - `app.use(/api/brain/time, ...) line is at top level...` → 当前无命中，`hits.length >= 1` 失败

根因：Generator commit 2 将创建 `packages/brain/src/routes/time.js` 与 server.js 的两行注册；届时 12 个全部转 Green。
