# Learning: getContentType DB 优先但 YAML 为新字段默认值源

## 背景

solo-company-case pipeline 的 research 阶段始终没有 notebook_id，orchestrator 生成的 research task payload 缺少此字段，导致 executor 立即失败。即便 orchestrator 代码已正确注入 `typeConfig?.notebook_id`，实际跑起来仍为空。

### 根本原因

`getContentType` 函数优先读 DB `content_type_configs` 表，若有 DB 记录则直接返回，完全不读 YAML。

solo-company-case 在 DB 中有 2026-03-27 seed 的旧记录，该记录不包含 `notebook_id` 字段。我们在 YAML 中新增 notebook_id 的变更（PR #1749）因此被 DB 记录覆盖，永远不会被 `getContentType` 返回。

这是 "DB 覆盖 YAML" 模式的典型盲区：当 YAML 新增字段时，所有已有 DB 记录的类型都无法自动继承新字段的值。

### 下次预防

- [ ] 修改 content-type YAML 新增字段时，同步检查 `content_type_configs` DB 表中的旧记录是否需要迁移
- [ ] `getContentType` 的 DB 优先逻辑需要"新字段回落 YAML"机制：若 DB 记录缺少某字段，从 YAML 补充
- [ ] 验证修复是否生效时，应直接调用 `GET /api/brain/content-types/:type/config` 检查 `source` 字段（db/yaml），而非只看代码
