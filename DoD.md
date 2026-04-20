# DoD: bump archive-learnings workflow (GHA cache refresh)

- [x] [ARTIFACT] archive-learnings.yml 头部含 v1.1 版本注释
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/v1\\.1 \\(2026-04-20\\)/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] workflow_dispatch 仍然存在
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/workflow_dispatch:/.test(c))process.exit(1);console.log('PASS')"
