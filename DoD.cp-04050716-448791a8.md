# DoD: fix(brain): 修复内容生成 + 自动发布链路失效

- [x] [ARTIFACT] `tick.js` L718 NOT IN 列表包含 `'content-pipeline'`
  - File: `packages/brain/src/tick.js`
  - Check: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes(\"'content-pipeline'\"))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] `executor.js` liveness probe 排除包含 6 个 content-* 子阶段类型
  - File: `packages/brain/src/executor.js`
  - Check: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');const types=['content-research','content-copywriting','content-copy-review','content-generate','content-image-review','content-export'];if(!types.every(t=>c.includes(t)))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] `model-profile.js` FALLBACK_PROFILE.config.thalamus.provider 为 `'anthropic-api'`
  - File: `packages/brain/src/model-profile.js`
  - Check: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');const m=c.match(/thalamus[^}]+provider:\s*'([^']+)'/);if(!m||m[1]!=='anthropic-api')process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] thalamus LLM 调用使用 anthropic-api (直接 REST)，不走 bridge
  - Test: `manual:node -e "const {FALLBACK_PROFILE}=require('./packages/brain/src/model-profile.js');if(FALLBACK_PROFILE.config.thalamus.provider!=='anthropic-api')process.exit(1);console.log('FALLBACK_PROFILE thalamus.provider=anthropic-api OK')"`

- [x] [ARTIFACT] DB migration 文件存在，更新 profile-anthropic thalamus provider 为 anthropic-api
  - File: `packages/brain/migrations/`
  - Check: `manual:node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations');const f=files.find(x=>x.includes('thalamus'));if(!f)process.exit(1);console.log('migration found:',f)"`
