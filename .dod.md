# DoD

- [x] [BEHAVIOR] 业务包装中的任务事实、证据与下一步可投影；未知键不投影；重复更新保留人工正文。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/projection/__tests__/task-progress.test.js
- [x] [BEHAVIOR] 项目进展显示最近进行中任务的事实、证据与下一步，未改变任务结果时指纹稳定。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/notion-relay-projection.test.js src/__tests__/notion-relay-projection.projects.test.js
- [x] [BEHAVIOR] 状态不变时事实更新可重新投影，真实隔离 PG 到 Notion 接缝验证项目及任务，人工列保留。
  Test: manual:DB_HOST=/tmp DB_NAME=cecelia_scratch npm exec --workspace cecelia-brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/notion-task-progress.pg.integration.test.js src/__tests__/integration/projects-notion-sync.pg.integration.test.js
