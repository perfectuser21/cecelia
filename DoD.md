# DoD: CI 硬化第三批 — ESLint --max-warnings 冻结基线

- [x] [ARTIFACT] brain lint 加 --max-warnings 244
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/packages\\/brain.*eslint.*--max-warnings 244/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] apps/api lint 加 --max-warnings 18
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/apps\\/api.*eslint.*--max-warnings 18/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 注释说明"只允许下调"的运维规则
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/只允许下调|不允许上调/.test(c))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] brain eslint --max-warnings 244 在 CI 真跑通（dogfood，dod-behavior-dynamic job 里已装 brain deps）
  Test: manual:bash -c "cd packages/brain && npx eslint src/ --max-warnings 244 > /tmp/lint-brain.log 2>&1"
