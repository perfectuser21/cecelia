---
branch: cp-04080648-b7a4ec66-54b6-4c69-b6fa-4e14b7
task_id: b7a4ec66-54b6-4c69-b6fa-4e14b7fd39e6
created: 2026-04-08
---

# Learning: Harness v3.1 contract 对抗核心修正

## 根本原因

在 v3.0 → v4.0 的迭代中，有人误解了 GAN 对抗的位置和验证命令的归属：

1. **contract-proposer v3.0** 将合同格式从"含验证命令"改为"行为描述+硬阈值"——认为让 Evaluator 自主设计测试更灵活
2. **sprint-evaluator v4.0** 跟进，改为"独立广谱验证者"，自主设计测试方案

这导致了根本性错误：
- GAN 对抗（验证命令是否严格）从 contract 阶段消失了，变成了 Evaluator 单方面发挥
- contract 阶段失去了"Generator 提验证命令 → Evaluator 挑战严格性"的核心对抗

## 正确设计（来自 Anthropic 官方论文）

```
Generator 提合同草案（含验证命令，广谱：curl/npm/psql/playwright）
  ↕ GAN 对抗：Evaluator 挑战"命令够不够严格？"
合同 APPROVED
Generator 写代码
Evaluator 机械执行合同里的命令（无脑跑命令看 exit code）
```

GAN 对抗的本质是：Generator 和 Evaluator 在 **contract 阶段** 对抗，商定严格的验证命令。执行阶段 Evaluator 是机械执行器，不需要再自主发挥。

## 下次预防

- [ ] 改 Harness 任何 skill 前，先读 `memory/harness-v3-design.md` 确认官方设计
- [ ] 合同格式一定要包含可执行的 bash 验证命令（不能只有"行为描述"）
- [ ] Evaluator 的职责分两阶段：contract 阶段挑战命令严格性，execute 阶段机械执行命令
- [ ] 不能为了"灵活性"让 Evaluator 在执行阶段自主设计测试——那会让 contract 阶段的 GAN 对抗失去意义
