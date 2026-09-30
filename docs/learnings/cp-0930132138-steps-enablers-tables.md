## Step 进 Brain + 使能件注册表（2026-09-30）

### 根本原因
- 43 步契约只活在 zenithjoy-workspace 的 `step-dod.json`，Brain 地图（journey_steps / backbone_activities）只到 8 个活动；探针 `step_probes.journey_step_link_id` 只能挂到活动级格子，挂不到"归位"这一步。09-30 凌晨批 cmd09300230 归位 134/134 走兜底重搜，delivery/scoring 结果探针照样全绿——格子有、断言空。
- 横切件（归位、设备锁、账号自证）在 back-to-results / back-to-profile 各抄一份、各修各的，没有单份定义可挂探针、可对账。

### 下次预防
- [ ] 每条 Step 进 Brain 用 `sync-steps-from-workspace.mjs` 灌，真身永远在仓库 step-dod.json；`source_sha256` 不一致就是漂移，别手改 `steps` 表。
- [ ] 新增横切件先在 `enablers` 登记 key + impl_ref，再在 `enabler_calls` 挂到调用它的活动/步骤；同一件事被两条 workflow 用就必须共用一条 enabler 行。
- [ ] 迁移里的种子挂关系用 `ORDER BY backbone_version DESC LIMIT 1` 选最新骨干，不要写死 journey_steps.id。
- [ ] 集成测试按 migration-359 的独立 schema 模式写；`afterAll(pool.end)` 放文件级，放在第一个 describe 里会把后面的 describe 全部干掉（本次踩过一次）。
