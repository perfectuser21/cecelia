# Learning: L1 CI 强制前端 DoD 浏览器验证检查

**Branch**: cp-04010843-l1-frontend-browser-check
**Date**: 2026-04-01

---

### 根本原因

CI L1/L3 对前端 PR 只检查 TypeCheck + Build，没有任何机制要求开发者在浏览器里真实验证过功能。"代码能编译"和"功能能跑"是两件事，这个差距导致每次前端功能合并后频繁出现手测 bug，形成多轮修复循环。

### 下次预防

- [ ] 所有前端 PR 的 DoD 必须包含 `manual:chrome:` 或 `localhost:5211` 关键词的 `[BEHAVIOR]` 条目
- [ ] L1 `frontend-browser-dod-check` job 在 Stage 2+ 强制检查，缺失则 CI 拒绝合并
- [ ] 同样的问题在 ZenithJoy repo 也存在，需同步加固

### 实现要点

- 新 job 仅当 `changes.outputs.frontend == 'true'` 时触发（不影响非前端 PR）
- Stage 1 豁免（仅写 Spec 阶段不需要实际验证）
- DoD 文件查找顺序与现有 `dod-check` job 保持一致（task card → .dod-branch.md → .dod.md）
- 加入 `l1-passed` 的 `needs` 数组，确保硬性阻断
