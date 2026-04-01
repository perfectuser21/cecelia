# Learning: L1 CI 强制前端 DoD 浏览器验证检查

**Branch**: cp-04010843-l1-frontend-browser-check
**Date**: 2026-04-01

---

### 根本原因

CI L1/L3 对前端 PR 只检查 TypeCheck + Build，没有任何机制要求开发者在浏览器里真实验证过功能。"代码能编译"和"功能能跑"是两件事，这个差距导致每次前端功能合并后频繁出现手测 bug，形成多轮修复循环。问题根源是系统层面缺乏强制约束——没有工程门禁，靠人自律永远会被忽略。本次通过在 L1 CI 加 hard gate 解决，不依赖任何人的记忆或自觉。

### 下次预防

- [ ] 所有前端 PR 的 DoD 必须包含 `manual:chrome:` 或 `localhost:5211` 关键词的 `[BEHAVIOR]` 条目
- [ ] L1 `frontend-browser-dod-check` job 在 Stage 2+ 强制检查，缺失则 CI 拒绝合并
- [ ] 同样的问题在 ZenithJoy repo 也存在，已同步加固（PR #110，port 3001）
- [ ] CI 配置变更 PR 标题必须加 `[CONFIG]` 前缀，否则 CI Config Audit 失败
- [ ] Task Card `[BEHAVIOR]` 标签必须在 checkbox 行上（`- [x] [BEHAVIOR]`），不能作为章节标题
