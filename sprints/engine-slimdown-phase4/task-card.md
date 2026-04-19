# Task: Phase 4 — Engine 瘦身到真正的自动化适配层

**Task ID**: d27a6079-c9a3-4a86-951c-1a775e21056e
**Branch**: cp-0419164625-engine-slimdown-phase4
**Version**: Engine 14.17.10 → 14.17.11

## DoD

- [x] [BEHAVIOR] packages/engine/skills/dev/prompts/ 已删除
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/skills/dev/prompts');process.exit(1)}catch{}"

- [x] [BEHAVIOR] alignment.yaml 已删除
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/contracts/superpowers-alignment.yaml');process.exit(1)}catch{}"

- [x] [BEHAVIOR] check-superpowers-alignment.cjs 已删除
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/scripts/devgate/check-superpowers-alignment.cjs');process.exit(1)}catch{}"

- [x] [BEHAVIOR] sync-from-upstream.sh 已删除
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/scripts/sync-from-upstream.sh');process.exit(1)}catch{}"

- [x] [BEHAVIOR] generate-alignment-table.sh 已删除
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/scripts/generate-alignment-table.sh');process.exit(1)}catch{}"

- [x] [BEHAVIOR] steps/01-spec.md 和 02-code.md 已删除
  Test: manual:node -e "const fs=require('fs');['packages/engine/skills/dev/steps/01-spec.md','packages/engine/skills/dev/steps/02-code.md'].forEach(f=>{try{fs.accessSync(f);process.exit(1)}catch{}})"

- [x] [BEHAVIOR] SKILL.md 说明调 /superpowers:* 接力
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!c.includes('/superpowers:brainstorming')||!c.includes('runtime 会动态加载'))process.exit(1)"

- [x] [BEHAVIOR] Engine 独有 steps 保留
  Test: manual:node -e "const fs=require('fs');['00-worktree-auto.md','00.5-enrich.md','00.7-decision-query.md','03-integrate.md','04-ship.md','autonomous-research-proxy.md'].forEach(f=>fs.accessSync('packages/engine/skills/dev/steps/'+f))"

- [x] [BEHAVIOR] check-engine-hygiene.cjs Check 2 已反转为 no-dangling-prompt-ref
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/devgate/check-engine-hygiene.cjs','utf8');if(!c.includes('no-dangling-prompt-ref')||c.includes('checkNoExternalSuperpowersRef'))process.exit(1)"

- [x] [BEHAVIOR] CI 已删 Superpowers Alignment Gate
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(c.includes('Superpowers Alignment Gate')||c.includes('check-superpowers-alignment'))process.exit(1)"

- [x] [BEHAVIOR] Engine Hygiene Gate 仍 pass
  Test: manual:node packages/engine/scripts/devgate/check-engine-hygiene.cjs

- [x] [BEHAVIOR] 6 处版本同步 14.17.11
  Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const hv=fs.readFileSync('packages/engine/hooks/VERSION','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,hv,skill,reg].every(x=>x==='14.17.11'))process.exit(1)"

- [x] [ARTIFACT] feature-registry 14.17.11 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.11\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文件含根本原因 + 下次预防
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04191646-engine-slimdown-phase4.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"
