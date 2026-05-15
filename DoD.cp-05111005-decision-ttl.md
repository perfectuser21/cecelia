# DoD: consciousness-loop guidance TTL

## Artifacts

- [x] [ARTIFACT] `packages/brain/src/guidance.js` 新增 DECISION_TTL_MIN 短路 TTL 逻辑
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/guidance.js','utf8');if(!c.includes('DECISION_TTL_MIN'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/__tests__/decision-ttl.test.js` 新增 4 个 TDD 测试
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/decision-ttl.test.js','utf8');if(!c.includes('decision_id'))process.exit(1)"`

## Behaviors

- [x] [BEHAVIOR] C1a: decision created 5 min ago — getGuidance 返回 value（新鲜）
  Test: bash -c 'npx vitest run packages/brain/src/__tests__/decision-ttl.test.js --reporter=verbose 2>&1'

- [x] [BEHAVIOR] C1b: decision created 30 min ago — getGuidance 返回 null（TTL=15 超时）
  Test: bash -c 'npx vitest run packages/brain/src/__tests__/decision-ttl.test.js --reporter=verbose 2>&1'

- [x] [BEHAVIOR] C1c: DECISION_TTL_MIN=60 env override — 30 min 的 decision 仍有效
  Test: bash -c 'npx vitest run packages/brain/src/__tests__/decision-ttl.test.js --reporter=verbose 2>&1'

- [x] [BEHAVIOR] C1d: 非 decision value（无 decision_id）不受 TTL 限制
  Test: bash -c 'npx vitest run packages/brain/src/__tests__/decision-ttl.test.js --reporter=verbose 2>&1'
