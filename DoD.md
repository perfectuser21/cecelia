# Contract DoD — Contract Gate 规则进化 R3（capture-then-assert 跨语句盲区 + db 时间窗按断言意图分型）

**范围**: 细化 `weak-oracle/curl-no-jq`（新增第三类放行：capture-then-assert 跨语句 oracle，新增 `hasCaptureThenAssert` 识别器，evaluate 循环传 ctx 给 detect）+ 重写 `domain/db-no-time-window`（抽出 `isAggregateDbProbeWithoutWindow`，按断言意图分型：聚合/无主键等值存在性探测才命中，定点读/写语句放行）+ 新增 `capture-then-assert`/`db-point-read`/`capture-no-assert` 三个生产实证 fixture + 单测。不含改其它规则、改 GAN 轮数策略、改路由、UI。复用 #3348/#3350/#3351/#3353 gate 库。
**大小**: S

## 背景

`#3353` 把行级规则升级为逻辑语句归一后，生产 run fa2b3e21（report-scriptize 合同）实证两个新钝点，致正确合同被反复打回、两条 GAN 烧轮次：

- **钝点 A — curl capture-then-assert 跨语句盲区**：`RESP=$(curl -sf ...) || { echo FAIL; exit 1; }` 捕获响应（本语句只做失败传播），下一条逻辑语句 `echo "$RESP" | jq -e '.status==...'` 才做值校验。curl-no-jq 只查 curl 所在单语句 → 误报。
- **钝点 B — db-no-time-window 误伤非聚合语句**：`STATUS=$(psql ... "SELECT status FROM journey_features WHERE id='$ID'")`（主键定点读）与 `INSERT ... RETURNING id`（写语句）都被要求加时间窗。时间窗本意是防"拿历史冒充本轮产出"，只应作用于聚合/无主键等值的存在性探测。

## 成功标准

- `RESP=$(curl ...)` 捕获后【K=5 条逻辑语句内】对【同名】$RESP 施加 jq -e / grep -q / [ 比较 / case 值断言 → 不再命中 `weak-oracle/curl-no-jq`（钝点 A 消除）。
- 变量名精确匹配：捕获 RESP 却断言无关 $OTHER、或 K 窗外才断言、或裸 `RESP=$(curl)` 后无断言 → 仍命中（不放水）。
- `domain/db-no-time-window` 只命中聚合（count/sum/avg/min/max）或无主键等值约束的存在性探测 SELECT；主键等值定点读（WHERE id/uuid/*_id 等值）、INSERT/UPDATE/DELETE 写语句 → 放行（钝点 B 消除）。
- 真 count 无时间窗（既有 db-no-window fixture）仍命中（不放水）。
- contract-gate 既有全部 fixtures/单测一个不松动；wiring/converge 测试绿。

## BEHAVIOR 条目（被测 = 真实 packages/brain/src/lib/contract-gate.js；CI eval node 加载真实模块断言 + vitest 套件）

- [x] [BEHAVIOR] 钝点 A：capture-then-assert fixture 放行、capture-no-assert 反例仍命中
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(async m=>{const ok=await m.runContractGate('./packages/brain/src/lib/__tests__/fixtures/contract-gate/capture-then-assert');if(ok.hits.map(h=>h.ruleId).includes('weak-oracle/curl-no-jq'))process.exit(2);if(!ok.ok)process.exit(3);const bad=await m.runContractGate('./packages/brain/src/lib/__tests__/fixtures/contract-gate/capture-no-assert');if(!bad.hits.map(h=>h.ruleId).includes('weak-oracle/curl-no-jq'))process.exit(4);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 钝点 A 精确性：hasCaptureThenAssert 导出；同名断言放行、无关变量不放行
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{if(typeof m.hasCaptureThenAssert!=='function')process.exit(2);const D=String.fromCharCode(36);const Q=String.fromCharCode(34);const cap='RESP='+D+'(curl -sf url)';const ll=[{content:cap},{content:'echo '+Q+D+'RESP'+Q+' | jq -e .ok'}];if(m.hasCaptureThenAssert(cap,{logicalLines:ll,index:0})!==true)process.exit(3);const oth=[{content:cap},{content:'echo '+Q+D+'OTHER'+Q+' | jq -e .ok'}];if(m.hasCaptureThenAssert(cap,{logicalLines:oth,index:0})!==false)process.exit(4);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 钝点 B：db-point-read fixture 放行、db-no-window 真 count 仍命中
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(async m=>{const ok=await m.runContractGate('./packages/brain/src/lib/__tests__/fixtures/contract-gate/db-point-read');if(ok.hits.map(h=>h.ruleId).includes('domain/db-no-time-window'))process.exit(2);if(!ok.ok)process.exit(3);const bad=await m.runContractGate('./packages/brain/src/lib/__tests__/fixtures/contract-gate/db-no-window');if(!bad.hits.map(h=>h.ruleId).includes('domain/db-no-time-window'))process.exit(4);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 钝点 B 分型：isAggregateDbProbeWithoutWindow 导出；聚合命中、定点读/写放行
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const f=m.isAggregateDbProbeWithoutWindow;if(typeof f!=='function')process.exit(2);const S=String.fromCharCode(39);if(f('psql db -c '+S+'SELECT count(*) FROM posts'+S)!==true)process.exit(3);if(f('psql db -c '+S+'SELECT status FROM t WHERE id=1'+S)!==false)process.exit(4);if(f('psql db -c '+S+'INSERT INTO t (a) VALUES (1) RETURNING id'+S)!==false)process.exit(5);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"
