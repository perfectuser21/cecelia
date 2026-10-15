## Brain {VERSION} — build 范围与流水线记录来源

- build 先读取原意图；测试和提交服从任务范围，禁止测试文件时用允许的真实断言验证。
- publish、QA、Commander 将当前任务白名单 Markdown 与准确来源关系同提交，保留旧索引字节并支持幂等恢复。
- build 新增 `build_touched_controlled_metadata` 拒绝原因；模型修复不能编辑来源索引，docs-only 仅豁免三视图可精确重算的控制器增量。
