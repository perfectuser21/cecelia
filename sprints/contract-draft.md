# Sprint Contract Draft (Round 1)

对应 PRD: `sprints/sprint-prd.md` — Brain GET /api/brain/time 端点

## Feature 1: GET /api/brain/time 时间探针端点

**行为描述**:
Brain 暴露一个无鉴权、无副作用的只读 HTTP 端点，调用方通过 `GET /api/brain/time` 拿到 Brain 进程当前的标准化时间信息。每次调用独立计算当前时间，不缓存，字段严格为 `iso` / `timezone` / `unix` 三项。三个字段同源同一时刻，`iso` 与 `unix` 之间必须自洽。

**硬阈值**:

- HTTP 状态码严格 `200`
- 响应 `Content-Type` 以 `application/json` 开头
- 响应体顶层字段名排序后等于 `['iso', 'timezone', 'unix']`（不多不少）
- `iso` 匹配正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`（UTC 毫秒 ISO-8601）
- `timezone` 是 `typeof === 'string'` 且 `length > 0`
- `unix` 满足 `Number.isInteger === true`，且落在调用前后 1 秒窗口内
- `|Math.floor(new Date(iso).getTime()/1000) - unix| <= 1`
- 两次调用之间 sleep 1.1 秒，`unix` 严格递增（禁止缓存/静态值）

**BEHAVIOR 覆盖**（这些在 tests/ws1/time.test.js 落成真实 it() 块）:

- `it('responds with HTTP 200 and application/json on GET /api/brain/time')`
- `it('response body has exactly three keys: iso, timezone, unix')`
- `it('iso is an ISO-8601 UTC millisecond string')`
- `it('timezone is a non-empty string')`
- `it('unix is an integer within 1 second of current wall clock')`
- `it('iso and unix represent the same moment within 1 second tolerance')`
- `it('two consecutive calls spaced 1.1 seconds return different unix values')`

**ARTIFACT 覆盖**（这些写进 contract-dod-ws1.md）:

- `packages/brain/src/routes/time.js` 存在且 `export default` 是 Express Router
- `packages/brain/server.js` 顶部 `import timeRoutes from './src/routes/time.js'`
- `packages/brain/server.js` 注册 `app.use('/api/brain/time', timeRoutes)`
- `packages/brain/tests/time.test.js` 存在（PRD 指定的生产侧测试位置）
- `CLAUDE.md` 的 "Brain 知识查询工具" 区块包含字面量 `/api/brain/time`

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /api/brain/time 端点 + 路由注册 + 文档同步

**范围**:

1. 新增 `packages/brain/src/routes/time.js`（Express Router，`GET /` 返回 `{iso, timezone, unix}`）
2. 在 `packages/brain/server.js` 顶部 import 时间路由 + 在路由注册区增加 `app.use('/api/brain/time', timeRoutes)`
3. 新增 `packages/brain/tests/time.test.js`（由合同 `sprints/tests/ws1/time.test.js` 按仓库规范整体搬移 / 等价复用）
4. `CLAUDE.md` 第 7 节 "Brain 知识查询工具" 追加一行说明此端点

**大小**: S（总改动预计 <100 行）

**依赖**: 无（纯增量，不依赖其他 workstream）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.js`

**时区取值策略**（对应 PRD ASSUMPTION）:

1. 优先 `process.env.TZ`
2. 缺省回退 `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. 仍缺 → `'UTC'`

每次响应都重新计算，禁止模块级缓存。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.js` | HTTP 200 + JSON / 字段集 iso+timezone+unix 严格 3 项 / iso 正则 / timezone 非空字符串 / unix 整数近似当前 / iso-unix 一致性 / 两次调用递增 | `npx vitest run --config ./vitest.sprint.config.mjs` → 7 tests failed（动态 import 在每个 it 内懒加载，`packages/brain/src/routes/time.js` 尚未存在 → 每个 it 独立红）|

**运行命令**:

```bash
npx vitest run --config ./vitest.sprint.config.mjs --reporter=verbose
```

配置文件 `vitest.sprint.config.mjs` 只 include `sprints/tests/**/*.test.js`，不影响 brain 包自身的测试 include。

---

## Red 证据说明

Proposer 本地实际运行产出 `Tests 7 failed (7)`：

```
× sprints/tests/ws1/time.test.js > Workstream 1 — GET /api/brain/time [BEHAVIOR] > responds with HTTP 200 and application/json
× ... > response body has exactly three keys: iso, timezone, unix
× ... > iso is an ISO-8601 UTC millisecond string
× ... > timezone is a non-empty string
× ... > unix is an integer within 1 second of current wall clock
× ... > iso and unix represent the same moment within 1 second tolerance
× ... > two consecutive calls spaced 1.1 seconds return different unix values
→ Failed to load url ../../../packages/brain/src/routes/time.js. Does the file exist?
```

根因：测试用 `await import('../../../packages/brain/src/routes/time.js')` 懒加载，而该文件还不存在（Generator 将在 commit 2 阶段创建）。每个 it 独立暴露错误 → 7 failures 匹配 7 个 it()。
