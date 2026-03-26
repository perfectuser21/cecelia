# Learning: feat(gtd): OKR页面重设计 — Vision置顶、聚焦OKR层、description可编辑

## 背景

GTD OKR 页面有两个结构性错误：层级反了（Vision 应该在顶层，不是 Area 的子节点），以及 Project/Scope/Initiative 混在 OKR 视图里。

## 根本原因

- 初始设计时把 "Area 有哪些 Vision" 当成树的根，导致 Area > Vision > OBJ 的倒置结构
- OKR 视图和执行视图（Project→Scope→Initiative）没有分离，全部混在同一个 full-tree 端点和同一个页面里，职责不清
- 前端 GTDOkr.tsx 没有独立的 OKR 聚焦视图，渲染了全部 7 层节点

## 修复方案

### full-tree.js

- 新增 `?view=okr` 参数，返回 Vision → Area → Objective → KR 四层结构
- 通过 visions 表查询 Vision（而非从 Area 倒推），确保 Vision 在顶层
- Area 通过 `objectives.area_id + vision_id` 关联到对应 Vision
- 原有无参数接口完全不变（其他页面不受影响）
- PATCH 端点增加 `description` 字段支持

### GTDOkr.tsx

- 数据源改为 `/api/tasks/full-tree?view=okr`
- Vision 层用金色卡片展示（VISION 标签），所有 Area 作为其子节点
- Area 作为可折叠分组 section，OBJ/KR 在内
- 每个节点（Vision/Area/OBJ/KR）均有 description 内联编辑（Pencil → textarea → blur 保存）
- KR 节点显示 current/target/unit 进度条
- 不显示 Project/Scope/Initiative（职责分离）

## 下次预防

- [ ] 树形结构设计时，先确认"谁是真正的根节点"——应该从业务层级的顶层开始，而非从最常见的实体开始
- [ ] OKR 视图和执行视图应该是两个独立的 API 端点和页面，从一开始就分离
- [ ] description 编辑是基础 CRUD 功能，应在第一次实现时就包含，不能事后补
