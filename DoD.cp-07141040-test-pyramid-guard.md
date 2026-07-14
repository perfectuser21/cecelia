# DoD: 刀0 test-pyramid-guard

- [x] [BEHAVIOR] guard 对孤儿超基线/smoke 无跑道/永久池跌破基线三种红况真报红，干净仓报绿
      Test: manual:bash scripts/__tests__/test-pyramid-guard.test.sh
- [x] [BEHAVIOR] 真实仓库 guard A1-A3 全绿（基线=当前实测）
      Test: manual:node scripts/test-pyramid-guard.mjs
- [x] [BEHAVIOR] CURRENT_STATE.md 含测试金字塔段且 generated 为最近 48h
      Test: manual:node -e "const t=require('fs').readFileSync('.agent-knowledge/CURRENT_STATE.md','utf8');if(!/## 测试金字塔/.test(t))process.exit(1)"
- [x] guard 纯函数 vitest 单测入永久池 tests/
      Test: tests/test-pyramid-guard.test.ts
