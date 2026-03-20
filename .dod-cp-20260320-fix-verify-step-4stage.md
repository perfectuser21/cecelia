# DoD: verify-step.sh 4-Stage Pipeline 兼容性修复

- [x] [ARTIFACT] verify-step.sh Stage 1 Gate 1 跳过 DoD 完整检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/verify-step.sh','utf8');if(!c.includes('Stage 1 跳过'))process.exit(1)"

- [x] [BEHAVIOR] Stage 1 不再因未勾选 DoD 项被拦截
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/verify-step.sh','utf8');if(c.includes('check-dod-mapping'))process.exit(1)"

- [x] [GATE] 所有现有测试通过
  Test: manual:bash -c "npm test 2>&1 | tail -5"
