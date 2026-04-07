# 合同草案（第 1 轮）

## 本次实现的功能

- Feature 1: `GET /api/brain/tasks` 新增 `sprint_dir` 查询参数，按精确值过滤任务
- Feature 2: `sprint_dir` 参数缺失时行为与原有逻辑完全一致（零破坏）
- Feature 3: 过滤结果包含完整任务字段（`SELECT *` 已有实现，直接复用）

---

## 验收标准（DoD）

### Feature 1: 按 sprint_dir 精确过滤

**行为描述**：
- 当请求 `GET /api/brain/tasks?sprint_dir=sprints/run-20260407-2353` 时，响应数组中每条记录的 `sprint_dir` 字段值均等于 `sprints/run-20260407-2353`，不出现其他值（含 NULL）
- 当请求 `GET /api/brain/tasks?sprint_dir=sprints/nonexistent-xyz` 时，响应为空数组 `[]`，HTTP 状态码 200，不报错

**硬阈值**：
- 响应数组中所有元素满足 `item.sprint_dir === 'sprints/run-20260407-2353'`，不允许混入其他记录
- 传入不存在的 sprint_dir 时，响应体精确为 `[]`，HTTP 状态码 200
- 响应时间 < 500ms（无并发压力下）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 2: 不传 sprint_dir 时零破坏

**行为描述**：
- 当请求 `GET /api/brain/tasks`（无任何参数）时，响应与修改前完全相同（使用 `getTopTasks(limit)` 路径）
- 当请求 `GET /api/brain/tasks?status=in_progress&limit=10` 时，响应与修改前完全相同（走 status/task_type 过滤路径）
- 当请求 `GET /api/brain/tasks?status=in_progress&sprint_dir=sprints/run-20260407-2353` 时，响应为同时满足两个条件的任务（AND 逻辑）

**硬阈值**：
- 不传 `sprint_dir` 时，接口行为与修改前代码路径一致（无 regression）
- `status` + `sprint_dir` 组合过滤时，响应数组中每条记录满足 `status === 'in_progress'` AND `sprint_dir === 'sprints/run-20260407-2353'`
- `limit` 参数继续有效，不因新增 `sprint_dir` 而失效

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 3: 返回完整任务字段

**行为描述**：
- 当按 sprint_dir 过滤返回非空结果时，每条记录包含 `id`、`title`、`status`、`sprint_dir` 字段
- 不需要调用方二次查询即可获取上述字段

**硬阈值**：
- 响应数组中每条记录的 `id` 为非 null UUID
- 响应数组中每条记录的 `title` 为非 null 字符串
- 响应数组中每条记录存在 `sprint_dir` 键（即使值为 null 也必须有该键）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- 修改文件：`packages/brain/src/routes/status.js`，第 279 行 `GET /tasks` 路由
- 在现有 `if (status || task_type)` 分支中增加 `sprint_dir` 条件判断（与 status/task_type 同级 AND 组合）
- 当只传 `sprint_dir`（无 status/task_type）时，同样走自定义 query 路径而非 `getTopTasks()`
- SQL 使用精确等值匹配：`AND sprint_dir = $N`，不使用 LIKE 或正则

## 不在本次范围内

- 不修改 `POST /api/brain/tasks` 任务创建逻辑
- 不新增 DB 索引
- 不涉及 Dashboard 前端
- 不支持 sprint_dir 模糊/通配符查询
- 不修改除 `status.js` 之外的其他文件
