# Learning: executor.js US_ONLY_TYPES 白名单与 task-router.js 不同步

分支: cp-03212342-fix-coding-route-us
日期: 2026-03-21

### 根本原因

executor.js 维护了一个独立的 `US_ONLY_TYPES` 白名单，与 task-router.js 的 LOCATION_MAP 形成两套路由表。新增任务类型时只更新了一处（task-router.js），另一处（executor.js）被遗漏，导致 initiative_plan 等任务被错误路由到西安 Codex Bridge，出现 "Not inside a trusted directory" 错误。

### 下次预防

- [ ] 路由逻辑只允许一个真相来源：task-router.js LOCATION_MAP
- [ ] 新增 task_type 时只改 task-router.js，executor.js 自动生效
- [ ] Code Review 时检查：任何新的 task_type 映射是否只改了一处
