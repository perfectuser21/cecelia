## Brain {VERSION} — tasks.kind 真列（agent | workflow）+ 属性约定（任务类型模型收敛第一刀）

- 迁移 466/467：`tasks.kind TEXT` + `tasks_kind_check`（agent | workflow，NULL=未分类）NOT VALID 登记 → 按注册表分批回填 → 467 VALIDATE；决策 df67a9d6 / e073bdc2，链 bf5088a3 棒4（任务 94465721）
- `lib/task-type-registry.js`：每个 task_type 显式声明 `kind`（编排 ≥2 阶段 = workflow：workflow_run / content-pipeline / harness_initiative / golden_path_proposal / harness_task / crystallize / project；其余 agent）；导出 `TASK_KINDS` / `KIND_FOR_TASK_TYPE` / `WORKFLOW_KIND_TASK_TYPES`
- `lib/task-kind.js`：`deriveTaskKind` / `assertTaskKind`（`invalid_task_kind`）/ `resolveTaskAttributes`（department→dept 真列，skill / workflow_ref / engine / device 走 payload 规范键，兼容旧 qiumi_* 键）
- 建单：`createRoutedTask` INSERT 写 kind（调用方给则校验、否则按类型派生）；`POST /api/brain/tasks` 接 `kind`，非法 400 `INVALID_KIND`
- 秋米路由：Jev kind 枚举改 import 注册表；agent 分支落库同一条 UPDATE 写 `kind` / `dept` 真列，payload 双写 `engine` / `workflow_ref`
- 消费方：Notion 任务投影取 `t.kind`，Description = `<task_type> · <kind> · brain:<id>`
- 84 个 task_type 本刀不退役（零行为变化）；smoke `task-kind-column-smoke.sh`
