# DoD — 刀A：nightly 全量回归闸
- [x] [BEHAVIOR] nightly workflow 存在：schedule 北京 03:30 + workflow_dispatch(fire_test) + 无 pull_request 触发
  Test: tests/ → packages/brain/src/__tests__/nightly-regression-config.test.js
- [x] [BEHAVIOR] integration/**（真 Postgres+全量 migrations）有专属执行点（PR CI 从不跑这组）
  Test: tests/ → packages/brain/src/__tests__/nightly-regression-config.test.js
- [x] [BEHAVIOR] 红时开 [nightly-red] Issue（按日去重）不阻塞 PR
  Test: manual: node -e "const s=require('fs').readFileSync('.github/workflows/nightly-full-regression.yml','utf8');if(!s.includes('nightly-red')||s.includes('pull_request:'))process.exit(1)"
- [x] merge 后 proven-to-fire：workflow_dispatch fire_test=1 亲见红+Issue 开出
- [x] CI 全绿
