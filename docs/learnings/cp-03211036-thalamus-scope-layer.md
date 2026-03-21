# Learning: Thalamus + Suggestion-Dispatcher Scope 层级识别

## 背景

Thalamus prompt 路由表和 Suggestion-Dispatcher prompt 层级定义中，缺少 Scope 层级（Layer 5），
导致用户输入"scope"/"范围"/"边界定义"等关键词时无法正确路由到 initiative_plan 任务类型，
Suggestion 分派也无法识别 Scope 层级。

### 根本原因

层级体系从 6 层扩展到 7 层（新增 Scope 层）后，Thalamus 和 Suggestion-Dispatcher 的 prompt
文本未同步更新。Prompt 是硬编码字符串，没有从统一的层级定义常量生成，因此容易遗漏同步。

### 下次预防

- [ ] 新增/修改层级定义时，全局搜索所有 prompt 中的层级引用（grep "Layer.*KR.*Project.*Initiative"）
- [ ] 考虑将层级定义提取为共享常量，prompt 模板引用常量而非硬编码
- [ ] feat 类型提交必须附带测试，验证 prompt 中包含预期的层级关键词
