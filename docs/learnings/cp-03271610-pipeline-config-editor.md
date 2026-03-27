# Learning: Content Pipeline Config Editor — Provider 参数 + 双侧对比

**分支**: cp-03271610-pipeline-config-editor
**日期**: 2026-03-27

### 根本原因

test-step API 在 PR #1614 中硬编码 `provider: anthropic-api`（直连 API），而非 `anthropic`（无头 bridge）。当用户拥有大量无头实例时，默认走 API 直连会绕过无头 bridge，浪费资源且增加成本。

前端 ContentTypeConfigPage 缺少双侧对比布局和 provider 选择器，员工无法在修改 prompt 时直接对比"改前/改后"的效果。

### 下次预防

- [ ] 涉及 provider 选择的 API，必须在 PR 中明确说明默认值及其含义（无头 bridge vs API 直连）
- [ ] 新增 LLM 调用时，默认 provider 应为 `anthropic`（无头），只有明确需要直连时才用 `anthropic-api`
- [ ] 前端 prompt 编辑器应标准为双侧对比布局，避免"盲改"
- [ ] zenithjoy 与 cecelia 跨 repo 改动：zenithjoy 无 hooks，可直接 commit；但记录在同一个 Brain 任务下
