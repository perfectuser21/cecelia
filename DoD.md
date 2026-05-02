# DoD: fix(brain) — Bark 通知 + 熔断器阈值调整

- [x] **[ARTIFACT]** notifier.js 新增 sendBark 函数，sendRateLimited 同时调用
  - Test: `node -e "require('fs').accessSync('packages/brain/src/notifier.js')"`
- [x] **[BEHAVIOR]** BARK_TOKEN 配置后 notifyCircuitOpen 调用 Bark API
  - Test: `tests/src/__tests__/notifier.test.js`
- [x] **[BEHAVIOR]** FAILURE_THRESHOLD = 8
  - Test: `tests/src/__tests__/circuit-breaker.test.js`
- [x] **[ARTIFACT]** packages/brain/.env 含 BARK_TOKEN
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/.env','utf8');if(!c.includes('BARK_TOKEN'))process.exit(1)"`
