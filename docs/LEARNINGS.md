# Cecelia Core Learnings

开发过程中的经验总结和最佳实践。

---

### [2026-02-14] Skip Local Tests During Brain Deployment

- **Bug**: Brain deployment script runs local tests that conflict with running Brain service on port 5221
  - When Brain is running: `Error: listen EADDRINUSE: address already in use :::5221`
  - When Brain is stopped: Tests fail with connection errors
  - Solution: Skip local test execution during deployment since CI already validates all tests

- **优化点**: Deployment scripts should avoid duplicating CI checks
  - CI is the source of truth for test results
  - Local deployment should focus on: build → migrate → selfcheck → deploy → health check
  - Tests belong in CI, not in deployment scripts

- **影响程度**: Medium
  - Blocked deployment until fixed
  - Simple solution (skip test step)
  - No actual code quality impact (CI still validates)

### [2026-02-14] Schema Version Update Requires Version Sync

- **Bug**: .brain-versions format issue - file had two lines instead of one
  - CI script uses `tr -d '\n'` which concatenates all lines
  - Writing "1.38.0\n1.38.0\n" resulted in "1.38.01.38.0"
  - Solution: Use `jq -r .version brain/package.json > .brain-versions` (single line)
  - Root cause: Manual file writing didn't match expected format

- **优化点**: Schema version updates require multi-file sync
  - `brain/src/selfcheck.js`: EXPECTED_SCHEMA_VERSION constant
  - `brain/src/__tests__/selfcheck.test.js`: Test expectation
  - `brain/package.json`: Version bump (feat: → minor, fix: → patch)
  - `brain/package-lock.json`: Auto-synced via `npm version`
  - `.brain-versions`: Single line version via jq
  - `DEFINITION.md`: Brain 版本 and Schema 版本 fields
  - `VERSION`: Project-level version file
  - Missing any of these will fail CI (Version Check or Facts Consistency)

- **影响程度**: Low
  - Simple task (1 line code change) required 3 CI retry cycles
  - All issues caught by CI before merge
  - Clear error messages guided fixes
  - Workflow validated - /dev handled iterative CI fixes correctly

### [2026-02-14] Fix Infinite Retry on OpenAI Quota Exceeded (P0)

- **Bug**: Brain crashed due to infinite retry when OpenAI quota exceeded
  - Timeline: Migration 031 background task (10:30) → OpenAI quota exceeded (12:05) → PostgreSQL connection pool exhausted (12:57) → Brain crash (13:00)
  - Root cause chain:
    1. OpenAI API quota超限
    2. `generate-capability-embeddings.mjs` 对每个 capability 重试 3 次
    3. 23 capabilities × 3 retries = 69 API calls
    4. 后台任务失败后被重新调度
    5. 循环 1 小时高负载 → CPU 105% → PostgreSQL 连接池耗尽 → Brain 崩溃
  - Solution: Add global consecutive failure limit (3), quota error fast-fail, runtime limit (5min)
  - PR #263: Modified `openai-client.js` to detect permanent errors (quota) vs temporary errors (network)

- **优化点**: Background task retry需要保护机制
  - 永久错误（quota exceeded）应立即失败，不重试
  - 连续失败计数器防止无限循环
  - 运行时间限制防止资源耗尽
  - 区分临时错误（network）和永久错误（quota, auth）
  - Test mocking complexity: `vi.doMock()` doesn't work properly at runtime, use integration tests instead

- **影响程度**: High (P0)
  - 导致 Brain 崩溃（阻塞性）
  - 修复后系统稳定性恢复
  - 后续可以安全地运行 OKR 拆解

