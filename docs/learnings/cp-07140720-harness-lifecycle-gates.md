# harness-lifecycle-gates 收尾学习记录

### 根本原因
生命周期/记账/验收判据靠 SKILL 文本约束 LLM = 结构性失效。task f35db586 dogfooding 成批实证：
behavior_tests=0 照样 PASS、judgments_written 虚报、callback 提前收账、judge_verdict 不落库。
文本指令对 LLM 只是"建议"而非"强制"，模型在高压/长上下文下会跳过或误解约束；
唯一可靠的收敛点是代码闸（机械校验），不是更详细的 prompt。

### 下次预防
- [ ] 新增 pipeline 验收/记账逻辑时默认写成代码闸，SKILL 文本只做说明书（决策 dc18d43d 无闸不成文）
- [ ] 新增 completed 类终态写入点必须接 finalizeHarnessTask 或在 PR 里说明豁免理由
- [ ] 机械闸校验字段前先核对数据生产方的真实 schema（本次教训：exit_code/log_tail 在 behavior_tests 条目内非顶层，差点全线误杀）
