# Learning: Cross-Package 集成测试任务泄漏

**Branch**: cp-04100958-216b7546-482f-4b7f-8ee4-19d99f  
**Date**: 2026-04-11

---

### 根本原因

`cross-package-brain-api.integration.test.js` 使用 `trigger_source: 'api'` 创建测试任务。
这些任务被写入真实 PostgreSQL（无论是 CI 测试 DB 还是本地生产 DB），
Brain tick 调度器扫描 `status = 'queued'` 时将其识别为真实任务并派发执行。

**结果**：`[cross-package-test] queued dev 任务` 和 `[cross-package-test] research 任务`
成为 in_progress 真实 Brain 任务，甚至触发了 3 次真实的 Claude Code 执行尝试。

---

### 下次预防

- [ ] 集成测试创建数据必须用 `trigger_source: 'integration-test'`，而不是 `'api'` 或其他生产值
- [ ] 调度器 SQL WHERE 子句必须过滤 `trigger_source != 'integration-test'`（已加 NULL 安全处理）
- [ ] afterAll 清理必须加兜底：`DELETE WHERE trigger_source = 'integration-test'`（防失败残留）
- [ ] 所有集成测试的测试数据创建必须有唯一可识别的标记（trigger_source / tags）
