# Learning: Pipeline 三层架构落地

**Branch**: cp-04091606-e08e1e40  
**Date**: 2026-04-09

### 根本原因

Harness v4.0 pipeline 有独立的 harness_evaluate agent，在 CI 通过后运行，但 PR 还没有 merge，evaluator 调用 `localhost:5221` 时访问的是旧 Brain（没有新代码），导致第一次 evaluate 必然 FAIL，陷入死循环。

根本矛盾：evaluate 在 merge 前跑，但合同测试依赖 live Brain（merge 后才有新代码）。

### 架构决策（2026-04-09 CTO/COO 对齐）

官方 Anthropic 论文设计：Planner → GAN 合同 → Generator 执行 → CI 验证 → 完成。

CI 本身就是机械执行器（Evaluator）。独立的 harness_evaluate agent 是多余的。

新三层架构：
```
Planner → GAN 合同（谈清楚"什么叫做完"）→ /dev（写代码+CI）→ 完成
```

### 下次预防

- [ ] 新增 harness pipeline 步骤前，确认是否可以用 CI 替代
- [ ] 评估 agent 是否依赖 live Brain API → 如果是，必须在 merge 后才能运行
- [ ] pre-push hook 不得有 SKIP/bypass 后门
