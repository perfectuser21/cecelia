# Contract DoD — Contract Gate 规则进化 R4（注释行不参与作弊扫描 + capture-negative-assert 放行）

**范围**: 细化 `cheat/or-true`（新增第二类放行：捕获形态负向测试 `VAR=$(... || true)` + 跨语句对同名 $VAR 断言，新增 `isCaptureNegativeThenAssert` 识别器，复用 #3357 的 `hasCaptureThenAssert`）+ 扫描器前置剥离纯注释行（新增 `isCommentLine`，行首 `#` 跳过，evaluate 循环对纯注释逻辑语句不跑任何规则/env 扫描）+ 新增 `comment-or-true`/`capture-negative-assert` 两个生产实证 fixture + 单测。不含改其它规则、改 GAN 轮数策略、改路由、UI。复用 #3348/#3350/#3351/#3353/#3357 gate 库。
**大小**: S

## 背景

`#3357` 把 capture-then-assert 跨语句 oracle 接入 curl-no-jq 后，生产 run da418741（ci-defense-r2 合同）又实证两个钝点，致正确合同被 cheat/or-true 误报、GAN 烧轮次：

- **缺陷 A — 注释行参与作弊扫描**：`# 必须非零退出（上面 || true 是因为要捕获 log；用 echo 验返回）` 纯注释行（首个非空白字符为 `#`）里出现 `|| true` 字样，被 cheat/or-true 命中。注释是写给人看的说明，不是验收脚本，绝不该参与任何规则扫描。
- **缺陷 B — 负向测试的捕获形态**：`TAMPER_LOG=$(... npx vitest run ... 2>&1 || true)` 把【预期失败】命令的输出捕获进变量，末尾 `|| true` 仅落在命令替换 `$( )` 内部（只为让命令替换不因预期失败而中断），随后 `echo "$TAMPER_LOG" | grep -q "FAIL.*env_missing"` 对同名 $VAR 施加断言——与 #3351 的单语句负向断言同语义，却被 cheat/or-true 误报。

## 成功标准

- 纯注释行（行首 `#`，含缩进）一律不参与任何 cheat/weak-oracle/env 规则扫描；保守只做【行首 `#`】跳过，真命令行尾部的 `#` 段不剥离（避免误把真命令当注释放水）。
- `VAR=$( <预期失败命令> || true)` 捕获形态 + 后续【K=5 条逻辑语句内】对【同名】 $VAR 施加 grep -q / jq -e / [ 比较 / case 值断言 → 不再命中 `cheat/or-true`（缺陷 B 消除）。
- 三重收口防放水：必须是 `VAR=$(...)` 捕获形态、`|| true` 必须落在命令替换内部（赋值之外的另一条 swallow 不放行）、后续 K 条逻辑语句内对同名 $VAR 有断言（裸捕获后无断言仍命中、裸 `cmd || true` 仍命中、断言无关变量仍命中）。
- contract-gate 既有全部 13 fixtures/单测一个不松动；wiring/converge 测试绿。

## BEHAVIOR 条目（被测 = 真实 packages/brain/src/lib/contract-gate.js；CI eval node 加载真实模块断言 + vitest 套件）

- [x] [BEHAVIOR] 缺陷 A：comment-or-true fixture 放行（注释里 || true 不命中），真命令行尾 # 段不放水
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(async m=>{const ok=await m.runContractGate('./packages/brain/src/lib/__tests__/fixtures/contract-gate/comment-or-true');if(ok.hits.map(h=>h.ruleId).includes('cheat/or-true'))process.exit(2);if(!ok.ok)process.exit(3);const t=['```bash','assert_output || true  # tail comment','```'].join(String.fromCharCode(10));const r=m.evaluateContractText(t);if(!r.hits.map(h=>h.ruleId).includes('cheat/or-true'))process.exit(4);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 缺陷 A 精确性：isCommentLine 导出；行首 #（含缩进）为真、尾部 # 的真命令为假
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const f=m.isCommentLine;if(typeof f!=='function')process.exit(2);if(f('# x')!==true)process.exit(3);if(f('   # y')!==true)process.exit(4);if(f('grep -q ok file')!==false)process.exit(5);if(f('echo hi # tail')!==false)process.exit(6);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 缺陷 B：capture-negative-assert fixture 放行、裸捕获无断言反例仍命中
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(async m=>{const ok=await m.runContractGate('./packages/brain/src/lib/__tests__/fixtures/contract-gate/capture-negative-assert');if(ok.hits.map(h=>h.ruleId).includes('cheat/or-true'))process.exit(2);if(!ok.ok)process.exit(3);const L=String.fromCharCode(10);const D=String.fromCharCode(36);const bad=['```bash','LOG='+D+'(run 2>&1 || true)','echo done','```'].join(L);const r=m.evaluateContractText(bad);if(!r.hits.map(h=>h.ruleId).includes('cheat/or-true'))process.exit(4);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"

- [x] [BEHAVIOR] 缺陷 B 精确性：isCaptureNegativeThenAssert 导出；捕获内 || true + 同名断言放行、捕获外 swallow 不放行
  Test: manual:node -e "import('./packages/brain/src/lib/contract-gate.js').then(m=>{const f=m.isCaptureNegativeThenAssert;if(typeof f!=='function')process.exit(2);const D=String.fromCharCode(36);const Q=String.fromCharCode(34);const cap='LOG='+D+'(run 2>&1 || true)';const ll=[{content:cap},{content:'[ -n '+Q+D+'LOG'+Q+' ]'}];if(f(cap,{logicalLines:ll,index:0})!==true)process.exit(3);const out='BAR='+D+'(baz) || true';const ol=[{content:out},{content:'[ -n '+Q+D+'BAR'+Q+' ]'}];if(f(out,{logicalLines:ol,index:0})!==false)process.exit(4);console.log('OK')}).catch(e=>{console.error(e);process.exit(1)})"
