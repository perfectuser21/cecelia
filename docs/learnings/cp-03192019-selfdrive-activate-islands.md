## Learning — SelfDrive 孤岛激活：学习与吸收 + 工作记忆

### 根本原因

`learning-absorption` 和 `memory-working` 被 Scanner 误判为孤岛，原因不是能力未使用，
而是 capabilities 表中 `related_skills` 和 `key_tables` 字段为 NULL/空。
Scanner 只通过这两个字段做证据查找，字段空 → 无证据 → 标记 island。

### 分析

实际数据状态：
- learnings 表：288 条记录（已大量使用）
- working_memory 表：有数据（每次任务执行都在读写）
- absorption_policies 表：2 条记录

这是元数据缺失问题，不是能力未实现问题。

### 解决方案

migration 161 更新两条 capabilities 记录，补充 related_skills 和 key_tables：
- `learning-absorption`：skills=[dev], tables=[learnings, learning_queue, absorption_policies]
- `memory-working`：skills=[cecelia-brain], tables=[working_memory]

### 下次预防

- [ ] 新增 capability 记录时，必须同时填写 related_skills 和 key_tables
- [ ] Scanner 扫描后若发现孤岛，先验证是否"元数据缺失"而非"真实孤岛"
- [ ] 建议在 capabilities 表添加 NOT NULL 约束或 CI 检查，防止空字段入库
