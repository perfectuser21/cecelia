# Learning: Dashboard RoadmapPage 数据字段不匹配 Bug

## 分支
cp-04080557-78c646c2-2224-4c81-a719-278cc5

### 根本原因
Brain API `/api/brain/goals` 经过两次迁移（goals表 → objectives/key_results），接口字段已变化：
1. `type` 字段：从 `'kr'` 变为 `'area_kr'`，导致 KRSummary 类型过滤失效
2. 进度字段：从 `progress`（计算值）变为 `current_value`/`target_value` 原始值，未提供计算后的 %
3. Brain API `/api/brain/projects` 从未有 `name` 字段，项目名一直是 `title`，但前端 interface 写的是 `name`

### 下次预防
- [ ] 前端 interface 字段要通过 `curl localhost:5221/api/brain/xxx` 实测 API 验证，不能靠记忆
- [ ] 当 Brain 有 schema 迁移（migration）时，同步检查 Dashboard 所有相关 interface
- [ ] 写组件时先 console.log(response) 验证实际字段，再定义 interface
