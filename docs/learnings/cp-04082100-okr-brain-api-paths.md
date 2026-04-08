# Learning: OKR 页面 Brain API 路径 + area_kr 类型标准化

## 任务
KR5 Dashboard 冲刺 — 修复 planning 模块 OKR 页面阻断 bug

## 根本原因

### 路径问题
- OKRPage.tsx 使用 `/api/goals`（无 `tasks/` 前缀）→ 404 Not Found
- workspace API 的 goals 路由挂载在 `/api/tasks/goals`，而 Brain 的在 `/api/brain/goals`

### 类型不匹配
- Brain API 返回 `type: 'area_kr'`（KR 类型）
- 前端组件过滤 `type === 'kr'`
- workspace API proxy (`/api/tasks/goals`) 做了 `area_kr → kr` 转换，但直接调 `/api/brain/goals` 时没有
- 结果：PR #2057 修复路径 404 但引入新 bug：KR 列表空白

### 修复链
1. PR #2057: RoadmapPage 路径 404 修复（未加类型标准化）
2. 本 PR: OKRPage/OKRDashboard 路径修复 + 所有 3 个页面加 area_kr → kr 标准化

## 下次预防

- [ ] 直接调用 `/api/brain/*` 时，必须在前端做字段标准化（Brain 使用内部字段名，前端期望展示名）
- [ ] 修复 API 路径 404 后，必须验证数据过滤逻辑（type/status 等字段）是否也需要调整
- [ ] 新增页面调用 Brain API 前，先用 `curl localhost:5221/api/brain/goals?limit=3` 检查字段名
