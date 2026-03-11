## Brain 测试 Baseline 归零（2026-03-11）

**失败统计**：CI 失败 1 次，本地测试失败 0 次

**CI 失败记录**：
- 失败 #1：Learning Format Gate 要求 `docs/learnings/<branch>.md` 存在 → 补写本文件 → 所有走 /dev 的 PR 必须写 Learning，即使是纯配置修改

### 根本原因

1. 误以为纯配置修改（两行数字改成 0）可以跳过 Learning，实际上 Learning Format Gate 对所有 /dev 流程 PR 强制要求
2. 应该在 push 之前（Step 10 之前）就写好 Learning，不能等 CI 失败再补

### 下次预防

- [ ] 任何走 /dev 工作流的 PR，Step 6 写代码完成后立即写 Learning（不等 CI 结果）
- [ ] 纯配置改动也需要 Learning，如果真的无需 Learning，在 PR title 加 `[SKIP-LEARNING]` 并说明原因
- [ ] Learning 文件路径：`docs/learnings/<branch-name>.md`（不是 `docs/LEARNINGS.md`）
