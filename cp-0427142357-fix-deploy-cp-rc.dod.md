# DoD: Hotfix — brain-deploy.sh cp identical 中止 Phase 9-11

- [x] [ARTIFACT] brain-deploy.sh 两处 cp 都跟 `|| true`
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');const lines=c.split('\n').filter(l=>/^[ \t]+cp /.test(l));if(lines.length<2)process.exit(1);for(const l of lines){if(!l.includes('|| true'))process.exit(1)}"

- [x] [BEHAVIOR] simulated cp identical + || true 不中止 set -e 脚本
  Test: manual:bash -c "set -euo pipefail; touch /tmp/cp-test-dod; cp /tmp/cp-test-dod /tmp/cp-test-dod 2>&1 || true; echo OK"

- [x] [ARTIFACT] script syntax 合法
  Test: manual:bash -n scripts/brain-deploy.sh
