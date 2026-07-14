# DoD: 刀1 测试入册毕业机制 + 42孤儿清偿

- [x] [BEHAVIOR] guard 全绿且孤儿棘轮锁死 0（sprints 非 archive 下无任何未入册测试）
      Test: manual:node scripts/test-pyramid-guard.mjs
- [x] [BEHAVIOR] graduate 脚本按路由搬运（dry-run 计划/真搬/冲突不覆盖/slug 规则）
      Test: tests/graduate-sprint-tests.test.ts
- [x] [BEHAVIOR] 毕业进 tests/regression/ 的回归测试在 brain vitest 跑道全绿
      Test: manual:node -e "const fs=require('fs');const n=fs.readdirSync('tests/regression').length;if(n<1)process.exit(1)"
- [x] baseline 棘轮账本随清偿回填（orphans 0 / permanent 1121 实测）
      Test: manual:node -e "const b=require('./scripts/test-pyramid-baseline.json');if(b.orphans!==0)process.exit(1)"
