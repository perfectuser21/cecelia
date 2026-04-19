# DoD: CI 硬化第一批

- [x] [ARTIFACT] ci.yml PR size 硬失败逻辑存在（>1500 行 exit 1）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/TOTAL.*-gt 1500/.test(c)||!/超过 1500 行硬门槛/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] ci.yml 包含 dep-audit job + npm audit --audit-level=critical
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/dep-audit:/.test(c)||!/--audit-level=critical/.test(c))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] dep-audit 纳入 ci-passed needs 列表
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=c.match(/needs:\\s*\\[[^\\]]*\\]/);if(!m||!/dep-audit/.test(m[0]))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] dep-audit 在 ci-passed check 列表出现
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/check\\s+\"dep-audit\"/.test(c))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] 本地 npm audit --audit-level=critical 当前通过（0 critical）
  Test: manual:bash -lc "npm audit --audit-level=critical > /dev/null 2>&1 || { echo 'FAIL: 有 critical 漏洞'; exit 1; }; echo PASS"
