## Brain {VERSION} — Step 进 Brain + 使能件注册表（价值流建模 13 张表第一批）

- 迁移 492 新建 `steps`（Step 投影，真身 = zenithjoy-workspace step-dod.json，`source_sha256` 漂移即报）、`enablers`（使能件注册表，kind=code|agent 是执行体轴）、`enabler_calls`（活动/步骤 → 使能件调用关系，caller_type=activity|step）；种子 enabler `return_to_results`（归位，back-to-results / back-to-profile 单份定义）挂到 keyword_acquisition 最新骨干的 collection 活动。决策 3e867cad / f425e3fd，任务 8345a8dc。
- 新脚本 `packages/brain/scripts/sync-steps-from-workspace.mjs [--file <step-dod.json>] [--dry-run]`：按 activity_key + capability_key 把 43 步 upsert 进 `steps`，挂到最新 backbone_version 的活动；缺活动整批不写并列出全部缺失 key；重跑 0 变更。
- 探针规范库 `step-probe-spec.js` 新增 `metric` 型（`probe: {type: metric, ref: metrics.<k>}`，无 target；observed 由执行机 verify-step 回传，判定端 business-probe-judge 不变）；此前 workspace `social-keyword-leadgen.yaml` 里 8 条 metric 探针（preflight/cleanup 四件 + collection 归位一次做对率 `coll_rescan_rate`）同步进 Brain 报 STEP_PROBE_TYPE_INVALID。Notion 探针投影「查什么」metric 显示 ref。新 smoke `step-probe-metric-smoke.sh`。
- 背景：09-30 凌晨批 cmd09300230 归位 134/134 走兜底重搜、6 小时只出 4 条线索，而 delivery/scoring 结果探针全绿——"采集"格子从画出来起就是灰的；Step 与 Enabler 进 Brain 后探针才能挂到"归位"这一步。
