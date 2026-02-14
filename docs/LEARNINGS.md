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

