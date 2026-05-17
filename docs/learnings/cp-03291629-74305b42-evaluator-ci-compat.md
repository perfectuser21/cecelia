# Learning: Evaluator Sprint Contract CI 兼容性约束

**分支**：cp-03291629-74305b42-71bc-460e-81d1-f83e1c
**日期**：2026-03-30
**类型**：prompt 规则强化

---

### 根本原因

spec_review subagent（Evaluator）在 Sprint Contract"独立生成测试方案"阶段没有 CI 兼容性约束，
导致它可能生成"打开浏览器点击按钮"这类描述性测试方案。这些方案在 Sprint Contract 比对时看起来合理，
但实际 CI 无法执行，造成验证环节脱节：通过了 Sprint Contract 但 CI 无法复现验证。

**问题链**：Evaluator 无约束 → 生成 UI 交互描述 → Sprint Contract 比对通过 → CI 执行失败 → 验证脱节

---

### 下次预防

- [ ] 每次新增 Sprint Contract 类 subagent 时，首先问："它生成的测试方案是否必须 CI 可执行？"
- [ ] 测试方案白名单：`node -e "..."`、`curl`、`tests/*.test.ts` — 这三种形式 CI 均可执行
- [ ] 禁止浏览器/UI 操作描述（playwright.click、打开页面等），除非封装在 tests/ 文件中
- [ ] Evaluator 自身的 `my_test` 字段适用与主 agent Test 字段相同的 CI 兼容性规则

---

### 踩坑记录

**branch-protect.sh packages/ 子目录 PRD 规则**：
在 `packages/workflows/` 子树下编辑文件时，hook 就近检测 PRD/DoD。
由于 `packages/workflows/.prd.md` 已存在（旧任务残留），hook 优先使用它。
修复：在 `packages/workflows/` 也创建 `.prd-{branch}.md` 和 `.dod-{branch}.md`。
参考 memory：packages/workflows/ PRD/DoD 必须放两处（根目录 + packages/workflows/）。
