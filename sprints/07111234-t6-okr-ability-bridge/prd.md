# PRD: T6 两轴衔接——KR↔Ability 轻边 + 对账端点

OKR 轴够不着能力轴，季度意志无法对账成资产。KR 通过 key_results.metadata.target_abilities
指向 journey_features 能力，对账端点算出各能力厚度与推进项完成度。
架构：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md（T6 行，PR #3731 拍板）。

## 成功标准
- PATCH /api/brain/goals/:kr_id 可 merge 写入 metadata.target_abilities（NULL 列不吞写）
- GET /api/brain/okr/kr/:id/ability-progress 输出对账视图，数字与 journey_features/advancement_items 直查一致
- 失联/格式非法的 ability id 进 missing_ability_ids 暴露而非静默丢弃或 500
