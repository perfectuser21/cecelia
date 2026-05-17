# Learning: feat(gtd): OKR全树视图重建 — Vision层+完整字段+全展开

## 背景

GTD OKR 页面只显示 title+status，缺 Vision 层、缺日期/负责人/备注字段，Scope 层默认折叠不可见。

## 根本原因

- full-tree.js 的 SELECT 语句未包含 start_date/end_date/description/owner_role/priority 字段，导致 API 返回数据不完整
- GTDOkr.tsx 的 TreeNode interface 未定义这些字段，即使 API 返回了也不会展示
- Vision 层缺失：visions 表通过 objectives.vision_id FK 关联，但原始查询没有 JOIN visions 表，tree assembly 也没有 Vision 节点

## 修复方案

### full-tree.js

1. 新增 Visions 查询步骤（Step 2）：通过 `JOIN objectives o_link ON o_link.vision_id = v.id AND o_link.area_id = ANY($1)` 找出每个 Area 下的 Vision，而不是依赖 visions.area_id（该字段实际为 NULL）
2. 所有 SELECT 语句统一添加 start_date, end_date, description, owner_role, priority 字段
3. Objectives 按 `(area_id, vision_id)` 组合 key 分组，有 vision_id 的挂 Vision 节点，无 vision_id 的直接挂 Area
4. PATCH TABLE_MAP 添加 `vision: 'visions'` 支持 Vision 状态编辑

### GTDOkr.tsx

1. TYPE_CONFIG 添加 vision 类型（橙色主题）
2. TreeNode interface 添加所有新字段（可选）
3. TreeRow 默认 expanded=true 实现全展开
4. 新增日期区间显示（Calendar 图标）、owner_role 显示（User 图标）、description 折叠展示（FileText 图标点击切换）
5. 顶部工具栏显示总节点数，底部状态栏也显示
6. 添加 error 状态展示，API 失败时显示具体错误信息

## 下次预防

- [ ] 新增 API 字段时，同步检查前端 interface 是否定义——不定义就算 API 返回了也不会显示
- [ ] Vision 等通过 FK 关联的层级，注意查询时走 FK 反向关联（objectives.vision_id），不能假设主表有直接 area_id
- [ ] 树形组件的默认展开深度要在 Task Card 中明确指定，否则容易被遗漏
