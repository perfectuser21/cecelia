# Learning: Sprint Contract 收敛循环改为 shell 脚本驱动

**Branch**: cp-03311019-sprint-contract-loop
**Date**: 2026-03-31

### 根本原因

Sprint Contract Gate 的收敛循环是 MD 伪代码给 Claude 读的，round/divergence 状态存在 Claude context 里。Session 重启后状态丢失，Claude 每次从头来，相当于循环从未运行。这是"把代码的事交给 LLM 脑子记"的典型反模式。

### 解决方案

新建 `sprint-contract-loop.sh`：
- 读取 Evaluator seal 中 `consistent==false` 的条目数作为 blocker_count
- 把 round/blocker_count/divergence 写入 `.sprint-contract-state.{branch}` 磁盘文件
- exit 0 = PASS，exit 1 = 继续迭代，exit 2 = 前置条件缺失
- 01-spec.md Step 4 改为调用脚本，主 agent 根据 exit code 决定下一步

### 架构洞察

| | 旧（MD 伪代码） | 新（shell 脚本） |
|---|---|---|
| 状态存在哪 | Claude context | 磁盘文件 |
| session 重启后 | 状态丢失 | 从磁盘恢复 |
| 循环是否可靠 | 软约束（LLM 自己决定停） | 硬约束（脚本 exit code 决定）|
| 对齐 Anthropic | ❌ 伪代码 while loop | ✅ 代码驱动状态，LLM 只是工人 |

### 下次预防

- [ ] 凡是"需要跨 session 持久化的状态"，必须写文件，不能靠 Claude context
- [ ] 收敛/重试/循环逻辑，优先用 shell 脚本实现，Claude 负责调用不负责"记住"
- [ ] MD 伪代码只适合描述单次执行的步骤，不适合有状态的循环

### 影响范围

- `packages/engine/scripts/devgate/sprint-contract-loop.sh`（新建）
- `packages/engine/skills/dev/steps/01-spec.md`（Step 4 重写为调用脚本）
- Engine 版本 13.71.0 → 13.72.0
