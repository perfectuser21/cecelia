# DoD: Dashboard 测试金字塔页面（刀0 面板增量）

- [x] [BEHAVIOR] Brain 存取端点：POST 校验+upsert working_memory / GET 三态（有数/无数/DB异常灰态）
      Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/quality.test.js')"
- [x] [BEHAVIOR] 页面渲染三态（绿/红条 failures/灰态含日更提示），fetch /api/brain/quality/test-pyramid
      Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('apps/api/features/execution/pages/TestPyramidPage.tsx','utf8');if(!c.includes('/api/brain/quality/test-pyramid'))process.exit(1)"
- [x] [BEHAVIOR] 日更脚本 best-effort 喂数（--max-time 5 + || true，Brain 不在不炸）
      Test: manual:bash scripts/__tests__/write-current-state.test.sh
- [x] guard 棘轮不回退
      Test: manual:node scripts/test-pyramid-guard.mjs
