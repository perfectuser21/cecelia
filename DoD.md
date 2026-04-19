# DoD: cleanup-merged-artifacts regex 修复 + 根目录垃圾清理

- [x] [ARTIFACT] workflow 正则包含新命名三种前缀（DoD.cp- / PRD.cp- / TASK_CARD.cp-）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/cleanup-merged-artifacts.yml','utf8');if(!/DoD\\\\\\.cp-/.test(c)||!/PRD\\\\\\.cp-/.test(c)||!/TASK_CARD\\\\\\.cp-/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] workflow 正则保留旧命名向后兼容（.prd- / .task-）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/cleanup-merged-artifacts.yml','utf8');if(!/\\\\\\.prd-/.test(c)||!/\\\\\\.task-/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 根目录 cp- 系列遗留 md 全部清理
  Test: manual:node -e "const {execSync}=require('child_process');const out=execSync('git ls-files',{encoding:'utf8'});const n=(out.match(/^(DoD|PRD|TASK_CARD)\\.cp-.*\\.md$/gm)||[]).length;if(n!==0){console.error('残留',n,'个');process.exit(1)}console.log('PASS')"

- [x] [ARTIFACT] 活跃文件（DoD.md/PRD.md/README.md/DEFINITION.md）未被误删
  Test: manual:node -e "const fs=require('fs');for(const f of ['DoD.md','PRD.md','README.md','DEFINITION.md']){if(!fs.existsSync(f)){console.error(f,'丢失');process.exit(1)}}console.log('PASS')"

- [x] [BEHAVIOR] workflow 正则单元测试 9/9 通过
  Test: tests/workflows/cleanup-artifacts-regex.test.ts
