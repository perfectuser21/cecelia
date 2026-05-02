# PRD — brain-test-pyramid L2 PR3: tenant-onboarding integration test

## 背景
okr_projects（项目/租户命名空间）生命周期操作缺少 integration test，无法验证真实 DB 持久化和状态流转。

## 目标
为 okr_projects 表写完整生命周期 integration test：INSERT → SELECT → UPDATE status → upsert 幂等 → 软删除（archived），验证每步真实写入 PostgreSQL。

## 成功标准

- [ ] tenant-onboarding.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] INSERT okr_projects，DB 直查字段正确持久化
- [ ] SELECT 列表查询返回新建项目
- [ ] UPDATE status 状态变更持久化到 DB
- [ ] upsert 操作幂等（重复执行不报错，字段正确更新）
- [ ] 软删除（status=archived）后从活跃列表消失
- [ ] afterAll 清理自身创建的 okr_projects 数据
