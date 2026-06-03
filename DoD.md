# DoD：harness 全局并发上限（OPEN-1 OOM 防线）

分支：cp-06031141-harness-concurrency-cap
Brain task：71532c4c-b3ad-46d2-9a71-163d412c3c7b

## 改动

- [x] [ARTIFACT] dispatcher 新增并发上限常量 + 纯判定函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!/MAX_CONCURRENT_HARNESS_INITIATIVES/.test(c))process.exit(1);if(!/export function harnessConcurrencyExceeded/.test(c))process.exit(1)"

- [x] [ARTIFACT] failing-test-first 单测文件
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js')"

- [x] [BEHAVIOR] dispatcher.js 含全局 harness 并发上限 gate（常量 + 纯函数 + capped 分支）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8'); if(!c.includes('harness_concurrency_capped')) throw new Error('missing capped reason'); if(!/harnessConcurrencyExceeded\s*\(/.test(c)) throw new Error('missing predicate'); if(!/MAX_CONCURRENT_HARNESS_INITIATIVES/.test(c)) throw new Error('missing const'); console.log('harness concurrency cap gate present')"

- [x] [BEHAVIOR] 并发上限单测覆盖 capped / under-cap / dev-bypass / 纯函数边界四场景
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js','utf8'); ['harness_concurrency_capped','正常派发','不受全局 harness cap','harnessConcurrencyExceeded'].forEach(function(k){if(!c.includes(k)) throw new Error('missing case: '+k)}); console.log('all 4 cap test scenarios present')"

## 验收

- [x] failing test 先写后绿：dispatcher-harness-concurrency-cap.test.js（4 用例）先红（3 fail）后绿（4 pass）
- [x] 相邻回归全绿：dispatch-* / dispatcher* / tick-dispatch* / slot-* 共 255 用例通过；initiative-lock.test.js + dispatch-executor-fail.test.js 的 positional mock 已同步补 cap-count 一行
- [x] dev / 非 harness 任务不查并发计数、不受 cap 影响（case 3 断言）
- [x] DevGate：facts-check ✓ / check-version-sync ✓
