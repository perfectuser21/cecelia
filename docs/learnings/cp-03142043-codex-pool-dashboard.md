---
id: learning-codex-pool-dashboard
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning：Codex 并发池 + budgetState Dashboard 可视化

**分支**：cp-03142043-codex-pool-dashboard
**PR**：#951

## 做了什么

1. `slot-allocator.js` 新增 `MAX_CODEX_CONCURRENT=3` 和 `countCodexInProgress()`，限制 codex_qa/codex_dev 任务同时运行数量
2. `calculateSlotBudget()` 返回 `codex: {running, max, available}` 字段
3. `tick.js` dispatch 前检查 `codexSlots.available`，满槽时返回 `reason=codex_pool_full`
4. `LiveMonitorPage.tsx` CDX 卡片新增 `BudgetBadge` 组件，4 色展示预算状态

## 踩的坑

### DoD grep 模式必须和代码变量名精确匹配

**问题**：DoD 写 `grep -c 'codexAvailable'`，实际代码用的是 `codexSlots.available`，grep 返回 0，CI L1 DoD Verification Gate 失败。

**根因**：DoD 的 Test 命令在 Step 5 写好后，Step 6 实现时可能选择了不同的变量命名方式。

**修复**：用更稳定的搜索词（如 `grep -c 'codex_pool_full'`），这是返回值中的字符串常量，不会随变量命名风格变化。

### Learning 文件和代码必须在同一 commit push

**问题**：代码先 push，Learning 文件没有一起提交 → CI L1 Learning Format Gate 失败。

**根因**：Learning 是 /dev 流程的强制产物，CI 在 PR 分支里找 `docs/learnings/{branch}.md`。

## 下次预防

- [ ] DoD Test grep 模式用字符串常量（返回值/错误码）而不是变量名
- [ ] Learning 文件在第一次 push 前就要写好并加入 commit
- [ ] 代码中的变量命名风格和 DoD grep 模式在 Step 5 定稿时就对齐
