- [ ] 固定源码的发布就绪报告工作流使用真实 Commander 推进 report→cleanup，读取实际 Brain 与本次任务并保留可核对产物。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/foundation-release-readiness.test.js
- [ ] 独立检查拒绝错误版本、任务身份冲突、篡改报告、重复效果和外来清理资源；同输入恢复不重复采集。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/foundation-release-readiness.test.js
- [ ] Workflow/Activity/Step定义和profile可被现行冻结及发布合同解析；源码无凭据或宿主绝对路径。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/foundation-release-readiness.test.js
- [ ] 现行主CI提供实际调用的窄发布验证入口，从Brain固定快照执行已有pilot验证并保留原始report/receipt，不自行拼PASS。
  Test: manual:node --test scripts/ci/__tests__/foundation-release-readiness.test.mjs
- [ ] 一份PR经必需CI合并；生产父任务独立完成正式注册、发布及原Task/Run与DBOS回执验收，不能把本地回归当业务已完成。
  Test: manual:node scripts/ci/pilot-release-verification.mjs --repo-root . --snapshot /tmp/foundation-release-snapshot.json --output-dir /tmp/foundation-release-proof --event workflow_dispatch --ref refs/heads/main
