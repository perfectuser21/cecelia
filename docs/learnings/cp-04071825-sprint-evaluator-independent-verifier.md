---
branch: cp-04071825-1ea10691-c478-4032-9d53-319bf9
date: 2026-04-07
task: sprint-evaluator 重写为独立广谱验证者
---

# Learning: Sprint Evaluator 从机械执行器到独立验证者

### 根本原因

原始设计把 Evaluator 设计为"跑合同里 Generator 预写的 bash 命令"，这违背了 Anthropic 官方 Harness 论文的核心设计原则：

> Evaluator 应该像真实用户一样独立测试系统，而不是执行 Generator 写好的脚本。

问题：Generator 写好验证命令相当于"自己写题自己批改"，无法发现 Generator 自身盲区里的 bug。

### 下次预防

- [ ] 设计 Evaluator 时，默认起点是"Evaluator 完全不知道 Generator 怎么实现的"
- [ ] 合同（sprint-contract.md）应只描述**行为描述 + 硬阈值**，不写验证命令
- [ ] Evaluator 测试至少覆盖 3 个维度：happy path + 边界 + 数据一致性
- [ ] 后端系统验证工具链：Brain API（curl）+ psql + 触发真实任务流
- [ ] 验证结果必须是量化对比（预期值 vs 实际值），不能是"命令成功退出"
