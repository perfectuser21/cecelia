---
id: review-plan-20260227
version: 1.0.0
created: 2026-02-27
updated: 2026-02-27
changelog:
  - 1.0.0: 初始版本 — Initiative 执行循环专项修复计划
---

# 修复计划 — Initiative 执行循环

**源报告**：CODE-REVIEW-REPORT-20260227.md
**决策**：CRITICAL_BLOCK
**修复批次**：P0（立即）+ P1（同批）

---

## 批次一：P0 立即修复（单 PR）

### Task-1：[L1-001] executor.js skillMap 补缺 + preparePrompt initiative_plan 分支

**文件**：`packages/brain/src/executor.js`

**改动 1 — skillMap 补三条（line 858）**

```javascript
// 在 skillMap 对象中添加：
'initiative_plan':  '/decomp',
'initiative_verify': '/decomp',
'decomp_review':    '/decomp-check',
```

**改动 2 — preparePrompt 新增 initiative_plan / initiative_verify / decomp_review 分支**

在 `// Talk 类型` 判断前插入：

```javascript
// initiative_plan / initiative_verify：直接将任务描述作为 /decomp Phase 2 上下文
if (taskType === 'initiative_plan' || taskType === 'initiative_verify') {
  return `/decomp\n\n${task.description || task.title}`;
}

// decomp_review：传给 /decomp-check skill
if (taskType === 'decomp_review') {
  return `/decomp-check\n\n${task.description || task.title}`;
}
```

---

### Task-2：[L2-002] 添加 GET/PATCH /api/brain/projects/:id 端点

**问题**：`task-projects.js` 目前只有 `GET /`（列表），但 decomp SKILL.md Phase 2 和 decomp-checker.js 的任务描述都引用了 `GET /api/brain/projects/<id>` 和 `PATCH /api/brain/projects/<id>`，这两个路径返回 404。

**修复方案**：

1. **`packages/brain/src/routes/task-projects.js`**：新增 `GET /:id` 和 `PATCH /:id` 端点

```javascript
// GET /:id — 获取单个 project
router.get('/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
  res.json(result.rows[0]);
});

// PATCH /:id — 更新 project（status / description）
router.patch('/:id', async (req, res) => {
  const { status, description, name } = req.body;
  // 构建动态 UPDATE（只更新传入字段）
  // ...
  res.json(updatedRow);
});
```

2. **`packages/brain/server.js`**：同时挂载到 `/api/brain/projects`（保持向后兼容）

```javascript
app.use('/api/brain/projects', taskProjectsRoutes);  // 新增，兼容 SKILL.md 引用
// /api/brain/tasks/projects 保持不变
```

3. **额外**：`GET /` 支持 `kr_id` query filter（decomp SKILL.md Phase 1 引用了 `?kr_id=&type=`）

---

## 批次二：P1 修复（同 PR 一起提交）

### Task-3：[L2-001] 5e 节扩展 completed_no_pr 处理

**文件**：`packages/brain/src/routes.js:2894`

```javascript
// 原代码
if (newStatus === 'completed') {

// 修改为
if (newStatus === 'completed' || newStatus === 'completed_no_pr') {
```

---

## Brain-dispatchable Task JSON

```json
[
  {
    "title": "fix[L1]: executor.js skillMap 补缺 initiative_plan/verify/decomp_review + preparePrompt 分支 + projects GET/PATCH + completed_no_pr",
    "description": "三个文件一起修：\n\n1. packages/brain/src/executor.js line 858 skillMap 补三条：\n   initiative_plan → /decomp\n   initiative_verify → /decomp  \n   decomp_review → /decomp-check\n   \n   同时在 preparePrompt 新增判断（Talk 类型前）：\n   initiative_plan/verify → return `/decomp\\n\\n${task.description}`\n   decomp_review → return `/decomp-check\\n\\n${task.description}`\n\n2. packages/brain/src/routes/task-projects.js 新增:\n   GET /:id 返回单个 project\n   PATCH /:id 更新 status/description/name\n   GET / 支持 kr_id query filter\n\n3. packages/brain/server.js 新增挂载:\n   app.use('/api/brain/projects', taskProjectsRoutes);\n\n4. packages/brain/src/routes.js:2894 扩展条件:\n   if (newStatus === 'completed' || newStatus === 'completed_no_pr')",
    "priority": "P0",
    "skill": "/dev",
    "repo_path": "/home/xx/perfect21/cecelia"
  }
]
```

---

## 修复后验证

```bash
# 1. 验证 skillMap
node -e "import('./packages/brain/src/executor.js').then(m => {
  console.log(m.getSkillForTaskType('initiative_plan')); // /decomp
  console.log(m.getSkillForTaskType('decomp_review'));   // /decomp-check
})"

# 2. 验证端点
curl -s localhost:5221/api/brain/projects/<id>         # 200
curl -s -X PATCH localhost:5221/api/brain/projects/<id> -H "Content-Type: application/json" -d '{"status":"completed"}' # 200

# 3. 验证 completed_no_pr
# execution-callback with status: "AI Done" and no pr_url → 产生 completed_no_pr → 触发下一个 initiative_plan
```
