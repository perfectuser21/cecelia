# DoD: fix(ci) — auto-merge 扩展到所有 cp-* PR

## Branch
cp-0526203448-ci-auto-merge-all-cp-prs

## Changes

- [x] [BEHAVIOR] auto-merge job 对 cp-* 分支 PR CI 绿即触发（不再限 harness label）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes(\"grep -qE '^cp-'\"))process.exit(1);console.log('ok')"

- [x] [BEHAVIOR] 非 cp-* 分支 PR 不触发 auto-merge
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('Not a cp-* branch, skipping auto-merge'))process.exit(1);console.log('ok')"

- [x] [ARTIFACT] auto-merge job 注释和 step name 已更新为"所有 cp-* 分支"
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('所有 cp-* 分支 PR，CI 通过后自动合并'))process.exit(1);console.log('ok')"
