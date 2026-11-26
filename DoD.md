# Commander测试提速与旧Sprint清退验收

Task: 4938df31-0c88-4c54-a47b-9c5cbc81fa8e
GP-Anchor: none(infra)

- [ ] 原84个Commander案例保留，新增漂移及带引号路径保护，真实执行与停止机制保持。
  Test: manual:npm test --workspace packages/brain -- src/orchestrator/__tests__/commander-code-adapter.test.js src/orchestrator/__tests__/commander-session-groups.test.js src/orchestrator/__tests__/commander-api-auth.test.js src/orchestrator/__tests__/checker-feedback.test.js
- [ ] 清退八个精确旧路径，五份主文件字节保持，历史SHA读回及默认1806文件集合保持。
  Test: manual:npm test --workspace packages/brain -- src/orchestrator/__tests__/git-artifact-reader.test.js
- [ ] 真实DEV端口冲突能在副本清理前输出退出码、端口与原生错误，原放行条件保持。
  Test: manual:node --test scripts/ci/__tests__/basic-staging-dev-diagnostics.test.mjs
- [ ] 完整Scripts/Ops、lint、DevGates与独立审查通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] PR及main完整CI通过，同候选隔离业务验收、生产SHA与Tick读回通过。
  Test: manual:bash scripts/check-version-sync.sh
