## Brain {VERSION} — 树+仓库 v3.0 第 6 刀后清理：Notion 注册表清理与旧树 Feature 镜像停推

- 任务 939ccfc9（主理人 10-06 点名要删的几样之二；`activities.workflow_id` 与旧树 Feature 表本身经核查不能删，见下）。迁移 530：
  - 清掉 4 行已停用的旧库登记（`activities` / `activity_cells` / `okr_projects` / `tasks` 各一行），只删同一张表上已有非 archived 登记的行，所以 `registry_coverage`（每张带 `notion_id` 的表至少一行）不受影响；删前整行备份进 `migration_530_notion_map_backup`。Notion 页一律不删，口径同迁移 523。
  - 旧树 Feature 镜像（`journey_features` → 「旧树 · Feature」）改 archived 停推，登记行保留；表本身不动。
  - 回滚按备份还原；本机验证 升级 → 回滚 → 再升级，生产库干跑 71 → 67 行且回滚后恢复。
- 核查结论（未改）：
  - `activities.workflow_id` **不是冗余列**：生产 51 个非空，其中只有 13 个的归属能从流程引用的 `source_ref` 为空那条推出，其余 38 个（workflow-authoring 登记的都带 `source_ref`）只有这一列记「谁登记了这个活动」，也是 workflow-authoring 防抢占的依据。删它要先设计新的归属标记。
  - `journey_features` 表不能直接退役：311 行，7 张活表有外键指向它（`tasks`、`initiative_runs`、`golden_path`、`activity_cells`、`advancement_items`、`warehouse_items`、`workflows`），51 个生产文件读它，视图 `features_registry` 依赖它。
- 测试：`notion-projection-registry` 里「旧 AI Steps 行保持 archived」改为「不存在，存在则必须 archived/none」（本意是不得复活）；新增迁移形状测试与真库行为测试。
