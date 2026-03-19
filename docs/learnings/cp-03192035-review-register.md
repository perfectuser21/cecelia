# Learning: Step 3 审查任务注册接线

## 任务概要
03-prci.md push 后自动注册 3 个 P0 审查任务到 Brain。

### 根本原因
devloop-check.sh 条件 2.5/2.6/2.7 能检查审查状态，但没有代码负责创建审查任务。门禁装好了但门铃没接线。

### 下次预防
- [ ] 新增 devloop-check 条件时，同时在 /dev 步骤中添加任务注册代码
- [ ] DoD Test 字段必须用 `Test: manual:xxx` 格式，不能用反引号包裹
