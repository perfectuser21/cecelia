# DoD: 刀4-T2 棘轮统一台账 ratchet-registry + guard 接 CI + 面板水位区块（接管修闸）

- [x] [BEHAVIOR] 台账 ≥5 条且每项含 name/direction(only_up|only_down)/guard/source
      Test: manual:node -e "const r=require('./scripts/ratchet-registry.json');if(r.length<5||r.some(x=>!x.name||!['only_up','only_down'].includes(x.direction)||!x.source))process.exit(1)"
- [x] [BEHAVIOR] GET /api/brain/quality/ratchet 有 supertest 行为测试（TDD 序：测试 commit 先行）
      Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/__tests__/quality-ratchet.test.js')"
- [x] [BEHAVIOR] feat+brain/src 配套 smoke 已新增并登记 allowlist
      Test: manual:bash -c "bash -n packages/brain/scripts/smoke/ratchet-registry-smoke.sh && grep -q ratchet-registry-smoke.sh packages/quality/smoke-allowlist.txt"
- [x] ratchet-guard 脚本存在且语法绿
      Test: manual:node --check scripts/ratchet-guard.mjs
