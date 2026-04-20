# DoD: brain ESLint warning 基线从 244 降到 95

- [x] [ARTIFACT] ci.yml brain lint 基线更新为 95
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/packages\\/brain.*--max-warnings 95/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] ci.yml 注释日期更新为 2026-04-20
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/2026-04-20 测得 brain=95/.test(c))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] brain eslint --max-warnings 95 在 CI 真跑通（dogfood）
  Test: manual:bash -c "cd packages/brain && npx eslint src/ --max-warnings 95 > /tmp/lint.log 2>&1"
