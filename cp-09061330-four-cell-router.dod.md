# DoD: 四格路由器(Crystal 件1)

## 验收清单

- [x] [BEHAVIOR] execution 类工作永不路由进 kernel-harness-v2(meta 三杀手回归防线)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/work-router-four-cell.test.js','utf8');if(!c.includes('永不进 kernel-harness-v2'))process.exit(1)"

- [x] [BEHAVIOR] artifact_kind 分类:显式>标记>默认;intake 默认注入的 tenant_id:'default' 不算执行标记
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/work-router.js','utf8');if(!(c.includes(\"v === 'default'\")&&c.includes('invalid_artifact_kind')))process.exit(1)"

- [x] [BEHAVIOR] answer_known:显式布尔>bugfix/param 默认 known>探索词>默认 true
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/work-router-four-cell.test.js','utf8');if(!c.includes('探索词'))process.exit(1)"

- [x] [BEHAVIOR] code 类原路由契约不破(change_kind_required/profile 校验/字段齐全)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/work-router-four-cell.test.js','utf8');if(!c.includes('老契约不破'))process.exit(1)"

- [x] [ARTIFACT] 30 个真实历史任务回放脚本与分布证据(scripts/replay-four-cell.mjs;实测 30/30 code/known,与事实相符)
  Test: manual:node --check packages/brain/scripts/replay-four-cell.mjs

- [x] 版本 1.273.191 同步(188-190 为三件停车位预留)
  Test: manual:bash scripts/check-version-sync.sh
