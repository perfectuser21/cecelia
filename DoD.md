contract_branch: cp-06291932-ws-5417f890-ws1
sprint_dir: sprints/06291830-review-env

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: evaluator PASS 后自动分配端口启动 Dashboard 静态 Review 环境

**范围**: review-env-manager.js 新建 + harness-task.graph.js mergePrNode 集成 + shepherd.js 清理钩子 + 3 个 Brain API 端点 + DB migration
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/review-env-manager.js` 存在且导出 `allocateReviewEnv` / `releaseReviewEnv` / `cleanupHarnessReviewEnvs` / `findFreePort`
- [ ] [ARTIFACT] `packages/brain/src/db/migrations/012-review-environments.sql` 存在且含 `CREATE TABLE review_environments`
- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/allocate` 路由注册
- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/release` 路由注册
- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-task.graph.js` 的 `mergePrNode` 含 `allocateReviewEnv` 调用
- [ ] [ARTIFACT] `packages/brain/src/shepherd.js` 含 `cleanupHarnessReviewEnvs` 调用
