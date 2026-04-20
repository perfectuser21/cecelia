# DoD: 修 archive-learnings workflow 走 PR 流程

- [x] [ARTIFACT] workflow 最后一步改成开 PR（含 gh pr create + harness 标签）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/gh pr create/.test(c))process.exit(1);if(!/--label harness/.test(c))process.exit(2);console.log('PASS')"

- [x] [ARTIFACT] workflow 不再直推 main（删掉 git push 没有分支参数的写法）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');const lines=c.split('\\n');const bad=lines.filter(l=>l.trim()==='git push');if(bad.length>0){console.error('还有裸 git push:',bad);process.exit(1)}console.log('PASS')"

- [x] [ARTIFACT] 分支名符合 cp-* 规范
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/BRANCH=\"cp-archive-/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 用 GITHUB_TOKEN 做 gh 鉴权
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/GH_TOKEN:\\s*\\\$\\{\\{\\s*secrets\\.GITHUB_TOKEN\\s*\\}\\}/.test(c))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] 原有归档逻辑未动（仍用 git log --diff-filter=A + 30 days + YYYY-MM 分桶 + tar.gz）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/archive-learnings.yml','utf8');if(!/git log --follow --diff-filter=A --format=%at/.test(c))process.exit(1);if(!/30 days ago/.test(c))process.exit(2);if(!/\\+%Y-%m/.test(c))process.exit(3);if(!/tar -czf/.test(c))process.exit(4);console.log('PASS')"
