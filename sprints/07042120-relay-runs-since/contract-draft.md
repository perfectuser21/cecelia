# Contract Draft: relay-runs since 过滤

**Sprint**: 07042120-relay-runs-since
**Task ID**: 61fd2e5c-4c79-4184-8584-cab426596846
**Date**: 2026-07-04
**Branch**: cp-07042114-ws-61fd2e5c

---

## Test Contract

| # | [BEHAVIOR] 描述 | 测试命令 / 断言 |
|---|----------------|----------------|
| B-01 | FR-19: `?since=2026-07-04T00:00:00Z` → HTTP 200，SQL 含 `started_at >= $N` 绑定 | `GET /relay-runs?since=2026-07-04T00:00:00Z` → `res.status === 200`；`sql.match(/started_at\s*>=\s*\$\d+/i)` |
| B-02 | FR-19: `?since` 使用参数化绑定（非字符串拼接）— ISO 字符串不出现在 SQL 文本中 | `sql` 不含裸 ISO 字符串字面量；`params` 数组含 `'2026-07-04T00:00:00Z'` |
| B-03 | FR-19: 返回数组中每项都含 `started_at` 字段（防字段丢失回归） | `body[0]` 含 `started_at` 属性 |
| B-04 | FR-21: `?since=T&phase=A_planning&limit=5` → SQL 同时含三条件，params 含三值 | SQL 含 `/started_at\s*>=\s*\$\d+/i` AND `/phase\s*=\s*\$\d+/i`；`params` 含 `'2026-07-04T00:00:00Z'`、`'A_planning'`、`5` |
| B-05 | FR-21: `?since=T&limit=3`（无 phase）→ SQL 含 since 条件，不含 phase 条件 | SQL 含 since 条件；`sql` 不匹配 `/phase\s*=\s*\$\d+/i`；`params` 含 `3` |
| B-06 | FR-21: `?since=T&phase=done`（无 limit）→ SQL 含 since + phase 条件，默认 limit=20 | SQL 含 since 和 phase 条件；`params` 含 `20` |
| B-07 | FR-22: `?since=not-a-date` → HTTP 400 + `{ error: string }`，不执行 DB 查询 | `res.status === 400`；`typeof body.error === 'string'`；`mockPool.query` 未调用 |
| B-08 | FR-23: `?since=`（空字符串）→ HTTP 400 + `{ error: string }`，不执行 DB 查询 | `res.status === 400`；`typeof body.error === 'string'`；`mockPool.query` 未调用 |
| B-09 | FR-22: `?since=2026-13-99T00:00:00Z`（非法日期）→ HTTP 400 + `{ error: string }` | `res.status === 400`；`typeof body.error === 'string'` |
| B-10 | INV-3: `?since` 非法时，400 响应 `Content-Type: application/json` | `res.headers['content-type']` 匹配 `/application\/json/` |
| B-11 | INV-5: 不带 `?since` → SQL 不含 `started_at >=` 条件（向后兼容） | `sql` 不匹配 `/started_at\s*>=/i` |
| B-12 | INV-5: 不带 `?since`，`?limit=10` → SQL 不含 since，`params` 含 `10` | `sql` 不匹配 `/started_at\s*>=/i`；`params` 含 `10` |
| B-13 | INV-5: 不带任何参数 → 默认 limit=20，无 since/phase 条件（完整 INV-5 回归） | `params` 含 `20`；`sql` 不匹配 `/started_at\s*>=/i`；`sql` 不匹配 `/phase\s*=\s*\$\d+/i` |
| B-14 | FR-24: colErr 回退路径中 since 条件同样生效 — 第一次 query 抛含 'pr_url' 错误 → 回退 SQL 含 since | `mockPool.query` 调用两次；第二次 `sql` 匹配 `/started_at\s*>=\s*\$\d+/i`；第二次 `params` 含 since 值 |

---

## [ARTIFACT] Tests

测试文件：`packages/brain/src/__tests__/relay-runs-since.test.js`

运行命令：
```bash
# 只跑 since 相关测试
cd /workspace && npx vitest run packages/brain/src/__tests__/relay-runs-since.test.js

# 跑全部 relay-runs 相关测试（含既有四份）
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/relay-runs.test.js \
  packages/brain/src/__tests__/relay-runs-filter.test.js \
  packages/brain/src/__tests__/relay-runs-verdicts.test.js \
  packages/brain/src/__tests__/relay-v101.test.js \
  packages/brain/src/__tests__/relay-runs-since.test.js
```

