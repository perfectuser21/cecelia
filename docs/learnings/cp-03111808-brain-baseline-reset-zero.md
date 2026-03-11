## Brain 测试 Baseline 同步至当前真实失败数（2026-03-11）

**失败统计**：CI 失败 2 次，本地测试失败 0 次

**CI 失败记录**：
- 失败 #1：Learning Format Gate 要求 `docs/learnings/<branch>.md` 存在 → 补写本文件 → 所有走 /dev 的 PR 必须写 Learning，即使是纯配置修改
- 失败 #2：任务描述"测试已全部修复（失败数为 0）"不准确——实际 unit:235 / integration:10 个测试仍在失败。直接归零为 0 会阻塞所有后续 Brain PR。调整策略：将 baseline 同步为当前真实失败数（235/10）而非 0。

### 根本原因

1. 任务下发时描述了"失败数为 0"，但未经验证即接受，应先通过 CI 确认实际失败数再设置 baseline
2. Learning 应在 Step 6 写代码完成后立即写，不能等 CI 失败再补写
3. Baseline 机制的语义是"容忍预存在的失败"——归零为 0 意味着"没有预存在失败"，这是一个强声明，必须通过实际测试验证

### 下次预防

- [ ] 修改 baseline 前必须先运行 CI（或本地 vitest）确认当前真实失败数，不依赖任务描述
- [ ] 任何走 /dev 工作流的 PR，Step 6 写代码完成后立即写 Learning（不等 CI 结果）
- [ ] Learning 文件路径：`docs/learnings/<branch-name>.md`（不是 `docs/LEARNINGS.md`）
