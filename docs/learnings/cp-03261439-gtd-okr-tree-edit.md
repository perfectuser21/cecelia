# Learning: GTD OKR Tree 完整重建

## 根本原因

GTD 页面出现三处断路：

1. **projects.js 类型映射错误**：旧版本通过 Brain API 代理并把所有 `okr_projects` 映射成 `type: 'initiative'`，导致前端过滤 `type === 'project'` 时命中零条记录，页面空白。实际数据库有 124 条 okr_projects 记录。

2. **GTDOkr 只展示两层**：原实现从 `/api/tasks/goals` 获取数据，该接口只返回 OKR + KR 两层，没有 Project→Scope→Initiative 下层链路。Area 分组也完全缺失。

3. **DatabaseView 无法编辑**：GTD 重构时将 OKRTaskTree 的 inline 编辑能力丢失，DatabaseView 变成只读组件，没有任何 `onEdit` 回调。

## 解决方案

- 新建 `full-tree.js` 后端 API：一个端点完成 6 张表（areas/objectives/key_results/okr_projects/okr_scopes/okr_initiatives）的顺序查询 + 内存拼树，返回嵌套 JSON。同时提供 `PATCH /:nodeType/:id` 支持 inline 编辑。
- `projects.js` 改为直查 `okr_projects` + `okr_initiatives`，SQL 中用 `'project' AS type` 和 `'initiative' AS type` 正确区分。
- `GTDOkr.tsx` 完整重写为自递归 `TreeRow` 组件，支持 Area→Objective→KR→Project→Scope→Initiative 6 层展开，click-to-edit 状态。
- `DatabaseView.tsx` 加 `onEdit` prop 供调用方传入编辑回调。

## 下次预防

- [ ] Brain API 代理层改动后，务必同步检查前端 type 字段过滤是否仍有效
- [ ] 前端重构时明确列出"被删除的能力"（inline 编辑、层级展开），逐一确认是否要保留
- [ ] DoD Test 字段检查的是实际文件内容，需要与代码实现的语法对齐（SQL `'x' AS type` vs JS `type: 'x'`）
