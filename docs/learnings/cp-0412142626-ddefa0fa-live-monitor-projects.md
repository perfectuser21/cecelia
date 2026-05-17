# Learning: Live Monitor Projects 区块空白 — API 路径 + 数据归一化双重 bug

## 任务摘要
KR5 Dashboard 演示验收：修复 Live Monitor "Projects by Area" 区块始终显示"暂无活跃项目"的阻断 bug。

## 变更清单
1. `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx:933` — INACTIVE_STATUSES 新增 `'inactive'`
2. `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx:1234` — fetch 路径 `/api/tasks/projects` → `/api/brain/projects?limit=200`
3. `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx:1246` — setProjects 新增数据归一化（title→name, kr_id→goal_id, parent_id→type, end_date→deadline）
4. `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx` — 新增 2 个覆盖 bug fix 的回归测试

### 根本原因

**双重 bug 导致 Projects 区块永远空白**：

1. **API 路径错误（主因）**：`/api/tasks/projects` 在 Brain API 上返回 `Cannot GET`（404）。Vite proxy 将 `/api/brain/*` 转发到 Brain（5221），其余 `/api/*` 转到 API Server（5211）。`/api/tasks/projects` 没有 `/brain` 前缀，路由到 API Server（5211），而 API Server 无此路由。`Promise.allSettled` 将此标记为 `rejected`，`setProjects` 永远不被调用，`projects` 保持 `[]`。

2. **数据字段名不匹配（次因）**：Brain 的 `okr_projects` 表返回 `title`（非 `name`）和 `kr_id`（非 `goal_id`），而 `ProjectsByArea` 组件读 `p.name` 和 `p.goal_id`。即使 API 路径修正，不归一化的数据也无法正确显示项目名和按 Area 分组。

3. **INACTIVE_STATUSES 缺少 'inactive'（加重因）**：`okr_projects` 表中 119/156 条记录状态为 `inactive`，而 `INACTIVE_STATUSES` 只有 `['completed','archived','cancelled','done']`。若不修正，`inactive` 项目会全部显示在 Projects 面板，造成视觉污染（119 条）。

### 下次预防

- [ ] Dashboard API 路径规则：调用 Brain 数据必须用 `/api/brain/*`；调用 API Server 用 `/api/*`（不含 brain）
- [ ] 数据归一化模式：前端读取新 Brain 表（okr_projects/okr_initiatives）时，需检查字段名与接口的 `Project` interface 是否一致（`title` vs `name`，`kr_id` vs `goal_id`）
- [ ] 状态枚举维护：新增状态值到数据库时（如 `inactive`），同步更新前端 `INACTIVE_STATUSES` 等过滤集合
