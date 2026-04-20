# DoD: Phase 7.5 死 DoD sweep + CI 回归测试

- [x] [ARTIFACT] cleanup-merged-artifacts.yml regex 补齐 `.dod-` 前缀
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/cleanup-merged-artifacts.yml','utf8');if(!c.includes('\\\\.dod-|'))process.exit(1);if(!c.includes('Phase 7.5'))process.exit(2)"

- [x] [ARTIFACT] 历史 per-PR 残留文件已删除（仓库根不再有 .task-cp-* / .dod-cp-* / DoD.cp-* / PRD.cp-*）
  Test: manual:node -e "const fs=require('fs');const bad=fs.readdirSync('.').filter(f=>/^(\\.task-cp-|\\.dod-cp-|\\.prd-cp-|DoD\\.cp-|PRD\\.cp-|TASK_CARD\\.cp-)/.test(f));if(bad.length>0){console.error('残留:',bad);process.exit(1)}"

- [x] [ARTIFACT] 根目录 stale 文件已清理（.dod.md / .prd.md / .prd.md.old / TASK.md 不存在）
  Test: manual:node -e "const fs=require('fs');['.dod.md','.prd.md','.prd.md.old','TASK.md'].forEach(f=>{if(fs.existsSync(f)){console.error('stale still:',f);process.exit(1)}})"

- [x] [BEHAVIOR] check-manual-cmd-whitelist.cjs 回归测试覆盖死 DoD 模式
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/dod/dod-manual-commands.test.ts');const c=require('fs').readFileSync('packages/engine/tests/dod/dod-manual-commands.test.ts','utf8');['scanManualViolations','ALLOWED_COMMANDS','extractManualCommand'].forEach(k=>{if(!c.includes(k))process.exit(1)})"


- [x] [ARTIFACT] Engine 版本 7 处同步 18.3.3
  Test: manual:node -e "const fs=require('fs');['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION'].forEach(f=>{const v=fs.readFileSync(f,'utf8').trim();if(v!=='18.3.3'){console.error(f+' != 18.3.3 (got '+v+')');process.exit(1)}});const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8'));if(pkg.version!=='18.3.3')process.exit(2)"

- [x] [ARTIFACT] feature-registry.yml 追加 18.3.3 changelog
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('18.3.3'))process.exit(1);if(!c.includes('Phase 7.5'))process.exit(2)"

- [x] [ARTIFACT] Learning 文件记录根因 + 下次预防
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0420161725-cp-04201617-phase75-dod-sweep.md','utf8');if(!c.includes('根本原因'))process.exit(1);if(!c.includes('下次预防'))process.exit(2)"
