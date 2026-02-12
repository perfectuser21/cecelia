# Core vs Workspace 边界定义

## 🎯 核心原则

```
Core = 数据 + 逻辑 + API
Workspace = 界面 + 可视化 + 用户交互
```

---

## ✅ Core 的职责（只做这些）

### 1. 数据层
- ✅ PostgreSQL Schema (migrations/)
- ✅ 数据库 CRUD 操作
- ✅ Views、Functions、Triggers

### 2. 业务逻辑层
- ✅ Brain 决策逻辑 (tick.js, thalamus.js, cortex.js)
- ✅ Task 调度、执行、路由
- ✅ 保护系统 (circuit-breaker, quarantine, watchdog)
- ✅ OKR 拆解逻辑
- ✅ 评分、优先级算法

### 3. API 层（Express Routes）
- ✅ HTTP REST API 端点 (`/api/brain/*`)
- ✅ JSON 响应
- ✅ 数据查询、过滤、聚合
- ✅ WebSocket（实时数据推送）

### 4. SDK/工具层
- ✅ 内部工具函数 (trace.js, db-config.js)
- ✅ 数据验证、转换

**示例 - Core 应该提供的 API：**
```javascript
// ✅ 正确：提供 API，返回 JSON 数据
app.get('/api/brain/trace/runs/active', async (req, res) => {
  const runs = await getActiveRuns();
  res.json({ success: true, data: runs });
});

// ✅ 正确：提供聚合数据
app.get('/api/brain/trace/failures/top', async (req, res) => {
  const failures = await getTopFailures(10);
  res.json({ success: true, data: failures });
});
```

---

## ❌ Core 不做（这些属于 Workspace）

### 1. 前端界面
- ❌ React/Vue 组件
- ❌ HTML 页面
- ❌ CSS 样式
- ❌ 前端路由

### 2. 可视化
- ❌ 图表库 (echarts, d3.js)
- ❌ Dashboard 布局
- ❌ 实时刷新的 UI
- ❌ 数据可视化组件

### 3. 用户交互
- ❌ 表单组件
- ❌ 按钮、弹窗
- ❌ 用户输入验证（UI 层面）

**反例 - Core 不应该做的：**
```javascript
// ❌ 错误：不要在 Core 返回 HTML
app.get('/dashboard', (req, res) => {
  res.send('<html><body>...</body></html>'); // 这应该在 Workspace！
});

// ❌ 错误：不要在 Core 生成图表
app.get('/chart', (req, res) => {
  const chart = generateChart(data); // 这应该在 Workspace！
  res.send(chart);
});
```

---

## ✅ Workspace 的职责（只做这些）

### 1. 界面层
- ✅ React/Vue 组件
- ✅ 页面布局、路由
- ✅ 响应式设计

### 2. 可视化层
- ✅ 图表展示 (echarts, recharts)
- ✅ Dashboard 面板
- ✅ 实时数据刷新
- ✅ 数据筛选、排序（UI 层）

### 3. 交互层
- ✅ 表单、按钮、弹窗
- ✅ 用户操作反馈
- ✅ 前端路由跳转

### 4. API 调用层
- ✅ 调用 Core 的 HTTP API
- ✅ 数据格式化、展示
- ✅ 错误处理、Toast 提示

**示例 - Workspace 应该做的：**
```javascript
// ✅ 正确：调用 Core API，展示数据
function ObservabilityDashboard() {
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    fetch('http://localhost:5221/api/brain/trace/runs/active')
      .then(res => res.json())
      .then(data => setRuns(data.data));
  }, []);

  return (
    <div>
      <h1>Active Runs</h1>
      <RunsChart data={runs} />  {/* 图表在 Workspace */}
    </div>
  );
}
```

---

## ❌ Workspace 不做（这些属于 Core）

### 1. 数据层
- ❌ 直接访问 PostgreSQL
- ❌ 数据库 migrations
- ❌ SQL 查询

### 2. 业务逻辑
- ❌ Task 调度算法
- ❌ 评分、优先级计算
- ❌ OKR 拆解逻辑

### 3. 数据处理
- ❌ 数据聚合、统计（应该由 Core API 提供）
- ❌ 复杂的数据转换（简单的 UI 格式化可以）

**反例 - Workspace 不应该做的：**
```javascript
// ❌ 错误：不要在 Workspace 直接访问数据库
import { Pool } from 'pg';
const pool = new Pool({ ... });
const result = await pool.query('SELECT * FROM tasks'); // 这应该调用 Core API！

// ❌ 错误：不要在 Workspace 实现业务逻辑
function calculateTaskPriority(task) {
  // 复杂的评分算法应该在 Core！
  return task.urgency * task.importance * ...;
}
```