断言覆盖矩阵：

| 测试用例 | HTTP 状态 | SQL 含 since 条件 | SQL 参数化绑定 | DB 未调用 | Content-Type JSON |
|----------|-----------|-------------------|---------------|-----------|-------------------|
| B-01 | 200 ✓ | ✓ | — | — | — |
| B-02 | — | — | ✓ | — | — |
| B-03 | — | — | — | — | — |
| B-04 | 200 ✓ | ✓ | ✓ | — | — |
| B-05 | — | ✓ | ✓ | — | — |
| B-06 | — | ✓ | ✓ | — | — |
| B-07 | 400 ✓ | — | — | ✓ | — |
| B-08 | 400 ✓ | — | — | ✓ | — |
| B-09 | 400 ✓ | — | — | — | — |
| B-10 | 400 ✓ | — | — | — | ✓ |
| B-11 | 200 ✓ | ✗（不含） | — | — | — |
| B-12 | 200 ✓ | ✗（不含） | — | — | — |
| B-13 | 200 ✓ | ✗（不含） | — | — | — |
| B-14 | 200 ✓ | ✓（第二次）| ✓ | — | — |

---

## NFR

| 编号 | 约束 | 验证方式 |
|------|------|----------|
| NFR-1 | 只读端点，不做任何 DB 写入（INV-6） | 测试中 mockPool.query 的 mock 只设置 SELECT 结果，无 INSERT/UPDATE/DELETE 调用 |
| NFR-2 | 错误响应格式统一为 `{ "error": string }`，不含 SQL/表名/stack trace（INV-4） | B-07/B-08/B-09 断言 body 结构；body 不含 'pg'/'table'/'column'/'sql' 关键词 |
| NFR-3 | 所有响应 Content-Type: application/json（INV-3） | B-10 断言 400 响应头 |
| NFR-4 | `?since` 参数使用参数化绑定（防 SQL 注入），ISO 字符串不直接拼入 SQL（FR-19） | B-02 断言 SQL 文本不含裸 ISO 字符串 |
| NFR-5 | 既有四份测试文件（relay-runs.test.js、relay-runs-filter.test.js、relay-runs-verdicts.test.js、relay-v101.test.js）零改动全绿（INV-2） | CI 跑全量测试套件确认 |
| NFR-6 | `?since` 合法性判断：`new Date(rawSince).getTime()` isNaN 或空字符串 → 非法（FR-23） | B-08/B-09 验证边界条件 |

---

## 铁律覆盖确认

| 铁律编号 | 铁律描述 | 覆盖状态 | 对应测试 |
|----------|----------|----------|---------|
| INV-1 | 所有响应字段名保持 snake_case，与 DB 列名完全一致，禁止 camelCase | 已覆盖 | B-03（`started_at` 字段存在） |
| INV-2 | 既有测试（四份）零改动保持全绿 | 已覆盖 | NFR-5，CI 全量跑四份既有测试 |
| INV-3 | 所有响应 Content-Type: application/json | 已覆盖 | B-10（400 响应头断言） |
| INV-4 | 错误响应不暴露内部信息；500 body 只含 `{ error: string }` | 已覆盖 | B-07/B-08/B-09（error 是 string，无内部泄露） |
| INV-5 | 不带 `?since` 时行为与当前完全一致（向后兼容） | 已覆盖 | B-11/B-12/B-13（三个向后兼容用例） |
| INV-6 | 只读端点，不做任何 DB 写入 | 已覆盖 | NFR-1（mock 无写入 call） |
| INV-7 | 不动详情端点 `GET /relay-runs/:initiative_id`；不加排序参数 | 已覆盖（范围排除） | 测试文件不包含详情端点 since 测试；B-01 SQL 断言含 `started_at DESC` 不变 |
| INV-8 | `?since` 非法格式 → 400 + `{ error: string }`（不到达 DB） | 已覆盖 | B-07/B-08/B-09（三种非法格式） |
| INV-9 | `?since` + `?phase` + `?limit` 三参数同时传入时三条件同时生效（AND 逻辑，单次 DB 查询） | 已覆盖 | B-04（三参数组合，单次 query 调用） |
