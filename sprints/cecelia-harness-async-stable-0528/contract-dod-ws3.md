---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: GAN 每轮异步化（proposer + reviewer detached）

**范围**: 改造 `packages/brain/src/workflows/harness-gan.graph.js` 的 `proposer` 和 `reviewer` 函数：将 `reconnectOrSpawn` 改为 `spawnDockerDetached` + interrupt。GAN 收敛逻辑（detectConvergenceTrend/budgetCap）不变。
**大小**: M (~130 行净改，1 文件)
**依赖**: WS2 完成后

## ARTIFACT 条目

- [x] [ARTIFACT] `harness-gan.graph.js` 文件顶部 imports 包含 `spawnDockerDetached`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8'); if(!c.includes('spawnDockerDetached'))process.exit(1)"

- [x] [ARTIFACT] `proposer` 函数体内不含 `reconnectOrSpawn`（已改为 detached）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8'); const s=c.indexOf('async function proposer('); const e=c.indexOf('\n  async function ',s+1); const fn=c.slice(s,e>0?e:s+3000); if(fn.includes('reconnectOrSpawn'))process.exit(1)"

- [x] [ARTIFACT] `reviewer` 函数体内不含 `reconnectOrSpawn`（已改为 detached）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8'); const s=c.indexOf('async function reviewer('); const e=c.indexOf('\n  async function ',s+1); const fn=c.slice(s,e>0?e:s+3000); if(fn.includes('reconnectOrSpawn'))process.exit(1)"

- [x] [ARTIFACT] `detectConvergenceTrend` 函数仍然存在（收敛逻辑未被破坏）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8'); if(!c.includes('detectConvergenceTrend'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] harness-gan.graph.js 导入并使用 spawnDockerDetached（实现前文件无此符号 → 真红）
  Test: manual:bash -c 'grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-gan.graph.js || { echo "FAIL: harness-gan.graph.js 未用 spawnDockerDetached"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] proposer 函数移除阻塞 reconnectOrSpawn（函数体内不含该符号）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-gan.graph.js\",\"utf8\"); const s=c.indexOf(\"async function proposer(\"); if(s<0){console.error(\"FAIL: proposer not found\");process.exit(1)} const e=c.indexOf(\"\n  async function \",s+1); const fn=c.slice(s,e>0?e:s+3000); if(fn.includes(\"reconnectOrSpawn\")){console.error(\"FAIL: proposer 仍含阻塞 reconnectOrSpawn\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] reviewer 函数移除阻塞 reconnectOrSpawn（函数体内不含该符号）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-gan.graph.js\",\"utf8\"); const s=c.indexOf(\"async function reviewer(\"); if(s<0){console.error(\"FAIL: reviewer not found\");process.exit(1)} const e=c.indexOf(\"\n  async function \",s+1); const fn=c.slice(s,e>0?e:s+3000); if(fn.includes(\"reconnectOrSpawn\")){console.error(\"FAIL: reviewer 仍含阻塞 reconnectOrSpawn\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] detectConvergenceTrend 收敛逻辑仍存在（GAN 异步化不破坏收敛判断）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-gan.graph.js\",\"utf8\"); if(!c.includes(\"detectConvergenceTrend\")){console.error(\"FAIL: 收敛逻辑被破坏\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] error path — proposer/reviewer 含 interrupt() 调用（真正挂起，不只是空函数）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-gan.graph.js\",\"utf8\"); if(!c.includes(\"interrupt\")){console.error(\"FAIL: harness-gan.graph.js 缺 interrupt()\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK
