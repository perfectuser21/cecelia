## Brain {VERSION} — 价值流建模⑤：探针挂点 target + 格子扩到 step/enabler 级 + GET /steps、/enablers + golden_path* 退役标注（决策 3e867cad 第 11/13 张表 / f425e3fd）

- 迁移 496：`step_probes` 加 `target_type`(activity|step|enabler) / `target_id`，`journey_step_link_id` 保留（活动格照绑，翻色仍活动级）；既有 18 条探针回填 target_type=activity、target_id=活动格的 step_id，`coll_rescan_rate`（兜底重搜触发率）改挂 step `keyword_acquisition.collection.return_to_results`。任务 741cdf5a。
- `journey_step_links` 三级格子：`cell_level`(默认 activity) / `step_id_ref`→steps / `enabler_id`→enablers；按 `steps` 给智能获客价值流 44 个 step 各生成一格 `step:<key>`（gray，挂所属活动），按 `enabler_calls` 给每个被调用的 enabler 生成一格 `enabler:<key>`（挂最早调用它的活动）；ON CONFLICT DO NOTHING 重放不覆盖颜色。state-resolver 翻色逻辑不变（step 级翻色留后续）。
- 探针规范 `step-probe-spec.js` 认可选 `target: {type, key}`（缺省不进 spec、既有哈希不变）；`POST /api/brain/step-probes` 持久化 `target_type`/`target_id`（成对校验；不给则库侧缺省 activity + 格子 step_id）；`scripts/sync-step-probes.mjs` 经 `GET /steps?key=` / `GET /enablers?key=` 解析 target_id，查不到报错退出，journey 下已有 `step:<key>` / `enabler:<key>` 格子时额外绑 assertion_ref。
- 新只读 API `GET /api/brain/steps`（key / activity_id / active=all）与 `GET /api/brain/enablers`（key / active=all）。
- golden_path / golden_paths / golden_path_contract_versions：仓库仍有 74 处活引用（harness-judge / handoff / acceptance / abilities / golden-paths 路由等），本迁移不 RENAME 不 DROP 一行不动，只挂退役注释；Notion 投影无新表/视图不登记。
- 新 smoke `probe-targets-cells-smoke.sh`（迁移/回滚结构 + 接线 + 可选真库），回滚 `rollback/496_probe_targets_cells_levels.down.sql`。
