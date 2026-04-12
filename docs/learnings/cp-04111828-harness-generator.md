### 根本原因

本次任务将 harness-planner SKILL.md 从 v4.1 升级到 v5.0，核心变更：
1. Step 0 从"读代码文件"改为"调用 Brain API 采集系统上下文"，并明确标注不读代码实现细节的边界
2. 新增 9 类歧义自检表格，替代原来的模糊探索步骤
3. PRD 模板从简单 Feature 列表升级为结构化 spec-kit（User Stories/GWT/FR-SC编号/假设/边界/范围限定/受影响文件/OKR对齐）

branch-protect.sh 要求 .dev-mode.{branch} 文件存在才能写入代码文件，harness-generator 直接操作时需先创建该文件。

### 下次预防

- [ ] harness-generator 执行前确认 .dev-mode.{branch} 已存在，否则先创建再写文件
- [ ] SKILL.md 中涉及歧义类别的表格，字段名称要与合同 DoD 验证命令中的关键词完全匹配（如"UX"而非"用户体验"）
- [ ] OKR 对齐章节必须同时包含 KR、进度、推进三个关键词，缺一会导致 DoD 验证失败
