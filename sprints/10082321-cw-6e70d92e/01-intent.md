---
task_id: 6e70d92e-4cf1-4769-93af-28a345b9dc55
step: intent
upstream: []
---
# new-task.mjs 批次自动挂 project（满足 Brain 多刀工作 project 根闸）

### I-1
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs 全部通过，并新增测试覆盖：带 depends_on 但没写 project_id 也没写 project → 退出非 0、stderr 含 project_required、不调 Brain

### I-2
新增测试覆盖：计划写 project: {name, description} → 先 POST /api/brain/projects 一次，之后每条任务请求体顶层 project_id 等于新项目 id

### I-3
新增测试覆盖：计划写 project_id → 不调 /api/brain/projects，每条任务请求体顶层 project_id 等于该值

### I-4
cd packages/brain && npx vitest run scripts/coding-workflow 全部通过
