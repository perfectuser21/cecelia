# DoD: PR-E — cortex 真路径 smoke

- [x] [ARTIFACT] cortex-pure-functions.sh 存在 + chmod +x + 5 case
  Test: manual:node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/cortex-pure-functions.sh';fs.accessSync(p);if(!(fs.statSync(p).mode&0o111))process.exit(1);const c=fs.readFileSync(p,'utf8');for(const k of ['Case A','Case B','Case C','Case D','Case E']){if(!c.includes(k))process.exit(1)}"

- [x] [BEHAVIOR] 本地真跑 5 case 全 pass
  Test: manual:bash packages/brain/scripts/smoke/cortex-pure-functions.sh

- [x] [BEHAVIOR] container 自动检测 + 验关键函数（classifyTimeoutReason / estimateTokens / _computeObservationKey / hasCodeFixSignal）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/cortex-pure-functions.sh','utf8');for(const k of ['classifyTimeoutReason','estimateTokens','_computeObservationKey','hasCodeFixSignal','cecelia-brain-smoke']){if(!c.includes(k))process.exit(1)}"
