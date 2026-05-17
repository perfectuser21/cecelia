# Learning: 修复 BrainModelsPage API 参数名错误（2026-03-23）

## 修复 BrainModelsPage 调整模型 API 参数名

### 根本原因

前端 `handleSaveOrgan` 发送请求时用了 camelCase 参数名（`agentId`/`model`），但后端 API 使用 snake_case（`agent_id`/`model_id`）。前后端命名约定不一致导致 400 错误。

### 下次预防

- [ ] 前端调用新 API 时先查后端 route 定义的字段名，确认 camelCase/snake_case 约定
- [ ] Brain API 统一用 snake_case，前端调用处一律 snake_case
