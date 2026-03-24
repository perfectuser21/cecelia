# DoD: 清理重复 check-manual-cmd-whitelist.cjs

- [x] [PRESERVE] `scripts/devgate/` 目录下已追踪的 7 个文件（check-activation.sh 等）仍然存在
  Test: manual:node -e "const fs=require('fs');['check-activation.sh','check-contract-drift.mjs','check-executor-agents.mjs','check-llm-agents.mjs','check-new-api-endpoints.mjs','check-okr-structure.mjs','check-skills-registry.mjs'].forEach(f=>{fs.accessSync('scripts/devgate/'+f)});console.log('OK: 已追踪文件均存在')"

- [x] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 不存在（已删除）
  Test: manual:node -e "const fs=require('fs');if(fs.existsSync('scripts/devgate/check-manual-cmd-whitelist.cjs'))process.exit(1);console.log('OK: 重复文件已不存在')"

- [x] [ARTIFACT] `packages/engine/scripts/devgate/check-manual-cmd-whitelist.cjs` 存在且可运行
  Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-manual-cmd-whitelist.cjs');console.log('OK')"
