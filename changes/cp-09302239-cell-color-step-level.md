## Brain {VERSION} — 地图翻色扩到 step/enabler 级格子：探针 target 回执落子格 + 活动格向上汇总（任务 45e5db42，决策 3e867cad）

- `lib/business-probe-judge.js`：查探针时带出 `step_probes.target_type/target_id` 与活动格 `step_id`；`target_type=step|enabler` 的探针经一次批量查询解析到 journey 下对应的 `step:<key>` / `enabler:<key>` 格（`cell_level` + `step_id_ref`/`enabler_id` 匹配），回执 `journeyStepLinkId/assertionRevision` 与 `cell_status` 翻色都落子格；journey 没生成对应子格 → 退回活动格，判定不丢。
- 活动格颜色 = 自身探针本轮状态 ∪ 其下全部 step/enabler 格当前颜色的最坏值（red > pending > green，gray 不参与）；先翻子格再汇总活动格，子格上一轮留下的红会拖红活动直到该子格被重判。生产 `coll_rescan_rate`（归位兜底重搜率，迁移 496 已挂 step `keyword_acquisition.collection.return_to_results`）从此翻 `step:…return_to_results` 格并把「采集」活动一起翻色。
- 纯活动级探针（target_type=activity / 老行）不发子格解析查询，行为与从前一致；`state-resolver` 不改（总图页读 `journey_step_links.cell_status`）。
- 新 smoke `cell-color-step-level-smoke.sh`（mock pool 不连库：step 翻色 / 活动汇总 / 退回活动格 / 纯活动级不查子格）登记 allowlist；单测 6 条新用例（红→绿）。
