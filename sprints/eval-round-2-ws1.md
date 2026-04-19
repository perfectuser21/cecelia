# Eval Round 2 — WS-1 (default)

- **task_id**: 57ab38ad-dee3-43f4-80bc-8e5571ac4715
- **pr_url**: https://github.com/perfectuser21/cecelia/pull/2431
- **pr_branch**: cp-04191228-harness-57ab38ad-ws1
- **eval_round**: 2
- **verdict**: **FAIL**
- **评估时间**: 2026-04-19 UTC

## 摘要

Generator PR 创建了一个独立的路由文件 `packages/brain/src/routes/brain.js`，但**未在 `packages/brain/server.js` 中 import/mount 该 router**，导致 `/api/brain/ping` 在运行时返回 **404 Not Found**，而非合同要求的 `200 + application/json + { pong: true, timestamp }`。

另外 PR 同时修改了合同白名单之外的文件 `DoD.md` 与新增 `docs/learnings/cp-04191228-harness-generator.md`，违反 Feature 3 的硬阈值「diff 名单只能有 `packages/brain/src/routes/brain.js` 一行」。

## 验证证据

### 1. 文件变更范围（Feature 3 违规）

```
$ gh pr view 2431 --json files
files changed:
  - DoD.md                                               (+18/-27)  [NOT ALLOWED]
  - docs/learnings/cp-04191228-harness-generator.md      (+24/-0) ADDED  [NOT ALLOWED]
  - packages/brain/src/routes/brain.js                   (+9/-0)  ADDED  [allowed]
```

合同 Feature 3 硬阈值：`git diff --name-only main...HEAD` 输出**只有** `packages/brain/src/routes/brain.js` 一行 — 违反。

### 2. 新路由未接入 server.js（导致 Feature 1/2 全部失败）

检索结果：
```
$ grep -rn "routes/brain['\"]" packages/brain/
(no matches)
$ grep -rn "app.use('/api/brain'" packages/brain/server.js
(no matches — 没有任何 app.use('/api/brain', ...) 挂载语句)
```

`server.js` 现存的 mount 风格示例（均带子路径）：
- `app.use('/api/brain/memory', memoryRoutes);`
- `app.use('/api/brain/manifest', brainManifestRoutes);`
- …

新文件 `packages/brain/src/routes/brain.js` 无任何 import 引用，Express 从未注册 `/ping` 路由。

### 3. 临时 Brain 5222 实测 404

启动 PR 分支代码：
```
PORT=5222 BRAIN_EVALUATOR_MODE=true SKIP_MIGRATIONS=true node packages/brain/server.js
```

实测四条候选路径：
```
/ping              -> 404
/api/ping          -> 404
/api/brain/ping    -> 404   <- 合同要求的路径
/brain/ping        -> 404
```

`/api/brain/ping` 响应详情：
- HTTP 状态码：**404**（要求 200）
- Content-Type：**text/html; charset=utf-8**（要求 application/json）
- Body：Express 默认错误页 `Cannot GET /api/brain/ping`（要求 `{"pong": true, "timestamp": "..."}`）

## 失败清单（按合同硬阈值）

| 合同位置 | 要求 | 实测 | 结果 |
|---|---|---|---|
| Feature 1 | HTTP 200 | 404 | FAIL |
| Feature 1 | Content-Type application/json | text/html | FAIL |
| Feature 1 | body.pong === true | 无 body / HTML | FAIL |
| Feature 1 | body.timestamp 非空字符串 | 无 | FAIL |
| Feature 2 | timestamp ISO-8601 + 偏差 ≤60s + 单调递增 | 无法测（404） | FAIL |
| Feature 3 | diff 仅 `routes/brain.js` | 3 个文件 | FAIL |
| WS1 DoD-5 BEHAVIOR | 200 + json + pong + ts | 404 + html | FAIL |
| WS1 DoD-6 BEHAVIOR | ISO 合法 + 单调 | 无法测 | FAIL |
| WS1 DoD-7 BEHAVIOR | 无 auth 仍 200 | 404 | FAIL |
| WS1 DoD-8 BEHAVIOR | query string 容忍 | 404 | FAIL |

## 根因（给下一轮 fix 的提示）

单开一个 `packages/brain/src/routes/brain.js` 模块、却不在 `packages/brain/server.js` 中 `import` + `app.use('/api/brain', brainRouter)`，Express 永远不会知道这条路由存在。合同硬阈值「diff 只含 `routes/brain.js`」与「端点 200」之间**在当前 server.js 结构下存在矛盾**：要让新路由生效，至少还必须改动 `server.js`，或者直接在某个已挂载的文件里就地新增 `/ping` handler（不新建文件）。

两条可行修复路径：
1. **放弃新建文件**：在一个已挂载到 `/api/brain` 前缀的现有 router（例如新建时直接追加到 `server.js` 级别），或者找一个合适的已 mount 于子路径为 `''` 的路由重用。由于目前 server.js 全部采用 `/api/brain/<子路径>` mount 模式，需要新增一条 `app.use('/api/brain', brainRouter)`。
2. **坦然更新合同的 diff 白名单**：将合同硬阈值改为 `routes/brain.js` + `server.js` 两个文件，净增 ≤ 15 行。

附加：PR 还顺带改了 `DoD.md` 与新增 `docs/learnings/…md`，本轮视为合同范围外的文件污染，必须回滚。

## 裁决

**VERDICT: FAIL**

- 核心端点完全不可达（404）
- 改动范围越界

建议触发 fix round 3（eval_round = 3）。
