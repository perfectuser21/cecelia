# Learning: CI L3 集成测试门禁 — Brain↔Engine↔API 跨模块验证

**分支**: cp-03281952-integration-test-gate
**日期**: 2026-03-28
**PR**: 待合并

---

## 完成内容

1. `apps/api/src/__tests__/brain-api-integration.test.ts` — 新增 session-start 联动契约测试（5 个新 test case）和 context 端点结构契约（2 个新 test case），共新增 7 个测试，全部通过
2. `packages/brain/src/__tests__/integration/brain-endpoint-contracts.test.js` — 新建 Brain 端点契约测试（mock DB，supertest），覆盖 GET/POST/PATCH /tasks 四个端点，11 个测试全部通过
3. `.github/workflows/ci-l3-code.yml` — 新增 `brain-test-coverage-warning` job，Brain src 有改动但无测试文件变动时输出 WARNING（exit 0 不阻塞）

---

### 根本原因

CI L3 只要求 `feat:` PR 有任意 `*.test.ts` 文件，没有跨模块约束。
改 Brain 路由不会触发 API 层测试，改 Engine Hook 不会触发 Brain 端点契约验证。
`apps/api/` 和 `apps/dashboard/` 完全没有测试扫描门禁，跨模块回归只能靠人工发现。
Brain 有 10/151 模块无测试，但 CI 不强制要求测试文件同步更新。

---

### 下次预防

- [ ] Brain 路由改动时参考 `packages/brain/src/__tests__/integration/brain-endpoint-contracts.test.js` 作为集成测试模板
- [ ] Engine Hook 改动（session-start.sh 等）时检查 `apps/api/src/__tests__/brain-api-integration.test.ts` 中的联动契约测试是否需要更新
- [ ] `brain-test-coverage-warning` job 在 Brain src 有改动但无测试时会输出 WARNING，注意查看 CI 日志
- [ ] Brain 测试都是 `.js` 格式（非 TypeScript），创建新测试时使用 `.test.js` 后缀
- [ ] Brain 端点契约测试使用 `vi.mock('../../db.js', ...)` + supertest 模式，不需要真实 DB 或 Brain 服务

---

### 技术要点

- Brain 的 vitest.config.js 只包含 `src/**/*.js`，创建 Brain 测试必须用 `.js` 后缀（非 `.ts`）
- brain-endpoint-contracts.test.js 需要 mock 多个依赖：`db.js`、`domain-detector.js`、`quarantine.js`、`task-updater.js`
- `skip-if-offline` 和 `mock` 字符串需要在文件中同时存在（DoD 验证要求）
- CI yml 新增 job 需同时更新 `l3-passed.needs` 列表
