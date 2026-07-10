# DoD — 刀B：cecelia 跨组件 integration nightly
- [x] [BEHAVIOR] integration-nightly workflow 存在：schedule UTC 20:30 + workflow_dispatch(fire_test) + Postgres service + Brain 容器
  Test: node -e "const s=require('fs').readFileSync('.github/workflows/integration-nightly.yml','utf8');if(!s.includes('20 * * *')||!s.includes('fire_test')||!s.includes('postgres')||!s.includes('cecelia-brain'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] integration-nightly.sh 覆盖 7 个断言点（健康/task-types/POST tasks/route-task/PATCH 回调/executor_kind/ci_patrol路由）
  Test: node -e "const s=require('fs').readFileSync('packages/brain/scripts/integration/integration-nightly.sh','utf8');if(!s.includes('tick/status')||!s.includes('task-types')||!s.includes('POST')||!s.includes('route-task')||!s.includes('PATCH')||!s.includes('executor_kind')||!s.includes('ci_patrol'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] 任务创建使用合法优先级 P2（非 P3，P3 触发 400）
  Test: node -e "const s=require('fs').readFileSync('packages/brain/scripts/integration/integration-nightly.sh','utf8');if(s.includes('P3')||!s.includes('P2'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] 红 → 开 [integration-red] Issue；绿 → 关闭 open issue
  Test: node -e "const s=require('fs').readFileSync('.github/workflows/integration-nightly.yml','utf8');if(!s.includes('integration-red')||!s.includes('close-issue-on-success'))process.exit(1);console.log('OK')"
- [x] merge 后 proven-to-fire：workflow_dispatch fire_test=1 亲见红 + [integration-red] Issue 开出
- [x] CI 全绿
