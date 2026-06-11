# Contract DoD — Contract Gate `cheat/or-true` 不误伤负向测试（预期失败）惯用法

**范围**: 细化 `cheat/or-true` 规则 + 新增 `isNegativeFailAssertion` 识别器 + 新增 `or-true-negative` fixture + 单测；顺手改两条修复建议文案（or-true / file-existence-only）。不含改其它规则、改 GAN 轮数策略、改路由、UI。复用 #3348/#3348 gate 库。
**大小**: S

## 背景

`#3348` 的 `cheat/or-true` 把所有 `|| true` 一律判作"吞错"。生产 run d8acba51（ci-defense 合同）实证：标准负向测试 `cmd && { echo "FAIL"; exit 1; } || true`（语义="cmd 应失败；若成功则主动 FAIL"）被误伤，按建议"删 || true"会破坏负向测试（set -e 下预期失败直接杀脚本）→ GAN 振荡到 round 5。

## 成功标准

- 负向测试惯用法 `cmd && { ...; exit N; } || true`（N≠0）不再命中 `cheat/or-true`。
- 既有"真吞错"样例（`assert || true`、`grep xxx || true` 等无前置 `&& {…exit N}` 结构）仍命中（不弱化既有 fixtures 回归）。
- contract-gate 既有全部 fixtures/单测一个不松动。

## BEHAVIOR 条目（被测 = 真实 packages/brain/src/lib/contract-gate.js；行为由 vitest 在 CI 执行）

- [x] [BEHAVIOR] 负向测试 `cmd && { echo FAIL; exit 1; } || true` 不命中 cheat/or-true，而真吞错 `assert || true` 仍命中（CI 直跑 node 加载真实模块断言）
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const a=m.evaluateContractText('  Test: x && { echo FAIL; exit 1; } || true').hits.map(h=>h.ruleId);if(a.includes('cheat/or-true'))process.exit(1);const b=m.evaluateContractText('  Test: assert || true').hits.map(h=>h.ruleId);if(!b.includes('cheat/or-true'))process.exit(1);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] isNegativeFailAssertion 已导出且精确：`exit 1`→true、裸 `assert || true`→false、`exit 0`→false（非负向断言不放行）
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{if(typeof m.isNegativeFailAssertion!=='function')process.exit(1);if(m.isNegativeFailAssertion('cmd && { echo FAIL; exit 1; } || true')!==true)process.exit(1);if(m.isNegativeFailAssertion('assert || true')!==false)process.exit(1);if(m.isNegativeFailAssertion('cmd && { echo x; exit 0; } || true')!==false)process.exit(1);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] or-true 修复建议含"负向测试改写/gate-allow 豁免"提示，file-existence-only 建议含 `grep -q` 升级示例
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/lib/contract-gate.js','utf8');if(!/负向测试（预期失败）/.test(c)||!/gate-allow 豁免留痕/.test(c)||!/grep -q '<关键内容>' file/.test(c))process.exit(1)"
