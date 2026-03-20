# DoD: 删除 agent_seal 旧审查系统残留

- [x] [ARTIFACT] verify-step.sh 删除所有 Gate 2 agent_seal 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/verify-step.sh','utf8');if(c.includes('agent_seal'))process.exit(1)"

- [x] [ARTIFACT] stop-dev.sh 删除 agent_seal 完整性检查块
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(c.includes('AGENT_SEAL'))process.exit(1)"

- [x] [ARTIFACT] bash-guard.sh 删除 agent_seal 白名单
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/hooks/bash-guard.sh','utf8');if(c.includes('agent-seal'))process.exit(1)"

- [x] [BEHAVIOR] verify-step 测试全通过
  Test: manual:bash -c "cd packages/engine && npx vitest run tests/hooks/verify-step.test.ts 2>&1 | tail -3"

- [x] [GATE] Engine 版本 bump 到 13.7.6
  Test: manual:node -e "const p=require('./packages/engine/package.json');if(p.version!=='13.7.6')process.exit(1)"
