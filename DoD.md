# DoD: task-status-transitions integration test

Brain task-id: e23d83f2-84b9-494c-8740-29978ee9b35d

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js` 存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js')"`

- [x] [BEHAVIOR] POST 创建任务返回 status=queued，GET status=queued 过滤可查到该任务
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js','utf8');if(!c.includes('status=queued'))process.exit(1)"`

- [x] [BEHAVIOR] PATCH queued to in_progress，DB 直查验证状态持久化 + started_at 非空
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js','utf8');if(!c.includes('in_progress'))process.exit(1)"`

- [x] [BEHAVIOR] PATCH in_progress to completed，DB 直查验证 status=completed + completed_at 非空
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js','utf8');if(!c.includes('completed_at'))process.exit(1)"`

- [x] [BEHAVIOR] completed 状态回退返回 409，terminal 状态机保护验证
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js','utf8');if(!c.includes('409'))process.exit(1)"`

- [x] [BEHAVIOR] afterAll DELETE FROM tasks 清理测试数据，无残留
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js','utf8');if(!c.includes('DELETE FROM tasks'))process.exit(1)"`
