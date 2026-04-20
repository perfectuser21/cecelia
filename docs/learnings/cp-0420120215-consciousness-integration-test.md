## Consciousness Toggle Integration Test（2026-04-20）

PR: #2464
分支: cp-0420120215-consciousness-integration-test

### 根本原因

PR #2457 的 CI 曾被 `working_memory.value` vs `value_json` 列名错误拦下——**所有 35 个单元测试都过了**，因为它们用 mock pool，不连真 PG。真 PG schema 不对直到 CI 的 `brain-integration` job 跑真 migration 才爆。这类 bug 应该在 PR 创建后立刻被 CI 拦下，但 PR #2457 压根没有 integration test 覆盖 consciousness 功能。

pattern 识别：**任何跨 mock 和真实数据库的 SQL 代码都需要 integration test**，否则单元测试会产生虚假的"全绿"信号。

### 下次预防

- [ ] **新增任何 `pool.query(...)` 代码都配套一个 integration test**。单元测试的 mock pool 不验证 SQL 文法、列名、表存在性。只要代码真的 execute SQL，就必须有真 PG test 跑一次
- [ ] **integration test 放 `integration/` 目录**：CI 的 `brain-integration` job 已配好 postgres service container，文件自动被扫（`ci.yml:429` 的 `npx vitest run src/__tests__/integration/`）。零 CI 配置成本
- [ ] **写 integration test 时复用现有 pattern**：`DB_DEFAULTS` from `../../db-config.js` + `new pg.Pool({ ...DB_DEFAULTS, max: 3 })` + `beforeAll/afterAll(pool.end)`。参考 `golden-path.integration.test.js`。不要重新发明 connection 配置
- [ ] **回归验证是 integration test 的必做环节**：写完后手工把源码里的关键 SQL 列名改错一个字符，跑 test 确认真的爆红。如果 test 没爆红，说明断言太粗（比如只断言函数返回值而没断言 DB row 内容），需要加 schema 级断言（`SELECT value_json` 而非仅 `SELECT *`）
- [ ] **比 spec 更严的 test 是合理加码**：spec 要求"init 读到 true"，但仅看返回值无法区分"真读 DB" vs "fallback 默认 true"。加一个"改 DB 到 false 后 init 应返 false"的 test 堵住 try/catch 吞异常的盲区。subagent 在本 PR 自发加了这个——这是好实践
- [ ] **CI 单元 vs integration 的分工要清晰**：单元 job 跑快、覆盖纯逻辑（优先级矩阵、边界条件），integration job 跑慢、覆盖真实外部依赖（PG、网络、文件系统）。不要在单元测试里用 mock 模拟整个外部系统——那是 integration 的职责
