# DoD: PR-D — executor 真路径 smoke

- [x] [ARTIFACT] executor-pure-functions.sh 存在 + chmod +x + 5 case
  Test: manual:node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/executor-pure-functions.sh';fs.accessSync(p);if(!(fs.statSync(p).mode&0o111))process.exit(1);const c=fs.readFileSync(p,'utf8');for(const k of ['Case A','Case B','Case C','Case D','Case E']){if(!c.includes(k))process.exit(1)}"

- [x] [BEHAVIOR] 本地真跑 5 case 全 pass
  Test: manual:bash packages/brain/scripts/smoke/executor-pure-functions.sh

- [x] [BEHAVIOR] smoke container 自动检测（cecelia-brain-smoke / cecelia-node-brain）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/executor-pure-functions.sh','utf8');if(!c.includes('cecelia-brain-smoke')||!c.includes('cecelia-node-brain'))process.exit(1)"
