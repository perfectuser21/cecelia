## Brain {VERSION} — 树+仓库定稿 v3.0 第 1 刀：Activity 15 列、Step 8 列、8 格固定、顺序归关系表、activity_uses

- 迁移 521（任务 dd66b90e，决策「树+仓库定稿 v3.0」）：Activity（`journey_steps` / 标准名 `activities`）加 inputs / outputs / preconditions / invariants / nfr / failure / readback / judgment / adversarial / shelf_life_days，前七列从 `contract` JSON 拆填（只填空值，contract 留全量快照），shelf_life_days 默认 7。Step（`steps`）加 name / action / inputs / outputs / on_fail（只许 `retry:N` | `abort`），name 先从 key 末段推。
- 8 格固定：每个未退役 Activity 恰好有 promise / nfr / judgment / invariants / failure / readback / adversarial / shelf_life 八个标准格。客服线旧格子名按名映射（FR→promise…，98 行）；获客线 `stage:*` / `regression:*`、所有场景格、能力点格、Step 级格子标 `parent_cell_key='readback'` 子项，`producer_source_revision` 标 invariants 子项；缺的补灰格（生产 926 行，id 记备份）。生产演练：128/128 Activity 恰好 8 格。
- `activity_items` 改名 `activity_uses`（Activity 用仓库的哪几件）。有 workflow_id 但没有 `workflow_activity_refs` 行的 32 个 Activity 补关系行（sequence_no = step_number，source_ref = `migration:521`）。
- `activities` / `activity_cells` 视图重建带新列；回滚先删视图再去列、按备份还原格子名与删补行；scratch up→down→up→up 幂等。回归：`migration-521-activity-columns.test.js`。
