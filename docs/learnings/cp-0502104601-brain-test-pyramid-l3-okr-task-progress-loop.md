## brain-test-pyramid L3 PR1: okr-task-progress-loop integration test（2026-05-02）

### 根本原因
OKR→Task→KR progress 反馈链路是 Brain 进度系统的核心，但缺乏集成测试。recalculate-progress 的 SQL 路径（objective→KR→project→scope→initiative→tasks）若有字段名变更，静默失效风险高。

### 下次预防
- [ ] 新增 OKR progress 计算逻辑时，必须同步更新此集成测试
- [ ] 验证 DB 持久化是集成测试的必要步骤，不能只看 API 响应
