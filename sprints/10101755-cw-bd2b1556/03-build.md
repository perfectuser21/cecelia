---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# Build 总结

### B-1
对应：S-1

改动文件：`packages/brain/src/routes/strategic-decisions.js`
- 新增导出 `loadAllowedCategories({ fresh })`：查 `pg_get_constraintdef` 读 `decisions_category_chk`，正则 `/'([^']+)'::/g` 抽值、去重排序；成功缓存，`fresh` 绕过缓存重查；失败或查不到返回 `null` 且不缓存。另导出 `_resetAllowedCategoriesCache()`。代码中无手抄 category 列表。
- POST：status 校验后、INSERT 前调 `checkCategory`：`undefined/null/''` 跳过（默认 general）；非字符串 400；字符串先查缓存，未命中再 `fresh` 重读，仍不含才 400；任一次 `null` 放行。
- catch：`err.code==='23514' && err.constraint==='decisions_category_chk'` → 同形 400（allowed_categories 再取一次，取不到则 `[]` + 文案「category 非法」）；其它错误照旧 500。
- 400 体：`{ success:false, error:'category 非法，合法值：a|b|…', allowed_categories:[…] }`，不含约束名 / SQL 原文。GET/PUT 未动。

新增测试：`packages/brain/src/routes/__tests__/strategic-decisions-category.test.js`（8 用例：非法字符串 400 且无 SQL 泄露无 INSERT；数字/数组/对象/布尔 400；超长/大小写/带空格 400；合法 decision 201；不带/空串/null 默认 general 且不查约束；缓存过期重读放行 retro；约束读取失败 + INSERT 撞 23514 → 400 不泄露；其它 DB 错误仍 500）。

TDD 过程：
- 先跑 `cd packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-category.test.js` → 8 failed（`TypeError: _resetAllowedCategoriesCache is not a function`）。
- 实现后跑 `cd packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-category.test.js src/routes/__tests__/strategic-decisions-source-ref.test.js src/routes/strategic-decisions.test.js` → `Test Files 3 passed (3)`，`Tests 16 passed (16)`，退出码 0（回归两文件未改，均绿）。
- DevGate：`node scripts/facts-check.mjs` → All facts consistent；`bash scripts/check-version-sync.sh` → All version files in sync；`node packages/quality/scripts/devgate/check-dod-mapping.cjs` → 映射检查通过（295 项）。

提交 SHA：`cd24fd8ed`（测试与实现同一提交）

### B-2
对应：S-2

改动文件：
- 新增 `packages/brain/migrations/544_decisions_category_allow_general.sql`：`BEGIN; SET LOCAL lock_timeout='10s'`；DO 块读当前约束 def，`regexp_matches` 抽值（约束不存在时以 384 的 13 值为底），并 `{'general'}` 去重排序，`DROP CONSTRAINT IF EXISTS` 后 `EXECUTE format` 重建 `CHECK (category IS NULL OR category IN (...)) NOT VALID`；写 `schema_version '544'`（ON CONFLICT DO NOTHING）；`COMMIT`。
- 新增 `packages/brain/scripts/smoke/strategic-decisions-category-smoke.sh`：psql 断言约束含 general/decision/judgment/nfr/testing；curl 断言 workflow_bogus / 123 / 5000 字符均 400、带 allowed_categories、无 SQL 原文、未写库；写入段（不带 category→201、decision→201）经 `smoke-production-guard.mjs` 守护。
- `packages/quality/smoke-allowlist.txt` 登记该 smoke。

实际验证（MMV 本机 PG，scratch 库，未碰生产）：
- `createdb cecelia_scratch_544 && DB_NAME=cecelia_scratch_544 node packages/brain/src/migrate.js` → 退出码 0，`Applied: 531`（含 544）。约束输出：`CHECK (... ARRAY['architecture','bug-fix','decision','deployment','feature','general','governance','infra','invariant','judgment','nfr','small-change','technical','testing'] ...) NOT VALID`，同时含 general/nfr/judgment/testing。
- 再跑一次 migrate → `Applied: 0`，退出码 0，约束文本前后比对一致（「约束文本不变」）。
- 手工把约束改成 `('decision','judgment','kr3-config')`、删 schema_version 544 后重跑 → `Applied: 1`，约束为 `['decision','general','judgment','kr3-config']`，kr3-config 保留（只增不减）。
- 恢复约束后，起仅挂本路由的 express（DB_NAME=cecelia_scratch_544，端口 15544）跑 smoke：5 条 PASS（约束含 general 等、workflow_bogus/123/5000 字符 → 400 无 SQL 原文、被拒未写库），写入段被防护脚本拦下（`写入未启用：需 SMOKE_ALLOW_WRITE=1`），退出码 0。
- 同服务手工 curl：不带 category、`""` → `category:"general"` success:true；`decision`、`judgment`(+source_ref) → success:true，写入成功。
- 验证结束 `dropdb --force cecelia_scratch_544`。

提交 SHA：`9a0daccf6`
