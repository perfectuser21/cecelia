## Brain {VERSION} — 登记闸：多刀必挂 project 根 + pushTasks 投影 Project / Blocked by（链 bf5088a3 棒5·PR B，任务 3fad28e0，决策 105a5868）

- 登记闸 `lib/project-root-gate.js`：登记时 `depends_on` 非空或 `payload.multi_task===true` 即「多刀」，`parent_task_id` 祖先链（含自身，≤12 层）上必须有 `task_type='project'` 根，否则 400 `project_root_required`（带建根提示）；声明 `multi_task` 且父下已有兄弟却没写 `depends_on` 键 → 400 `depends_on_required`（显式 `depends_on: []` = 刻意并行）；project 根自身豁免。接入 `POST /tasks` 与 `POST /tasks/:id/dependencies`；闸在 Brain 建单入口，/dev Phase 0 走 POST /tasks 天然被闸，不改 engine
- pushTasks 投影：`Blocked by` 自关联 relation（task_dependencies hard 边，前置必须已投影且带本系统指纹）+ `Project` relation 指纹（`pushed_project` / `pushed_blockers`，根后建页、依赖后加都会重推）；`ops-notion-schema.buildTasksDbProps` + `ensureOpsDbProps` 缺列即补，补不上 / 推送因 Blocked by 报错 → 该列 flag-off 冷却 10 分钟，且不清 notion_id（400 会被误判错库而重建重复页）
- 一致性：单测断言推送用到的每个 Notion 列都在库既有列或补列清单内；smoke `project-root-gate-smoke.sh` 登记 allowlist，带 NOTION_API_KEY 时只读核对 Notion Tasks 库五列
- 真 PG 集成测试：递归祖先链找根、`PUSH_TASKS_QUERY` 的 LATERAL 与指纹条件语义（遗产 notion_id 前置不进 relation、flag-off 不 livelock、指纹一致不再选）
