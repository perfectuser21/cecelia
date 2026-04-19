# DoD: learnings 月度归档 workflow

- [x] [ARTIFACT] workflow 文件存在
  Test: manual:node -e "if(!require('fs').existsSync('.github/workflows/archive-learnings.yml'))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 含 monthly cron（每月 1 号 04:00 UTC）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/cron:\\s*['\"]0 4 1 \\* \\*['\"]/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 支持 workflow_dispatch 手动触发
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/workflow_dispatch:/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 用 git log --diff-filter=A 拿首次入库时间（不用 mtime）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/git log --follow --diff-filter=A --format=%at/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 30 天前的文件才归档（cutoff 逻辑）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/30 days ago/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 按 YYYY-MM 分桶、tar.gz、git rm 原文件
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/\\+%Y-%m/.test(c))process.exit(1);if(!/tar -czf/.test(c))process.exit(2);if(!/git rm/.test(c))process.exit(3);console.log('PASS')"

- [x] [ARTIFACT] permissions contents: write（commit 推 main 需要）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/permissions:[\\s\\S]*?contents:\\s*write/.test(c))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] workflow 单元测试 8/8 通过
  Test: tests/workflows/archive-learnings.test.ts
