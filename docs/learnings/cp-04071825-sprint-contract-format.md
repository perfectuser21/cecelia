---
branch: cp-04071825-0f581aae-379d-4be6-a746-fd0fe7
date: 2026-04-07
task: 重写 sprint-contract 合同格式 — 行为+硬阈值
---

# Learning: Sprint Contract 合同格式设计

### 根本原因

原合同格式要求 Generator 预写 bash 验证命令，导致两个问题：
1. Generator 倾向于写 happy path 命令（自证清白），Evaluator 只是机械执行
2. 验证命令绑定了具体实现细节，灵活性差

Anthropic 官方设计（论文）中，Contract = 行为标准（what must be true），Evaluator 自主决定如何验证。这才是真正的对抗性评估。

### 下次预防

- [ ] Sprint Contract 写作时，问自己："这条标准能让另一个 agent 独立判断实现是否达标？"
- [ ] 硬阈值必须含具体数字或枚举值，"合理"、"正确"等模糊词是 smell
- [ ] 每个 Feature 必须有失败路径描述，不只是 happy path
