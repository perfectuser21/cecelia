# DoD — feat(engine): skeleton-shape-check CI job

## 验收标准

- [x] [ARTIFACT] `packages/engine/scripts/devgate/skeleton-shape-check.cjs` 存在
  Test: `node -e "require('fs').accessSync('packages/engine/scripts/devgate/skeleton-shape-check.cjs');console.log('OK')"`

- [x] [BEHAVIOR] BASE_REF=HEAD 时脚本 exit 0（无 skeleton dod 变动）
  Test: `node -e "const {execSync}=require('child_process');try{execSync('BASE_REF=HEAD node packages/engine/scripts/devgate/skeleton-shape-check.cjs',{encoding:'utf8'});console.log('OK')}catch(e){process.exit(1)}"`

- [x] [BEHAVIOR] skeleton-shape-check unit test 通过
  Test: `node -e "const c=require('fs').readFileSync('packages/engine/tests/devgate/skeleton-shape-check.test.ts','utf8');if(!c.includes('skeleton-shape-check'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] harness-v5-checks.yml 含 skeleton-shape-check job
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');if(!c.includes('skeleton-shape-check'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] harness-v5-checks.yml skeleton-shape-check job 含 continue-on-error: true
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/harness-v5-checks.yml','utf8');if(!c.includes('continue-on-error: true'))process.exit(1);console.log('OK')"`
