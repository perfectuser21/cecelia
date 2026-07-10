# DoD — nightly 去重 + 三把刀三件套守卫
- [x] [BEHAVIOR] 重复的 nightly-full-regression.yml 已删除（#3717 nightly-regression.yml 为幸存刀A）
  Test: manual: node -e "const fs=require('fs');if(fs.existsSync('.github/workflows/nightly-full-regression.yml'))process.exit(1);if(!fs.existsSync('.github/workflows/nightly-regression.yml'))process.exit(1)"
- [x] [BEHAVIOR] 三把刀三件套受守卫测试保护（刀A schedule+issue/刀B 真Postgres/刀C nightly_gate+脚本指向存活文件）
  Test: tests/ → packages/brain/src/__tests__/nightly-regression-config.test.js
- [x] CI 全绿
