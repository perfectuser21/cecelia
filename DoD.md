# DoD — cleanup.sh gone-branch grep fix + devloop-check stdout 隔离

task_id: cp-05042015-cleanup-gone-grep-fix

## 验收条目

- [x] [ARTIFACT] cleanup.sh step 9.5 grep 管道带 `|| true`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/cleanup.sh','utf8'); if(!c.includes('grep \\': gone]\\' | awk \\'{print \$1}\\' || true')) process.exit(1)"

- [x] [BEHAVIOR] verify_dev_complete 调用 cleanup.sh 时 stdout 重定向到 /dev/null
  Test: manual:node -e "const s=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8'); if(!s.includes('>/dev/null 2>/dev/null')) process.exit(1)"
