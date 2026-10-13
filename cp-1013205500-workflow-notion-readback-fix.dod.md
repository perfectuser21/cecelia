# Notion正文读回修复验收

- [x] [BEHAVIOR] Notion省略纯空白片段后，多条Run/Task正文仍严格读回成功并保持幂等，链接与分隔全部保留。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__/workflow-body.test.js --maxWorkers=1 --minWorkers=1"

部署后必须实际读回Notion页面，重新核对原四项交接验收。尚未读回通过，禁止完成任务。
