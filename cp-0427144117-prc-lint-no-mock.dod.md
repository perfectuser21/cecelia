# DoD: PR-C — lint-no-mock-only-test

- [x] [ARTIFACT] lint-no-mock-only-test.sh 存在 + chmod +x + HARD FAIL 规则
  Test: manual:node -e "const fs=require('fs');const p='.github/workflows/scripts/lint-no-mock-only-test.sh';fs.accessSync(p);if(!(fs.statSync(p).mode&0o111))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('HEAVY_MOCK_THRESHOLD')||!c.includes('PR_HAS_SMOKE'))process.exit(1)"

- [x] [BEHAVIOR] 自跑 smoke 4 case 全 pass
  Test: manual:bash .github/workflows/scripts/__tests__/lint-no-mock-only-test-cases.sh

- [x] [BEHAVIOR] ci.yml 含 lint-no-mock-only-test job + ci-passed needs
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('lint-no-mock-only-test:')||!c.match(/needs:.*lint-no-mock-only-test/))process.exit(1)"

- [x] [BEHAVIOR] lint 自跑 origin/main 不 false-fail
  Test: manual:bash .github/workflows/scripts/lint-no-mock-only-test.sh origin/main
