# Contract DoD — Contract Gate 逻辑行归一 + 状态码 oracle 放行（修 GAN 误报盲区）

**范围**: 新增反斜杠续行→逻辑语句归一预处理（惠及所有行级规则）+ 细化 `weak-oracle/curl-no-jq`（状态码 oracle 放行）+ 新增 `isStatusCodeOracle` 识别器 + 新增 `multiline-curl-jq`/`status-code-oracle`/`multiline-negative` 三个生产实证 fixture + 单测 + formatGateReport 报告头部加 gate-allow 逃生口通用提示。不含改其它规则、改 GAN 轮数策略、改路由、UI。复用 #3348/#3350/#3351 gate 库。
**大小**: S

## 背景

`#3348` 的行级规则按【物理行】扫描。生产 run c0e2546b（notion-mapping-fix 合同）实证两个盲区，致合同实际正确却被反复打回，GAN 烧 3+ 轮无法收敛：

- **盲区 A — 反斜杠续行多行 pipeline**：`curl ... \` 续行后 `| jq -e ...` 属同一逻辑语句，但按物理行扫描只看见首行 curl、看不见续行的 `jq -e` → 误报 `weak-oracle/curl-no-jq`（76/106/168 行）。
- **盲区 B — 状态码 oracle**：`HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ...)` 刻意丢弃 body 只取状态码，后续 `[ "$HTTP_CODE" = "200" ]` 即合法 oracle，jq 不适用 → 误报（234 行）。

## 成功标准

- 反斜杠续行的多行 pipeline 归一为单逻辑语句后，`curl ... \ | jq -e` 不再命中 `weak-oracle/curl-no-jq`（盲区 A 消除）。
- `curl -w %{http_code}` 状态码 oracle（引号变体兼容）不再命中 `weak-oracle/curl-no-jq`（盲区 B 消除）；仍无任何 oracle 的裸 curl 照抓。
- 归一不引入绕过面：把作弊词（`test -f`、`MOCK_*`、`|| true`）用续行拆开仍被拼回并命中。
- `#3351` 负向测试豁免在多行（续行）场景仍生效（`cmd \ && {…exit N} \ || true` 不命中 or-true）。
- contract-gate 既有全部 fixtures/单测（含 #3351 的 7 个）一个不松动；wiring/converge 测试绿。
- formatGateReport 报告头部含 `gate-allow` 逃生口通用提示。

## BEHAVIOR 条目（被测 = 真实 packages/brain/src/lib/contract-gate.js；行为由 CI 直跑 node 加载真实模块断言 + vitest 套件）

- [x] [BEHAVIOR] 盲区 A：续行 curl \ | jq -e 归一后不命中 curl-no-jq；续行后无 oracle 的裸 curl 仍命中
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const NL=String.fromCharCode(10);const ok=m.evaluateContractText('Test: curl -sf url \\\\'+NL+'  | jq -e .url');if(ok.hits.map(h=>h.ruleId).includes('weak-oracle/curl-no-jq'))process.exit(2);const bad=m.evaluateContractText('Test: curl -sf url \\\\'+NL+'  -H x');if(!bad.hits.map(h=>h.ruleId).includes('weak-oracle/curl-no-jq'))process.exit(3);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 盲区 B：isStatusCodeOracle 已导出且精确，状态码 oracle 单行不命中 curl-no-jq
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{if(typeof m.isStatusCodeOracle!=='function')process.exit(2);if(m.isStatusCodeOracle('curl -o /dev/null -w x%{http_code}x url')!==true)process.exit(3);if(m.isStatusCodeOracle('curl -s http://localhost/api')!==false)process.exit(4);const r=m.evaluateContractText('Test: CODE=$(curl -s -o /dev/null -w x%{http_code}x url); [ a = b ]');if(r.hits.map(h=>h.ruleId).includes('weak-oracle/curl-no-jq'))process.exit(5);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 归一不绕过 + #3351 多行负向豁免仍生效：续行拆开 MOCK_* 仍命中，多行负向测试不命中 or-true
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const NL=String.fromCharCode(10);const mock=m.evaluateContractText('Test: MOCK_X=1 \\\\'+NL+'  node a.js');if(!mock.hits.map(h=>h.ruleId).includes('cheat/mock-env'))process.exit(2);const neg=m.evaluateContractText('Test: node x.mjs \\\\'+NL+'  && { echo FAIL; exit 1; } \\\\'+NL+'  || true');if(neg.hits.map(h=>h.ruleId).includes('cheat/or-true'))process.exit(3);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] formatGateReport 有命中时报告头部含 gate-allow 逃生口提示，干净时为空串
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const r=m.evaluateContractText('Test: MOCK_X=1 node a.js');const rep=m.formatGateReport(r,'x.md');if(!/gate-allow:/.test(rep))process.exit(2);if(!/cheat.mock-env/.test(rep))process.exit(3);const clean=m.formatGateReport(m.evaluateContractText('Test: curl -s url | jq -e .ok'),'x.md');console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"
