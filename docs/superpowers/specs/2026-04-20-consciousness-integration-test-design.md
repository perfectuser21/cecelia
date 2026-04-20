# Consciousness Toggle Integration Test

**日期**: 2026-04-20
**分支**: cp-0420120215-consciousness-integration-test
**前置**: PR #2447 + #2457（consciousness-guard 模块 + runtime toggle + Dashboard 已合并）
**Brain 版本**: 不 bump（仅加测试）

---

## 目标

上次 CI 曾被 `working_memory.value` vs `value_json` 列名错误拦下——单元测试 mock 的 pool 通过了，真 PG schema 不通。补一个**真 PG integration test**，覆盖 mock pool 盲区。

**防护场景**：任何改动把 consciousness-guard.js 里的 SQL 写错列名 / 表名 / 字段序列 → 这个 test 会在 PR CI 的 brain-integration job 直接爆红。

## 架构

单文件：`packages/brain/src/__tests__/integration/consciousness-toggle.integration.test.js`

复用现有 pattern（参考 `golden-path.integration.test.js`）：
- `new pg.Pool({ ...DB_DEFAULTS })` 连 CI 的 `cecelia_test` PG service
- `beforeAll` 跑 migration 240（幂等 INSERT ON CONFLICT）+ 初始化 pool
- `beforeEach` `DELETE FROM working_memory WHERE key='consciousness_enabled'` + 重跑 migration 保证 seed 回到初始
- `afterAll` `pool.end()`

CI 自动拾取：`.github/workflows/ci.yml:429` 的 `brain-integration` job 跑 `npx vitest run src/__tests__/integration/ --reporter=verbose`——新文件在 `integration/` 下自动扫。

## 5 个 Test

| # | 验证 | 方法 |
|---|---|---|
| 1 | **Migration 240 schema 正确** | 跑 migration → `SELECT value_json FROM working_memory WHERE key='consciousness_enabled'` 不为 null，`value_json->>'enabled' = 'true'` | 
| 2 | **initConsciousnessGuard 从 DB 加载** | `_resetCacheForTest()` + `initConsciousnessGuard(pool)` → `isConsciousnessEnabled() === true` |
| 3 | **setConsciousnessEnabled write-through** | `setConsciousnessEnabled(pool, false)` → `isConsciousnessEnabled() === false` + `SELECT value_json` 验证 enabled=false 且 last_toggled_at 非空 |
| 4 | **toggle 来回往返** | set false → set true → set false，每次 cache 和 DB 都一致 |
| 5 | **env override 紧急逃生口** | set memory=false + `process.env.CONSCIOUSNESS_ENABLED='true'` → `isConsciousnessEnabled() === true`（env 压过 memory） |

## 不做

- 不改 vitest.config.js（glob pattern 自动匹配）
- 不改 ci.yml（brain-integration job 已扫 `integration/` 目录）
- 不改 consciousness-guard.js / migration 240 / routes/settings.js
- 不测 routes/settings.js 的 HTTP 层（已有单元测试 mock 版本足够）
- 不开 Playwright E2E（Phase 3 再说）

## DoD

1. 新文件存在，5 tests
2. 本地 `npx vitest run src/__tests__/integration/consciousness-toggle.integration.test.js` 全绿（连 localhost cecelia DB）
3. CI brain-integration job 自动跑这个 file，全绿
4. **防回归证明**：临时在 consciousness-guard.js 里把 `value_json` 改回 `value`，test 1 爆红；改回 `value_json` 恢复绿
5. PR size <300 行
6. Brain 版本保持 1.221.0

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| PG service 启动慢导致 test 超时 | 复用 brain-integration job 现有 health-check，不重新搞连接 |
| 并发 test 污染 memory key | beforeEach `DELETE` + 重跑 migration 保 seed；每个 test 独立修改自己关心的状态 |
| env 测试泄漏到其它 test | afterEach 清 `process.env.CONSCIOUSNESS_ENABLED` + `process.env.BRAIN_QUIET_MODE` |
| cache 跨 test 泄漏 | 每个 test 开头 `_resetCacheForTest()` |

---

Writing-plans 下一步生成实施计划。
