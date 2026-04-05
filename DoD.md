# DoD: fix(brain): 改进成功率计算精度

## 交付物

- [x] [ARTIFACT] `packages/brain/src/self-drive.js` — `getTaskStats24h` 改用终态统计
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/self-drive.js','utf8');if(!c.includes(\"status IN ('completed', 'failed', 'quarantined')\"))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/quarantine.js` — quarantine UPDATE 新增 `completed_at/updated_at`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');if(!c.includes('completed_at = NOW()'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/content-pipeline-orchestrator.js` — cancel 新增 `updated_at = NOW()`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/content-pipeline-orchestrator.js','utf8');const idx=c.indexOf('父 pipeline 已失败');if(!c.substring(idx-200,idx).includes('updated_at = NOW()'))process.exit(1)"`

- [x] [BEHAVIOR] `self-drive-success-rate.test.ts` — 4 个成功率计算测试通过
  - Test: `tests/packages/brain/src/__tests__/self-drive-success-rate.test.ts`
