# DoD — Harness callback 幂等去重（修 GAN proposer 并发重 spawn）

**范围**: harness-callback.js 加 per-containerId 幂等 claim，重复回调直接 ack 不重入 resume。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] harness-callback.js 有进程内 claim 表（_claimedCallbacks）+ 测试 reset hook
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness-callback.js','utf8');if(!c.includes('_claimedCallbacks')||!c.includes('_resetCallbackDedupeForTests'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 重复回调短路返回 deduped，不再 invoke
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness-callback.js','utf8');if(!c.includes('deduped: true'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 去重回归测试文件存在
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness-callback-dedupe.test.js','utf8');if(!c.includes('只 resume 一次'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 去重回归测试覆盖 4 场景：重试只 resume 一次 / 并发只 resume 一次 / 不同 containerId 各自 resume / 404 释放 claim（brain-unit CI --changed 实跑，因测试 import harness-callback.js）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness-callback-dedupe.test.js','utf8');['重试两次','5 次重试','并发到达','不同 containerId','404','toHaveBeenCalledTimes(1)','toHaveBeenCalledTimes(2)'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('OK')"
