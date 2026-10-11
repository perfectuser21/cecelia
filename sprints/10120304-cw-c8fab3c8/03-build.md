---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# Build 总结：decisions_made_by_check 补 ai（只增不减）

### B-1
- 对应：S-1
- 改动文件：新增 `packages/brain/migrations/552_decisions_made_by_allow_ai.sql`（552 开工时空闲，未顺延）
- 内容：`BEGIN; SET LOCAL lock_timeout='10s'`；DO 块按 made_by 列的 attnum 查找 decisions 上全部 CHECK（不看约束名）；多列 → `RAISE EXCEPTION`（含「多列」）；定义抽不出取值 → `RAISE EXCEPTION`（含「无法解析」）；无约束时以 user/cecelia/system 为底；并集 ∪ {ai} 去重排序，`DROP CONSTRAINT %I` 逐个删，`format+quote_literal` 重建唯一的 `decisions_made_by_check ... NOT VALID`；写 schema_version 552，`ON CONFLICT DO NOTHING`。不加 rollback 文件，不改 EXPECTED_SCHEMA_VERSION。
- 新增测试：见 B-2
- 实际运行：
  - `node scripts/facts-check.mjs` → `All facts consistent.`
  - `bash scripts/check-version-sync.sh` → `✅ All version files in sync`
  - `cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js` → `[MIGRATE] Applied 4 migration(s): 547, 550, 551, 552`，退出码 0；随后查询约束 = `CHECK (((made_by)::text = ANY ((ARRAY['ai','cecelia','system','user']...)) NOT VALID`，`schema_version` 中 552 计数为 1
  - 本机隔离 Brain（`DB_NAME=cecelia_scratch PORT=5299`，health `runtime.isolated=true`）POST strategic-decisions：made_by=ai → 201 `success:true, made_by:"ai"`；system → 201；bogus_maker → 500 `success:false`；GET judgment 按时间戳过滤只查回 system、ai 两行（bogus 未落库）。验证后已停掉 5299 服务。
- 提交 SHA：b2a8ad4d5

### B-2
- 对应：S-2
- 改动文件：新增 `packages/brain/src/__tests__/integration/migration-552-decisions-made-by-ai.pg.integration.test.js`
- 新增测试（8 个，同一事务内、最后 ROLLBACK，库名守卫仅 cecelia_scratch / CI 下 cecelia_test）：迁移外加宽取值 owner_x 保留 + 补 ai；重跑约束定义完全不变；约束被删后重建四值（恰 4 个取值）；改名约束 + 额外同列约束（owner_y/owner_z）收敛为唯一 decisions_made_by_check；多列 CHECK 报错（SAVEPOINT 内）；无法解析的单列 CHECK 报错；ai 插入成功、bogus 抛 23514（SAVEPOINT 内）；列类型 varchar(20)、默认 system 不变且不带 made_by 插入得 system。
- 实际运行：`cd packages/brain && DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-552-decisions-made-by-ai.pg.integration.test.js`
  - 写实现前：失败，`ENOENT ... migrations/552_decisions_made_by_allow_ai.sql`，`Test Files 1 failed`
  - 写实现后：`✓ ... (8 tests) 77ms`，`Test Files 1 passed (1)，Tests 8 passed (8)`
- 提交 SHA：b2a8ad4d5（测试与实现同一提交）

### B-3
- 对应：S-3
- 改动文件：`packages/brain/scripts/smoke/strategic-decisions-category-smoke.sh`（已登记 allowlist，未改登记文件；guard 未动）
- 改动：头注释补「迁移 552 让 made_by=ai 进 decisions_made_by_check」；第 1 段在 DATABASE_URL 存在时追加断言 `decisions_made_by_check` 含 user/cecelia/system/ai，缺则 fail；第 4 段 `for MB in system ai`，PASS 文案改为「coding-workflow 判定点（made_by=system/ai）201 且可查」。
- 实际运行：`bash -n` 语法检查通过（`syntax-ok`）。整条 smoke 没有在本机跑：`smoke-production-guard.mjs` 要求 SMOKE_ALLOW_WRITE=1，还要核对本地 Docker 测试容器身份，本机没有这套环境；按规格由 CI real-env-smoke 执行。脚本里的同等写入/查询逻辑已用 B-1 的隔离 Brain 实测（ai/system 都 201 且能查到）。
- 提交 SHA：b2a8ad4d5

### B-4
- 对应：S-4
- 改动文件：新增 `changes/cp-10120304-cw-c8fab3c8.md`（`## Brain {VERSION} — decisions_made_by_check 补 ai（只增不减）` + 3 条要点：迁移 552 并集重建、保留迁移外取值、NOT VALID 不扫存量）
- 实际运行：`bash scripts/check-version-sync.sh` → `✅ All version files in sync`
- 提交 SHA：b2a8ad4d5
