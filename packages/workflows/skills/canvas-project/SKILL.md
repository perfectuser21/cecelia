---
name: canvas-project
description: 将当前开发的功能投影到画布上，生成 Feature → Module → Logic → Code 四层架构图
---

# 功能投影到画布

将当前正在开发或讨论的功能，自动生成**完整架构图**并保存到 Whiteboard 画布。

---

## 触发方式

用户说：
- "投影到画布"
- "画到画布上"
- "更新画布"
- `/canvas-project`

---

## 核心规则（重要！）

### 1. 只用 parentId，不用显式 edges

**正确做法**：
```json
{
  "nodes": [
    {"id": "root", "name": "项目", ...},
    {"id": "apps", "name": "apps/", "parentId": "root", ...},
    {"id": "dashboard", "name": "dashboard", "parentId": "apps", ...}
  ],
  "edges": []  // 留空！让系统自动生成连线
}
```

**错误做法**（会导致整理后连线乱）：
```json
{
  "edges": [
    {"from": "root", "to": "apps", "fromAnchor": "bottom", "toAnchor": "top", ...}
  ]
}
```

### 2. 连线规则

系统会根据 `parentId` 和布局方向自动生成连线：
- **左→右布局**：父右侧 → 子左侧
- **上→下布局**：父底部 → 子顶部

用户可以点击「整理」按钮重新排列，连线会自动调整方向。

---

## 节点格式

### 必填字段

```json
{
  "id": "唯一ID",
  "name": "显示名称",
  "x": 100,
  "y": 100,
  "width": 150,
  "height": 50,
  "shape": "rounded",
  "color": "#3b82f6",
  "parentId": "父节点ID（顶层节点不填）"
}
```

### 可选字段

```json
{
  "description": "详细描述（点击节点后右边栏显示）",
  "layerType": "feature|module|logic|code",
  "filePath": "代码文件路径（仅 code 层）"
}
```

### 命名规范（重要！）

**1. 节点上不显示数量**

- 不要在节点上显示子节点数量
- 数量信息通过点击节点后右边栏查看即可

**2. 版本号放在 name 里**

```json
// Feature Bundle 带版本号
{"name": "workflow v1.4.0", ...}
{"name": "content-publish v1.0.0", ...}
```

**3. 文件名必须完整，不能截断**

```json
// ✅ 正确
{"name": "worktree-manager.sh", "width": 140, ...}
{"name": "feature-completion-sync-v2.json", "width": 180, ...}

// ❌ 错误（截断）
{"name": "worktree-man...", ...}
```

**4. 宽度要够放下完整名称**

- 短名称（≤8字符）：width = 70-80
- 中等名称（9-15字符）：width = 90-120
- 长名称（>15字符）：width = 130-180

### 颜色规范

| 类型 | 颜色 | 说明 |
|------|------|------|
| 根节点 | #3b82f6 (蓝) | 项目/系统 |
| 目录 | #10b981 (绿) | apps/, features/ |
| 模块 | #8b5cf6 (紫) | dashboard, workflow |
| 工作流 | #f59e0b (橙) | workflows/ |
| 代码 | #06b6d4 (青) | 具体文件 |
| 辅助 | #64748b (灰) | shared/, scripts/ |

### 形状规范

| 形状 | 用途 |
|------|------|
| rounded | 目录、模块（有子节点） |
| pill | 文件、叶子节点 |
| rect | 注释、说明 |

---

## 示例：项目架构图

```bash
curl -s -X POST "http://localhost:3333/v1/panorama/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "项目架构 v1.0",
    "nodes": [
      {"id": "root", "x": 100, "y": 100, "width": 180, "height": 50, "name": "my-project", "shape": "rounded", "color": "#3b82f6"},

      {"id": "apps", "x": 100, "y": 200, "width": 100, "height": 40, "name": "apps/", "shape": "rounded", "color": "#10b981", "parentId": "root"},
      {"id": "features", "x": 220, "y": 200, "width": 100, "height": 40, "name": "features/", "shape": "rounded", "color": "#8b5cf6", "parentId": "root"},

      {"id": "dashboard", "x": 100, "y": 300, "width": 120, "height": 40, "name": "dashboard", "shape": "rounded", "color": "#10b981", "parentId": "apps"},
      {"id": "frontend", "x": 100, "y": 400, "width": 100, "height": 36, "name": "frontend", "shape": "pill", "color": "#06b6d4", "parentId": "dashboard"},
      {"id": "api", "x": 220, "y": 400, "width": 100, "height": 36, "name": "api", "shape": "pill", "color": "#06b6d4", "parentId": "dashboard"}
    ],
    "edges": []
  }'
```

---

## 执行步骤

### 1. 分析当前功能范围

回顾会话，确定：
- 功能边界
- 文件结构
- 层级关系

### 2. 构建节点层级

```
Layer 0: 根节点（无 parentId）
  └── Layer 1: 一级目录（parentId = root）
      └── Layer 2: 二级目录/模块（parentId = Layer 1）
          └── Layer 3: 文件/代码（parentId = Layer 2）
```

### 3. 调用 API

```bash
# 创建新项目
curl -X POST "http://localhost:3333/v1/panorama/projects" \
  -H "Content-Type: application/json" \
  -d '{"name": "项目名称", "nodes": [...], "edges": []}'

# 或更新现有项目
curl -X PUT "http://localhost:3333/v1/panorama/projects/{project_id}" \
  -H "Content-Type: application/json" \
  -d '{"nodes": [...], "edges": []}'
```

### 4. 输出结果

完成后告诉用户：
1. 项目名称
2. 节点数量
3. 画布链接：https://dashboard.zenjoymedia.media:3000/canvas
4. 提示：切换到「自由画布」→ 点「展开」→ 点「整理」

---

## 用户操作指南

1. **打开画布**：Canvas 页面 → 自由画布
2. **选择项目**：左侧列表点击项目名
3. **展开所有**：点击「展开」按钮
4. **整理布局**：点击「整理」或选择「左→右」/「上→下」
5. **下钻查看**：双击有子节点的节点进入下一层
6. **返回上层**：点击左上角面包屑导航

---

**最后更新**: 2026-01-08
