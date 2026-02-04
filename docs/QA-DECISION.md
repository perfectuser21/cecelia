# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

## 分析

**改动范围**: 前端新增 Block 编辑器组件，集成到详情页

**风险评估**:
- 不涉及 Public API 改动（R1: 否）- 后端 API 已就绪
- 不涉及数据模型变更（R2: 否）- blocks 表已存在
- 多模块改动（R3: 是）- 新增组件 + 集成到详情页
- 新增依赖（R4: 是）- @dnd-kit/core, @dnd-kit/sortable
- 无安全/权限涉及（R5: 否）
- 不改核心工作流（R6: 否）
- 不改默认行为（R7: 否）
- 不涉及计费（R8: 否）

**RISK SCORE**: 2（R3 + R4）

## Tests

| DoD 条目 | 测试方法 | 测试位置 |
|----------|----------|----------|
| Block 创建（5 种类型） | manual | 点击+按钮验证5种类型可创建 |
| Block 编辑（blur 保存） | manual | 编辑后blur验证保存 |
| Block 删除 | manual | 删除后刷新验证 |
| 拖拽排序 | manual | 拖拽后刷新验证顺序 |
| API 同步 | manual | curl验证API数据 |
| 集成验证（Goal详情页） | manual | Goal详情页验证BlockEditor |
| 响应式布局 | manual | DevTools移动端视图 |
| TypeScript 编译 | auto | npm run build |
| Lint 检查 | auto | npm run lint |

## RCI

new: []
update: []

## Reason

前端 UI 组件首次实现，无历史回归契约。手动验证为主（UI 交互需人工确认），TypeScript/Lint 自动检查。RISK SCORE = 2，中低风险。
