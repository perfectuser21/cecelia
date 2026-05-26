## Sprint A — 7 张开发管理表 + 初始填充 + Notion 同步（2026-05-22）

### 根本原因

Brain DB 缺乏对代码库状态的感知（journeys/journey_steps/journey_features/issues/api_registry/db_schema_registry/test_registry），导致 harness pipeline 的 contract proposer 只能靠 thin_prd 内容猜测系统现状，产生"prescriptive"（指定实现细节）而非"non-prescriptive"（描述用户行为）的合同。

同时，Notion 中的 Journey/Feature 数据无法被 Brain 读取，harness-planner 无法从真实 journey steps 推导 PRD，final-e2e 只能从 contract 生成而非真实 journey 路径。

### 下次预防

- [ ] 新增 Brain 迁移（migration N）时，必须同步更新 `selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` 和 `DEFINITION.md` 的 `schema_version`（本次被 precheck gate 捕获）
- [ ] 扫描脚本用 `try/finally` 确保 `pool.end()` 总被调用，否则 DB 连接失败时进程会挂
- [ ] `scan-api-registry.js` 等文件扫描脚本必须排除 `node_modules/` 目录
- [ ] Notion API DB 不一定对所有集成共享（AI Step Registry 404），需要通过 relation 间接拉取 steps；这是 Notion 权限问题，下次建新 DB 后记得在集成设置里共享
- [ ] `journey_features.journey_id` 可为 NULL（ON DELETE SET NULL 设计），但脚本应对"journeyNotionId 有值但 DB 未找到"的情况发 console.warn
- [ ] Notion 枚举值（journey_type/maturity/thickness/priority）必须规范化再写入有 CHECK 约束的 DB 列，避免 Notion 出现非标准值时同步失败
- [ ] Sprint B 待做：walking-skeleton 脚本改为 Brain DB 优先（Brain→Notion 方向），harness-contract-proposer Step 1 查询 api_registry/db_schema_registry 注入 Context
- [ ] migration 引入新 schema_version 时，**必须同步更新**两处硬编码的版本号测试：`selfcheck.test.js` 和 `learnings-vectorize.test.js` 的 `expect(EXPECTED_SCHEMA_VERSION).toBe('...')`（本次 CI brain-unit 失败暴露）
- [ ] smoke 脚本连接 DB 时必须用 `DATABASE_URL` 环境变量（回退 `postgresql://cecelia@localhost:5432/cecelia`），不能写死 `postgresql://localhost/cecelia`（CI 实际用 cecelia_test 库）
- [ ] smoke 脚本不能检查依赖外部操作填充的数据（Notion 同步数据、扫描填充数据），CI 环境这些操作不运行；smoke 只验表存在 + schema 约束有效
- [ ] 新增真实 DB 集成测试文件（pool.query 直连，无完整 mock）必须加进 vitest.config.js 的 `exclude` 列表，否则被 brain-unit shard 拾取报 ECONNREFUSED
