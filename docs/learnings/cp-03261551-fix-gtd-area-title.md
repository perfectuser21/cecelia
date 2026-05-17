# Learning: fix(gtd): full-tree area节点title/status字段修复

## 背景

GTD OKR 页面 Area 行名称（Cecelia/ZenithJoy）显示空白，状态编辑异常。

## 改动

1. `full-tree.js` areas 查询加 `a.name AS title, 'active' AS status`，统一节点数据结构
2. `GTDOkr.tsx` TreeNode 接口 `title` 改为可选，TreeRow 渲染改用 `node.title || node.name` 兼容

### 根本原因

API 返回的 area 节点与其他节点（objective/kr/project 等）数据结构不一致：其他节点有 `title` + `status`，area 节点只有 `name` + `domain`。前端组件统一按 `node.title` 渲染，导致 area 名称显示空白、状态 badge 异常。

设计时没有在 API 层做数据结构归一化，直接把原始 DB 字段透传给前端，留下了字段名不一致的隐患。

前后端对 TreeNode 结构约定不一致是常见的集成 bug 根源，应该在 API 层统一输出格式，不依赖前端做字段适配。

### 下次预防

- [ ] full-tree 类 API 对所有节点类型统一输出 `title` + `status` 字段，不透传原始 DB 字段名
- [ ] 新增节点类型时，检查前端 TreeNode interface 是否需要更新
- [ ] 发现 UI 显示空白时，优先检查 API 返回字段名与前端读取字段名是否一致
