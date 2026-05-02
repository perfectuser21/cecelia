# PRD: brain-test-pyramid Layer 3 PR3 — Cross-Domain Routing 集成测试

## 目标
为跨域路由添加集成测试：pending-actions 生命周期（DB 直写）+ intent/match 自然语言路由到 OKR。

## 背景
Brain 的跨域路由核心：pending-actions 用于人机协作的动作审批流，intent/match 用于自然语言映射到 OKR 目标。两者均无集成测试覆盖。

## 成功标准
- pending-actions 创建/拒绝状态流转正确，拒绝后不可再次拒绝
- intent/match 自然语言查询能匹配到相关 OKR 记录
- 空 query / 缺字段 → 400
