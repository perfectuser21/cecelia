# DoD: Tier 2 PR-B — dispatcher 真路径 smoke

- [x] [ARTIFACT] dispatcher-real-paths.sh 存在 + chmod +x + 含 3 case
  Test: manual:node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/dispatcher-real-paths.sh';fs.accessSync(p);if(!(fs.statSync(p).mode&0o111))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('[Case A]')||!c.includes('[Case B]')||!c.includes('[Case C]'))process.exit(1)"

- [x] [BEHAVIOR] 本地真跑 dispatcher-real-paths.sh PASSED=3 FAILED=0
  Test: manual:bash packages/brain/scripts/smoke/dispatcher-real-paths.sh

- [x] [BEHAVIOR] smoke 含 dedup 防冲突 SMOKE_RUN_ID + curl -m 10 timeout
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/dispatcher-real-paths.sh','utf8');if(!c.includes('SMOKE_RUN_ID')||!c.includes('curl -sS -m 10'))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 自动覆盖（无需改 ci.yml）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('packages/brain/scripts/smoke/*.sh'))process.exit(1)"
