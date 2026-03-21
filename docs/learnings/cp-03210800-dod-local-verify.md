# Learning: verify-step.sh Gate 2 DoD 逐条执行

## 背景
verify-step.sh 的 Stage 2 验证只跑 npm test，不执行逐条 DoD Test 命令。AI 可以标记 step_2_code: done 但实际没验证 DoD。

### 根本原因
verify-step.sh 的 verify_step2() 最初设计时只做了两层检查：
1. 检查是否有实现代码改动
2. Gate 1 跑 npm test

缺少 Gate 2 逐条执行 Task Card 中 [BEHAVIOR] 条目的 Test 命令。02-code.md 的 2.3.3 也只有伪代码注释说明"读 Task Card，逐条执行 Test"但没有实际脚本实现。

### 下次预防
- [ ] 新增验证层时，同步更新 verify-step.sh 和对应的 step 文档
- [ ] 文档中的 bash 代码块如果只有注释没有真实命令，标记为 TODO 并跟踪
- [ ] Gate 设计应遵循"CI 有的本地也要有"原则，dod-execution-gate.sh 的逻辑应同步到本地验证