---

## 📊 架构图

```
┌─────────────────────────────────────────────────┐
│  用户浏览器                                      │
│  http://localhost:5211                          │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  cecelia/workspace (port 5211)                  │
│  ┌───────────────────────────────────────────┐ │
│  │  前端界面 (React/Vue)                      │ │
│  │  - Dashboard 页面                         │ │
│  │  - 图表可视化                             │ │
│  │  - 表单交互                               │ │
│  └───────────────────────────────────────────┘ │
│         ↓ HTTP 调用                             │
│  fetch('http://localhost:5221/api/brain/...')  │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  cecelia/core (port 5221)                       │
│  ┌───────────────────────────────────────────┐ │
│  │  Brain API (Express)                      │ │
│  │  - /api/brain/tasks                       │ │
│  │  - /api/brain/trace/*                     │ │
│  │  - /api/brain/pr-plans/*                  │ │
│  │  返回 JSON 数据                            │ │
│  └───────────────────────────────────────────┘ │
│         ↓                                       │
│  ┌───────────────────────────────────────────┐ │
│  │  业务逻辑层                                │ │
│  │  - tick.js (调度)                         │ │
│  │  - executor.js (执行)                     │ │
│  │  - thalamus.js (决策)                     │ │
│  └───────────────────────────────────────────┘ │
│         ↓                                       │
│  ┌───────────────────────────────────────────┐ │
│  │  PostgreSQL                               │ │
│  │  - tasks, goals, run_events, ...         │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 📝 现有功能的边界检查

### ✅ 可观测性系统 (v1.1.1)

| 组件 | 位置 | 状态 | 正确性 |
|------|------|------|--------|
| run_events 表 | core | ✅ 已实现 | ✅ 正确 |
| trace SDK | core | ✅ 已实现 | ✅ 正确 |
| trace API 端点 | core | ✅ 已实现 | ✅ 正确 |
| Dashboard 界面 | workspace | ❌ 未实现 | - |
| 图表可视化 | workspace | ❌ 未实现 | - |

### ✅ PR Plans 功能

| 组件 | 位置 | 状态 | 正确性 |
|------|------|------|--------|
| pr_plans 表 | core | ✅ 已实现 | ✅ 正确 |
| PR Plans API | core | ✅ 已实现 | ✅ 正确 |
| PR Plans 管理界面 | workspace | ❌ 未实现 | - |

### ✅ Task 管理

| 组件 | 位置 | 状态 | 正确性 |
|------|------|------|--------|
| tasks 表 | core | ✅ 已实现 | ✅ 正确 |
| Task CRUD API | core | ✅ 已实现 | ✅ 正确 |
| Task Dashboard | workspace | ❌ 未实现 | - |

---

## 🎯 开发规范

### Core 开发时问自己：
1. ✅ 这是数据操作吗？→ 应该在 Core
2. ✅ 这是业务逻辑吗？→ 应该在 Core
3. ✅ 这是 API 端点吗？→ 应该在 Core
4. ❌ 这是给用户看的界面吗？→ **不应该在 Core**
5. ❌ 这是图表可视化吗？→ **不应该在 Core**

### Workspace 开发时问自己：
1. ✅ 这是页面布局吗？→ 应该在 Workspace
2. ✅ 这是用户交互吗？→ 应该在 Workspace
3. ✅ 这是数据展示吗？→ 应该在 Workspace
4. ❌ 这需要访问数据库吗？→ **调用 Core API**
5. ❌ 这是业务逻辑吗？→ **调用 Core API**

---

## 🚀 标准工作流

### 添加新功能时：

**Step 1: Core 提供 API**
```bash
cd cecelia/core
/dev  # 走 /dev 流程

# 实现：
# - 数据库 migration
# - API 端点
# - 业务逻辑
# - 测试

# 产出：
# - GET/POST /api/brain/new-feature
# - 返回 JSON 数据
```

**Step 2: Workspace 调用 API**
```bash
cd cecelia/workspace
/dev  # 走 /dev 流程

# 实现：
# - React 组件
# - 调用 Core API
# - 图表展示
# - 用户交互

# 产出：
# - /dashboard/new-feature 页面
```

---

## 📌 违规检查清单

**Core 违规行为：**
- [ ] 返回 HTML 页面
- [ ] 包含 React/Vue 组件
- [ ] 包含 CSS 样式文件
- [ ] 生成图表、可视化

**Workspace 违规行为：**
- [ ] 直接连接 PostgreSQL
- [ ] 执行 SQL 查询
- [ ] 实现复杂业务逻辑
- [ ] 包含 migrations 文件

---

**最后更新**: 2026-02-12
**版本**: 1.0.0
