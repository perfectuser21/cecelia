# Sprint 合同（最终版）

> 审查状态：**APPROVED**（第 2 轮，2026-04-08）
> 审查摘要：两轮必须修复点已全部解决。行为描述可观测，硬阈值全量化，Evaluator 可独立验证。

---

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
- 当请求 `GET /api/brain/tasks?sprint_dir=`（空字符串）时，行为与不传 `sprint_dir` 相同——返回全量任务（忽略空字符串参数，不当作精确匹配处理）

**硬阈值**：
- 响应数组中所有元素满足 `item.sprint_dir === 'sprints/run-20260407-2353'`，不允许混入其他记录
- 传入不存在的 sprint_dir 时，响应体精确为 `[]`，HTTP 状态码 200
- 传入空字符串 `sprint_dir=` 时，响应行为与不传该参数一致（返回正常任务列表，而非空数组或 400）
- 响应时间 < 500ms（无并发压力下）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 2: 不传 sprint_dir 时零破坏

**行为描述**：
- 当请求 `GET /api/brain/tasks`（无任何参数）时，响应返回任务列表，每条记录的 `sprint_dir` 字段不受过滤限制（可为任意值）
- 当请求 `GET /api/brain/tasks?limit=5` 时，响应返回任务数 ≤ 5，且结果不因新增 `sprint_dir` 功能而减少
- 当请求 `GET /api/brain/tasks?status=in_progress&limit=10` 时，响应任务数 ≤ 10，且每条记录 `status === 'in_progress'`
- 当请求 `GET /api/brain/tasks?status=in_progress&sprint_dir=sprints/run-20260407-2353` 时，响应为同时满足两个条件的任务（AND 逻辑）

**硬阈值**：
- 调用 `GET /api/brain/tasks?limit=5` 返回任务数 ≤ 5，且每条记录的 `sprint_dir` 不受过滤（可为任意值）
- `status` + `sprint_dir` 组合过滤时，响应数组中每条记录满足 `status === 'in_progress'` AND `sprint_dir === 'sprints/run-20260407-2353'`
- `limit` 参数继续有效，响应数量不超过 limit 值
- `task_type` + `sprint_dir` 组合过滤时，响应数组中每条记录同时满足两个条件（AND 逻辑）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

### Feature 3: 返回完整任务字段

**行为描述**：
- 当按 sprint_dir 过滤返回非空结果时，每条记录包含 `id`、`title`、`status`、`sprint_dir` 字段
- 不需要调用方二次查询即可获取上述字段

**硬阈值**：
- 响应数组中每条记录的 `id` 为非 null UUID
- 响应数组中每条记录的 `title` 为非 null 字符串
- 响应数组中每条记录的 `status` 为非 null 字符串（如 `queued`、`in_progress`、`completed` 等）
- 响应数组中每条记录存在 `sprint_dir` 键（即使值为 null 也必须有该键）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

---

## 技术实现方向（高层）

- 修改文件：`packages/brain/src/routes/status.js`，第 279 行 `GET /tasks` 路由
- 在现有 `if (status || task_type)` 分支中增加 `sprint_dir` 条件判断（与 status/task_type 同级 AND 组合）
- 当只传非空 `sprint_dir`（无 status/task_type）时，同样走自定义 query 路径而非 `getTopTasks()`
- 空字符串处理：入口处 `const sprintDir = req.query.sprint_dir || null`，空字符串自动转 null，忽略处理
- SQL 使用精确等值匹配：`AND sprint_dir = $N`，不使用 LIKE 或正则

## 不在本次范围内

- 不修改 `POST /api/brain/tasks` 任务创建逻辑
- 不新增 DB 索引
- 不涉及 Dashboard 前端
- 不支持 sprint_dir 模糊/通配符查询
- 不修改除 `packages/brain/src/routes/status.js` 之外的其他文件
