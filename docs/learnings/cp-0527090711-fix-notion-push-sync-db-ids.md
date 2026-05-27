# Learning: fix-notion-push-sync-db-ids

## 根本原因

WS1（PR #3140）实现 `pushDecisions` / `pushInitiativeContracts` 时，两个 Notion DB ID 是占位符（`1b2c40c2-...` / `2c3d40c2-...`），且字段名（`Status/Category/Decision/Reason/Version/PRD`）不匹配 AI Notes DB 真实 schema（只有 `Title/Type/Date`）。

## 下次预防

- [ ] 写 notion-push 函数时，先用 Notion API 验证 DB ID 真实存在：`curl .../databases/<id>` 返回 200 才算
- [ ] 新 push 函数的 properties 必须和 DB schema 字段一一对应，多余字段会导致 400/404
- [ ] 内容字段（长文本）放 page body children，不放 properties（properties 只放 Title/Type/Date 等结构字段）
- [ ] WS1 类实现 PRD 应包含"Notion DB ID 验证"作为前置条件
