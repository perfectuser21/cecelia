# Notion片段读回验收

- [x] [BEHAVIOR] 相同链接片段合并后正文读回成功且幂等，漏字/链接篡改仍失败保旧。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/projection/__tests__/workflow-body.test.js --maxWorkers=1 --minWorkers=1"

实际Notion四项读回验收未通过前不得完成任务。
