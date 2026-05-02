## brain-test-pyramid Layer 2 PR3: tenant-onboarding integration test（2026-05-02）

### 根本原因
okr_projects 作为系统租户命名空间，生命周期操作（INSERT/UPDATE/upsert/软删除）缺少真实 DB 验证，容易导致上层逻辑使用错误状态值。

### 下次预防
- [ ] 新增项目/租户相关表操作时，添加 DB 直查验证（而非只依赖 API 响应字段）
- [ ] upsert 操作必须单独测试幂等性，防止重复执行报错或覆盖错误字段
