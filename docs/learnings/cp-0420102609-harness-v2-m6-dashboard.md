# Harness v2 M6 — Dashboard Learning

### 根本原因
M6 实现 Initiative 级 Dashboard。架构分层清晰：backend API + frontend page + feishu + report。

### 下次预防
- [ ] mermaid 依赖先查 package.json（已有则 dynamic import）
- [ ] notifier 扩展走 export function 模式，避免循环依赖
- [ ] Initiative 级 API 用 tasks.payload->>'parent_task_id' 找子任务，不加 FK
