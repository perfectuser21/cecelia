# DoD: Tier 2 PR-A — lint-test-quality 机器拦"假测试 stub"

- [x] [ARTIFACT] lint-test-quality.sh 存在 + 可执行 + 含 3 条硬规则
  Test: manual:node -e "const fs=require('fs');const p='.github/workflows/scripts/lint-test-quality.sh';fs.accessSync(p);if(!(fs.statSync(p).mode&0o111))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('Rule A')||!c.includes('Rule B')||!c.includes('Rule C'))process.exit(1)"

- [x] [BEHAVIOR] 自跑 smoke 4 case 全 pass（stub/empty/all-skip fail + good pass）
  Test: manual:bash .github/workflows/scripts/__tests__/lint-test-quality-cases.sh

- [x] [BEHAVIOR] ci.yml 含 lint-test-quality job + ci-passed needs 列含它
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('lint-test-quality:')||!c.match(/needs:.*lint-test-quality/))process.exit(1)"

- [x] [BEHAVIOR] lint 自跑 origin/main 不 false-fail（无新增 test → skip）
  Test: manual:bash .github/workflows/scripts/lint-test-quality.sh origin/main
