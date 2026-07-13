# Design：warroom 数据层 2 个只读端点（relay-baton4 item1）

- 日期：2026-07-07
- 任务：Brain task 9782aa11 / 上游 docs/handoffs/202607070903-relay-baton4.md
- 分支：cp-07071709-warroom-readonly-api
- 审查：Research Subagent APPROVE（无路由冲突、无通配符截胡、表结构匹配）

## 目标

warroom 前端动态化（item2）的数据层前置：把已在库里的交接单与调度哨兵数据开只读口。
第三个端点（decisions/recent）按交接单规则跳过——server.js 既有 `GET /api/brain/decisions` 已支持 `made_by`/`limit` 过滤。

## 端点 1：GET /api/brain/handoffs

- 新文件 `packages/brain/src/routes/handoffs.js`，挂载 `src/routes.js` → `router.use('/handoffs', handoffsRouter)`
- Query：`limit`（默认 20，clamp 1..100）、`journey_id`（可选）
- SQL：`SELECT id, title, completed_at, result->'handoff' AS handoff FROM tasks WHERE result ? 'handoff'`
  - journey_id 过滤：`(result->'handoff'->>'journey_id' = $n OR payload->>'journey_id' = $n)`（handoff.journey_id 可为 null，payload 兜底，与 getRecentHandoffs 先例一致）
  - 排序：`ORDER BY (result->'handoff'->>'created_at') DESC NULLS LAST`
- 响应：`{ handoffs: [{ task_id, title, verdict, journey_id, created_at, next_steps, pr_urls }], total }`
  - title 优先 handoff.title，回退 tasks.title
  - pr_urls 取 `handoff.artifacts.pr_urls`（在 artifacts 下，不在顶层）
  - next_steps 数组原样返回（前端摘一行）
- 只读，出错 500 `{error}`

## 端点 2：GET /api/brain/sentinel/health

- 新文件 `packages/brain/src/routes/sentinel.js`，挂载 `router.use('/sentinel', sentinelRouter)`
- SQL 一次查：`SELECT key, value_json, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_seconds FROM working_memory WHERE key LIKE 'scheduler_job_last_run:%' OR key = 'scheduler_jobs_expected'`
  - age 在 SQL 内算（列是 timestamp without time zone，禁止 JS Date 直比）
- 响应：`{ jobs: [{ name, ok, age_seconds, at }], expected, healthy }`
  - name = key 去前缀 `scheduler_job_last_run:`；ok/at 来自 value_json（`{at, ok, detail|error|timedOut}`）
  - expected = `scheduler_jobs_expected` 的 `value_json->>'count'`（int，缺键 → null）
  - healthy = expected 非 null 且 jobs.length >= expected 且每个 job `ok === true` 且 `age_seconds <= 1800`
  - 已知边界：一轮 job 串行 worst case ~25min，单 handler 卡满 timeout 会瞬时 healthy=false——如实反映，消费方（哨兵灯）预期内

## 版本与门禁

- brain minor bump 1.238.6 → 1.239.0（纯新增 API）
- DevGate：facts-check + check-version-sync + `node --check server.js`
- 不改任何写路径；两文件均 ESM（`import pool from '../db.js'`）

## 测试策略

档位：**unit（route 级，mock pool）**——纯 SQL 装配 + JSON 变换，无外部接缝，CI test 即够（守卫死规矩：逻辑接缝 → CI test）。

- 惯例照 `routes/__tests__/harness-stats-by-journey.test.js`：`vi.mock('../../db.js')` + supertest
- handoffs 断言：倒序返回/journey_id 过滤参数化/limit clamp（>100→100，非法→20）/空库 `[]`/pr_urls 从 artifacts 提取
- sentinel 断言四种局面：全绿 healthy=true；job 数 < expected → false；某 job age>1800 → false；某 job ok=false → false；另加缺 expected 键 → healthy=false（expected=null）
- TDD：commit-1 失败测试，commit-2 实现变绿
