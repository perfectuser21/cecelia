## Brain {VERSION} — Projects 真身表升格（接力棒链 2afa6d69 棒1，决策 ee4842a6/3feeae3e）

- GTD 轴只保留四级 Objective → Key Result → Project → Task；Project 从 `tasks.task_type='project'` 虚拟根升格为独立的 `projects` 表（迁移 495，186 曾把它整表 DROP，本次重建并把 `tasks.project_id` 外键重新接上）
- `okr_projects` 数据原样搬进 `projects`（同 id）；历史 `task_type='project'` 根任务迁成 `projects` 行并回填子任务 `tasks.project_id`（`okr_projects` 表本身保留不动，28 个直接读它的文件的退役是后续棒的工作）
- 链解析（`handoff.js getChainContext` / `GET /tasks/:id/chain`）、建单闸（`project-root-gate.js`）、接力棒接棒（`relay-baton.js materializeNextSteps`）新增 `project_id` 快路径，无 `project_id` 的旧链走原有 `parent_task_id` 祖先链逻辑不受影响
- `/api/brain/projects`（`task-projects.js`）与 `/api/brain/okr/projects`（`okr-hierarchy.js` mountCrud）改为读写同一张 `projects` 表；`task-projects.js` 新增 `POST /`（`kr_id` 若给必须是真实 `key_results`）
- Notion「Projects」库投影（`notion-relay-projection.js`）数据源从 `tasks(task_type='project')` 改为 `projects` 表，Notion 页 id / 指纹挪进 `projects.notion_props`
