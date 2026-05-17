# Task: Alignment Table Generator — 升级对照表固化

**Task ID**: 693c255f-ca08-4c26-9c75-0dd8ddc72ff7
**Branch**: cp-0419131519-alignment-table-gen
**Version**: Engine 14.17.9 → 14.17.10

## DoD

- [x] [ARTIFACT] generate-alignment-table.sh 存在且可执行
  Test: manual:bash -c "test -x packages/engine/scripts/generate-alignment-table.sh"

- [x] [BEHAVIOR] 脚本成功生成对照表
  Test: manual:bash packages/engine/scripts/generate-alignment-table.sh

- [x] [ARTIFACT] docs/superpowers-alignment-table.md 存在
  Test: manual:bash -c "test -f docs/superpowers-alignment-table.md"

- [x] [BEHAVIOR] 对照表含 14 个 upstream skill 行
  Test: manual:node -e "const c=require('fs').readFileSync('docs/superpowers-alignment-table.md','utf8');const m=c.match(/^\| \d+ \|/gm)||[];if(m.length<14)process.exit(1)"

- [x] [BEHAVIOR] 对照表含 21 个文件级详情行
  Test: manual:node -e "const c=require('fs').readFileSync('docs/superpowers-alignment-table.md','utf8');const lines=c.split('## 文件级详情')[1];const m=lines.match(/^\| [a-z-]+ \| [\w.-]+\.md \|/gm)||[];if(m.length<21)process.exit(1)"

- [x] [BEHAVIOR] 对照表当前全绿（零 DRIFT）
  Test: manual:node -e "const c=require('fs').readFileSync('docs/superpowers-alignment-table.md','utf8');if(c.includes('❌ DRIFT')||c.includes('Drifted（需人工处理）: 1 个')||c.includes('Drifted（需人工处理）: 2 个'))process.exit(1)"

- [x] [BEHAVIOR] 脚本 --stdout 模式不写文件
  Test: manual:bash packages/engine/scripts/generate-alignment-table.sh --stdout

- [x] [BEHAVIOR] L1 alignment + hygiene gate 向后兼容
  Test: manual:node packages/engine/scripts/devgate/check-superpowers-alignment.cjs

- [x] [BEHAVIOR] 版本 6 处同步到 14.17.10
  Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const hv=fs.readFileSync('packages/engine/hooks/VERSION','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,hv,skill,reg].every(x=>x==='14.17.10'))process.exit(1)"

- [x] [ARTIFACT] feature-registry 14.17.10 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.10\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文件
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04191315-alignment-table-gen.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"
