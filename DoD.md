# DoD：现役组件核验与废弃测试退役

- [x] [BEHAVIOR] 旧 qa:gate 无法生成假 PASSED 证书，实际 npm 子进程非零且无证书文件。
  Test: manual:bash -c 'cd packages/quality && npx --no-install vitest run tests/retirement/quality-gate-certificate.test.ts'
- [x] [BEHAVIOR] 旧 Quality 服务及其消费者退役，实际 API 路由不再请求5681；Brain、N8N等剩余状态仍真实呈现。
  Test: manual:bash -c 'cd apps/api && npx --no-install vitest run tests/system-status.test.ts tests/panorama-full.test.ts'
- [x] [BEHAVIOR] Engine 保留真实 Hook/Runner/worktree 回归；TS 演示与自证测试退役，真实语法检查能拒绝坏脚本。
  Test: manual:node scripts/ci/run-basic-check.mjs engine
- [x] [BEHAVIOR] 根 frontend 不再选择为 CI 任务，旧路径差分仍验证现役组件；所有现役检查真实传播失败。
  Test: manual:node --test scripts/ci/__tests__/basic-scope.test.mjs scripts/ci/__tests__/run-basic-check.test.mjs scripts/ci/__tests__/basic-workflow.test.mjs
- [x] [BEHAVIOR] 当前 Dashboard 在旧 frontend 完全不存在时仍能构建；现役 Quality 工具全部原生回归通过。
  Test: manual:node scripts/ci/run-basic-check.mjs dashboard
  Test: manual:node scripts/ci/run-basic-check.mjs quality
- [x] [BEHAVIOR] 私有真实 worktree list 不扫描用户仓库；真实 FD201 guardian/二次create安全守卫保留且无Python缓存泄漏。
  Test: manual:bash -c 'cd packages/engine && npx --no-install vitest run tests/e2e/dev-workflow-e2e.test.ts tests/skills/worktree-fd201-leak.test.ts'
- [ ] [ARTIFACT] 所有删除项有当前消费者核验证据，受信源协议原字节保留，正常 PR 与实际 Main 验收成功。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
