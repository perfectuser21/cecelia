## Brain {VERSION} — 树+仓库 v3.0 第 5 刀①：无流程的 Activity 挂进流程

- 任务 abf4a5df：树是 价值流 → 能力 → 流程 → Activity，但 128 个未退役 Activity 里只有 52 个挂进了流程，另外 76 个是老的「黄金路径步骤」，直接记在能力下（`activities.journey_id`），中间没有流程。迁移 526 让它们都经流程挂在能力下，为清理 `journey_id` / `step_number` 等旧直挂列铺路。
- 规则：所属能力下恰好一个流程就挂进去；没有流程或有多个流程，新建「主线」流程（key `gp_steps_<能力id前8位>`）再挂，不替别的流程做主。引用顺序取 `step_number`，槽位 `step_<n>`，`source_ref` 留空表示定义归属（被别的流程共用时，别的流程那条引用才有 `source_ref`）。
- 只处理未退役且没有生效引用的 Activity，已有引用的不动，重跑幂等；本迁移挂的引用 `source_path` 标 `migration:526`，回滚只删这些引用和因此变空的主线流程。
- 生产干跑（回滚）：挂 76 条引用、新建 4 个主线流程（工厂 F1、客服 GP-A、客服绑定/安装、管家 G1），挂完没有无流程的 Activity。
