# Learning: Scope 层全链路闭环修复

## 背景
PR #1223 添加了 Scope 层的文档和部分实现，但 Brain 代码层有 4 个断点导致飞轮无法运转。

### 根本原因
新增 task_type 时只改了部分文件，遗漏了 task-router、executor、migration CHECK 约束、initiative-closer 的后续任务创建。

### 下次预防
- [ ] 新增 task_type 时用 /brain-register skill 确保 6 个文件联动：task-router.js(3处) + executor.js(2处) + migration CHECK + DEFINITION.md + selfcheck.js + 测试
- [ ] 飞轮机制（A完成→创建B任务）必须在 closer 函数中实现，不能只写在 SKILL.md 中
- [ ] Initiative 完成后，需要检查 parent 类型（scope vs project）来决定触发 scope_plan 还是 project_plan
