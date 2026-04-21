# DoD — Harness v5 Sprint C-b: 老 sprint 归档 `sprints/archive/`

## ARTIFACT 条目

- [x] [ARTIFACT] `sprints/archive/` 目录存在且装有历史 sprint
  Test: manual:node -e "const fs=require('fs');if(!fs.statSync('sprints/archive').isDirectory())process.exit(1);const subs=fs.readdirSync('sprints/archive').filter(f=>fs.statSync('sprints/archive/'+f).isDirectory());if(subs.length<10)process.exit(2);console.log('archive 子目录数:',subs.length)"

- [x] [ARTIFACT] `sprints/archive/root-leftovers/` 装散落根目录 md
  Test: manual:node -e "const fs=require('fs');const leftovers=['ci-coverage-assessment.md','eval-round-1.md','sprint-contract.md','sprint-prd.md','sprint-report.md'];for(const f of leftovers){fs.accessSync('sprints/archive/root-leftovers/'+f)}"

- [x] [ARTIFACT] `sprints/` 根目录下只剩 archive/ 子目录
  Test: manual:node -e "const fs=require('fs');const entries=fs.readdirSync('sprints').filter(e=>e!=='.DS_Store');if(entries.length!==1)process.exit(1);if(entries[0]!=='archive')process.exit(2)"

- [x] [ARTIFACT] `.github/workflows/harness-v5-checks.yml` paths 排除 archive
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');if(!/!\s*sprints\/archive/.test(c))process.exit(1)"

- [x] [ARTIFACT] Learning 文件含根本原因 + 下次预防
  Test: manual:node -e "const fs=require('fs');const files=fs.readdirSync('docs/learnings').filter(f=>f.includes('harness-v5-archive-legacy'));if(files.length===0)process.exit(1);const c=fs.readFileSync('docs/learnings/'+files[0],'utf8');if(!c.includes('### 根本原因'))process.exit(2);if(!c.includes('### 下次预防'))process.exit(3)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] check-dod-purity 扫到 archive 下的老格式 DoD 不会误报（因 regex ^sprints/[^/]+/... 天然只匹配一级目录）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/scripts/devgate/check-dod-purity.cjs','utf8');if(!c.includes('contract-dod-ws'))process.exit(1);if(!/sprints.+\[\^\/\]/.test(c))process.exit(2);console.log('regex 用 [^/] 限一级子目录，天然排除 archive')"
