## Brain {VERSION} — 验证层探针/判定回执/格子颜色投影到 Notion 驾驶舱（链 bf5088a3 棒4-2）

- 迁移 478：`step_probes` / `journey_assertion_receipts` 加 notion_id/notion_synced_at/notion_digest 记账列；回执表 append-only 触发器改为只放行「仅记账列变化」的 UPDATE（业务列 UPDATE/DELETE 仍拒，cecelia_test 实测）；`journey_step_links` 加 `updated_at` + 触发器（非记账列变化才抬，引擎回写 synced 不自激）；`notion_projection_map` 登记「探针」`3e8c40c2-ba63-8182-954e-f9eda21d137e`、「判定回执」`3e8c40c2-ba63-81d7-8c48-c70142b3f0bc`（push/active，在「数据落脚总台账」页下由 `scripts/ops/create-probe-notion-dbs.js` 幂等建成）。
- 新血管 `notion-probe-projection.js`：探针库列=探针键/工作流/步骤/查什么/期望/严重级/启用/哈希前缀/关联格子/说明；判定回执库只投 `executor_kind='business_probe_runner'`（harness 代码断言不投），列=时间/批次(run_id 去 `<workflow>-crontab-`)/路径名/步骤名/探针/读回/期望/判定/严重级/原因；走 `pushRegisteredRows` 指纹去重、resolveDbId 注册表门、缺列即补，挂在 `runNotionPushSync` 末尾吞错不连坐。
- `pushJourneyStepLinks` 改为推格子行且增量可更新：`notion_synced_at IS NULL OR updated_at > notion_synced_at`、LIMIT 50（283 格子首推约 30 分钟排空，之后只推翻色行）；Backbone-Step Map 补 CellKind/CellKey/CellStatus/AssertionRef/Journey(relation) 列，去掉库里不存在的 Journey/Step 旧写法（09-27 实查该库 0 行、旧推送必 400）。
- smoke `notion-probe-projection-smoke.sh` 登记 allowlist。
