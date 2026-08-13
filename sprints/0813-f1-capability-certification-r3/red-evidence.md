# Red 证据 — F1 Capability 可重复认证闭环 kernel-v1（20260813-r3）

## 冻结合同测试（commit 1 起不可变）

- PR-CI smoke: `sprints/0813-f1-capability-certification-r3/tests/f1-certification-smoke.test.ts`
  （sha256 `e4fc213a4e85844e7cf0f01b166adb73cb400bd30a4be5f778287a2496956213`，与 task_bundle
  frozen_artifact_manifest 逐字符相符，原样落盘未改）
- nightly 负向矩阵: `packages/brain/src/__tests__/integration/f1-capability-certification.integration.test.js`

## Red 状态（实现落地前）

Red commit 只含测试 + DoD + 本 red-evidence，**不含任何 packages/ 实现**。此时：

1. `GET /api/brain/capabilities/F1/certification` 路由不存在 → 端点返回 404
   → smoke 内 `certify()` 的 `expect(res.ok).toBe(true)` 失败（红）。
2. 幂等 seed helper `packages/brain/scripts/integration/seed-f1-cert-fixture.js` 不存在
   → `seed('green')` 的 `execFileSync('node', [SEED, ...])` 抛 ENOENT（红）。
3. Mapper 读回逻辑 `packages/brain/src/map/f1-certification.js` 不存在
   → nightly 矩阵 `import { resolveF1Certification }` 解析失败（红）。

两条 smoke `it()` 与五条 nightly `it()` 在 Red 阶段全部失败。

## Red → Green 机械验证归属

本 fleet-worker 无常驻 Postgres / Brain，DB 依赖型断言的确定性 Red→Green 由真环境守护：

- **PR-CI**：`harness-v5-checks.yml` 的 `tests-actually-pass` job 起真 Postgres + Brain server
  实跑 smoke（本轮已对齐 Brain 与 sprint 测试同库 `cecelia_test`，seed 落库后端点可回读）。
- **nightly**：`integration-nightly.yml` 起真 Postgres 跑负向矩阵（已登记进
  `vitest.config.js` `POSTGRES_INTEGRATION_TESTS`）。
- **evaluator**：逐条真实执行 contract-dod.md 的 `[BEHAVIOR] manual:bash` 五行剧本 + final-e2e。

## 纯逻辑本地 Red→Green（无需 DB，已实跑）

依赖注入单测 `packages/brain/src/map/__tests__/f1-certification.test.js` 穷举
`decideF1State` / `resolveF1Certification` 的 fail-closed 判定分支，本机 `vitest run` 全绿
（实现落地后），佐证判定逻辑正确；DB 落库/聚合正确性由上述真 PG 测试守护。
