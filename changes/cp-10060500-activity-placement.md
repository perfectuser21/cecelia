## Brain {VERSION} — 树+仓库 v3.0 第 5 刀②：Activity 的位置改由流程引用推出

- 任务 abf4a5df：树是 价值流 → 能力 → 流程 → Activity，Activity 上的直挂列（`journey_id` 指向能力、`step_number` 记顺序）与这条树重复。本 PR 先把路铺好，不删列：
  - 迁移 527 新增 `activity_placement` 视图：每个 Activity 一行，能力 / 流程 / 顺序 / 槽位从生效的流程引用推出；被多个流程共用时，定义归属那条引用（`source_ref` 为空）优先。`journey_id` / `step_number` 放开非空，去掉按它们唯一的约束，Activity 身份改按 `(capability_key, activity_key)` 唯一。
  - 写入方不再写这两列：合同入库、workflow-authoring 登记、公司 KR 注册都只写身份与合同，位置走流程引用；`workflow-authoring` 不再有「无引用底座」的旧模式（没有引用表一律拒绝登记，保留草案）。
  - 登记能力时带 `steps`：经一个「主线」流程（key `gp_steps_<能力id前8位>`）挂靠，价值流不能直接带步骤（返回 400）。
  - `POST /api/brain/journey_steps` 仍可用，语义改为「在能力的流程里按序号放一个步骤」：该序号已有步骤就更新，没有就放进能力的主线流程（没有主线且恰好一个流程就用它，否则新建）。响应里仍回显 `journey_id` / `step_number`。
  - 读者改读 `activity_placement`：`GET /journey_steps`（响应仍带 `journey_id` / `step_number`，Dashboard 不受影响）、步骤台账、blast-radius、级联清单、金路径、战情室、依赖图、夜检。
- 下一步：删列（迁移 528）等本 PR 部署后观察一轮再做。
