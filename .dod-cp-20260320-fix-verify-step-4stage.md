# DoD: verify-step.sh 4-Stage Pipeline 兼容性修复

- [x] check-dod-mapping.cjs 支持 --format-only 参数，跳过未勾选检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/devgate/check-dod-mapping.cjs','utf8');if(!c.includes('format-only'))process.exit(1)"
- [x] verify-step.sh Stage 1 Gate 1 使用 --format-only 模式
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/verify-step.sh','utf8');if(!c.includes('--format-only'))process.exit(1)"
- [x] [BEHAVIOR] --format-only 模式下未勾选的 DoD 不导致 exit 1
  Test: manual:node -e "const{execSync}=require('child_process');try{execSync('node packages/engine/scripts/devgate/check-dod-mapping.cjs --format-only',{encoding:'utf8'})}catch(e){process.exit(1)}"
- [x] Engine 版本 bump 到 13.7.0（5 个文件同步）
  Test: manual:node -e "const p=require('./packages/engine/package.json');if(p.version!=='13.7.0')process.exit(1)"
