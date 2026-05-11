contract_branch: cp-harness-propose-r2-b32fd494
workstream_index: 1
sprint_dir: sprints/w23-playground-modulo

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /modulo（strict-schema + 除零拒 + 符号不变量 oracle）

**范围**：playground/server.js 加 `/modulo` 路由（含 strict-schema 正则校验 + 显式 `b=0` 拒 + JS 原生 `%` 运算 + 字段名锁死 `remainder`）+ playground/tests/server.test.js 加 `/modulo` describe 块（含 happy + 除零拒 + strict 拒 + 值 oracle + 符号不变量 oracle + schema oracle + 失败 body 不含 remainder 断言）+ playground/README.md 端点段加 `/modulo` 示例。**不动 `/health` / `/sum`（W19）/ `/multiply`（W20）/ `/divide`（W21）/ `/power`（W22）的实现/测试**，零新依赖。
**大小**：M（约 10 行 server.js 净增 + 约 220 行测试 + 约 30 行 README）
**依赖**：无（W19~W22 已合并，作为回归基线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/modulo` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/modulo['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删 bootstrap）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/sum` 路由（防误删 W19）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/multiply` 路由（防误删 W20）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/multiply['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/divide` 路由（防误删 W21）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/divide['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/power` 路由（防误删 W22）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/power['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 实现 `/modulo` 时使用 `^-?\d+(\.\d+)?$` 完整匹配正则（防 Number()/parseFloat() 假绿，可与 /multiply、/divide、/power 共享同一字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\\^-\\?\\\\d\\+\\(\\\\\\.\\\\d\\+\\)\\?\\$/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 含显式 `b === 0` 拒判（`Number(b) === 0`），位置在 strict-schema 校验通过后、计算之前
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=c.split(/app\.get\(\s*['\"]\/modulo['\"]/)[1]||'';if(!/Number\(\s*b\s*\)\s*===\s*0/.test(seg.split(/app\.get\(/)[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 在 `/modulo` 路由用 JS 原生 `%` 算子做计算（不允许 floored mod 包装 `((a%b)+b)%b` 或 Math.floorDiv 等）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/modulo['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/Number\(\s*a\s*\)\s*%\s*Number\(\s*b\s*\)/.test(seg))process.exit(1);if(/\(\s*\(\s*Number\([^)]*\)\s*%\s*Number\([^)]*\)\s*\)\s*\+\s*Number/.test(seg)||/Math\.floorDiv/.test(seg))process.exit(2)"

- [ ] [ARTIFACT] `playground/server.js` 在 `/modulo` 响应体中使用 `remainder` 字段名（不允许 `result` / `value` / `answer` / `mod` / `modulo` / `rem` / `rest` / `residue` / `out` / `output` / `data` 等漂移命名）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/modulo['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/remainder/.test(seg))process.exit(1);if(/\\b(result|value|answer|mod|modulo|rem|rest|residue|out|output|data|payload|response|sum|product|quotient|power)\\s*:/.test(seg))process.exit(2)"

- [ ] [ARTIFACT] `playground/server.js` /modulo 不引入 `Number.isFinite` 兜底（W23 范围之外的多余兜底视为合同违约：strict + b≠0 已保证结果有限）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/modulo['\"]/)[1]||'').split(/app\.get\(/)[0];if(/Number\.isFinite/.test(seg))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/modulo` 的测试用例
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/modulo'))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 同时含 `/modulo` happy（200 + remainder）与 error（400）断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)&&/remainder/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖 `/modulo` 除零拒（含 `a:'5'` + `b:'0'` 与 `a:'0'` + `b:'0'` 两条用例），且断言 status === 400
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);const seg=c.slice(idx);const c1=/a:\s*['\"]5['\"][^}]*b:\s*['\"]0['\"]/.test(seg);const c2=/a:\s*['\"]0['\"][^}]*b:\s*['\"]0['\"]/.test(seg);if(!(c1&&c2&&/toBe\(400\)/.test(seg)))process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 至少 2 条 `/modulo` oracle 值复算断言形如 `toBe(Number('...') % Number('...'))`，其中至少 1 条覆盖负被除数（如 `Number('-5') % Number('3')`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);const seg=c.slice(idx);const all=seg.match(/toBe\(\s*Number\(['\"][^'\"]+['\"]\)\s*%\s*Number\(['\"][^'\"]+['\"]\)\s*\)/g)||[];const neg=seg.match(/toBe\(\s*Number\(['\"]-\d+(?:\.\d+)?['\"]\)\s*%\s*Number\(['\"][^'\"]+['\"]\)\s*\)/g)||[];if(all.length<2||neg.length<1)process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 至少 2 条 `/modulo` 符号不变量 oracle 断言形如 `expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('...')))`，其中至少 1 条负被除数（`Math.sign(Number('-X'))` 期望 -1）+ 至少 1 条正被除数（`Math.sign(Number('X'))` 期望 1）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);const seg=c.slice(idx);const all=seg.match(/Math\.sign\s*\(\s*res\.body\.remainder\s*\)/g)||[];const negSign=/Math\.sign\s*\(\s*Number\(\s*['\"]-\d+(?:\.\d+)?['\"]\s*\)\s*\)/.test(seg);if(all.length<2||!negSign)process.exit(2);const negLit=/toBe\(\s*-1\s*\)/.test(seg);const posLit=/toBe\(\s*1\s*\)/.test(seg);if(!(negLit&&posLit))process.exit(3)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 至少 1 条 `/modulo` schema oracle 断言形如 `expect(Object.keys(res.body)...).toEqual([...])` 含 `'remainder'`（成功响应顶层 keys 严格等于 ['remainder']）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);if(!/expect\(\s*Object\.keys\(\s*res\.body\s*\)[^)]*\)\.toEqual\(\s*\[\s*['\"]remainder['\"]\s*\]\s*\)/.test(c.slice(idx)))process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 至少 1 条 `/modulo` 失败响应断言 body 不含 remainder 字段（`not.toHaveProperty('remainder')` 或 `hasOwnProperty('remainder'))).toBe(false)`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);const seg=c.slice(idx);if(!(/not\.toHaveProperty\(['\"]remainder['\"]\)/.test(seg)||/hasOwnProperty[^)]*['\"]remainder['\"][^)]*\)\)\.toBe\(false\)/.test(seg)))process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` `/modulo` 显式覆盖 strict-schema 核心拒绝路径（科学计数法 `1e3` + `Infinity` + `NaN` + 前导 + + 十六进制 + 千分位 全在 /modulo describe 段出现）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);const seg=c.slice(idx);const must=['1e3','Infinity','NaN','+2','0xff','1,000'];for(const m of must){if(!seg.includes(m)){console.error('miss '+m);process.exit(2)}}"

- [ ] [ARTIFACT] `playground/tests/server.test.js` `/modulo` happy 至少含 6 条 200 用例（覆盖正正/负正/正负/负负/整除/浮点/0%N 等）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/modulo');if(idx<0)process.exit(1);const seg=c.slice(idx);const happy=seg.match(/toBe\(200\)/g)||[];if(happy.length<6)process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 仍保留现有 `/health` / `/sum` / `/multiply` / `/divide` / `/power` 用例（bootstrap + W19 + W20 + W21 + W22 回归）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')&&c.includes('/power')))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/modulo` 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/modulo'))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 给出 `/modulo` happy 示例（含 `a=5&b=3` 或 `a=10&b=3` 等正正字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/modulo');if(idx<0||!(/a=5&b=3/.test(c.slice(idx))||/a=10&b=3/.test(c.slice(idx))||/a=6&b=2/.test(c.slice(idx))))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 给出 `/modulo` 除零拒绝示例（含 `a=5&b=0` 或 `a=0&b=0` 字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/modulo');if(idx<0||!(/a=5&b=0/.test(c.slice(idx))||/a=0&b=0/.test(c.slice(idx))))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 给出 `/modulo` 符号不变量示例（含负被除数 `a=-5&b=3` 或 `a=-5&b=-3`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/modulo');if(idx<0||!(/a=-5&b=3/.test(c.slice(idx))||/a=-5&b=-3/.test(c.slice(idx))||/a=5&b=-3/.test(c.slice(idx))))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 给出 `/modulo` strict-schema 拒绝示例（`1e3` 或 `Infinity` 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/modulo');if(idx<0||!(/1e3/.test(c.slice(idx))||/Infinity/.test(c.slice(idx))))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 仍含 `/health` / `/sum` / `/multiply` / `/divide` / `/power` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')&&c.includes('/power')))process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv/decimal.js/bignumber.js/mathjs）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/w23-playground-modulo/tests/ws1/）

见 `sprints/w23-playground-modulo/tests/ws1/modulo.test.ts`，覆盖：

- happy + 值复算 oracle + 边界
  - GET `/modulo?a=5&b=3` → 200 + body `{remainder:2}`（正正整数 happy）
  - GET `/modulo?a=10&b=3` → 200 + body `{remainder:1}`
  - GET `/modulo?a=6&b=2` → 200 + body `{remainder:0}`（整除）
  - GET `/modulo?a=5.5&b=2` → 200 + body `{remainder:1.5}`（浮点）
  - GET `/modulo?a=0&b=5` → 200 + body `{remainder:0}`（被除数 0）
  - GET `/modulo?a=0&b=-5` → 200 + body `{remainder:0}`（被除数 0 + 负除数）
  - GET `/modulo?a=1&b=3` → 200 + `body.remainder === Number('1') % Number('3')`（**oracle 探针 #1**：值复算）
  - GET `/modulo?a=-7&b=2` → 200 + `body.remainder === Number('-7') % Number('2')`（**oracle 探针 #2**：负被除数值复算）
- **W23 核心符号不变量 oracle**
  - GET `/modulo?a=-5&b=3` → 200 + `body.remainder === -2`（JS truncated 关键，floored mod 会返 1 → 必挂）
  - GET `/modulo?a=5&b=-3` → 200 + `body.remainder === 2`（floored mod 会返 -1 → 必挂）
  - GET `/modulo?a=-5&b=-3` → 200 + `body.remainder === -2`
  - `expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('-5'))) === toBe(-1)` 负被除数符号探针
  - `expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('5'))) === toBe(1)` 正被除数符号探针
- schema oracle
  - GET `/modulo?a=5&b=3` 响应 `Object.keys(res.body)` 严格等于 `['remainder']`（无 operation/result/a/b/input/sum/product/quotient/power 等多余字段）
- 除零拒（W23 复用 W21 范式，唯一 rule-based 拒绝路径）
  - GET `/modulo?a=5&b=0` → 400 + `.error` 非空 + body 不含 `remainder`
  - GET `/modulo?a=0&b=0` → 400 + body 不含 `remainder`（0%0 也归此分支）
  - GET `/modulo?a=-5&b=0` → 400 + body 不含 `remainder`
  - GET `/modulo?a=5&b=0.0` → 400 + body 不含 `remainder`（b=0.0 也算零）
- 缺参
  - GET `/modulo?a=5`（缺 b） → 400 + `.error` 非空 + body 不含 `remainder`
  - GET `/modulo?b=3`（缺 a） → 400 + `.error` 非空
  - GET `/modulo`（双参数都缺） → 400 + `.error` 非空
- strict-schema 拒绝（防 W20/W21/W22 strict 被打回，沿用同款正则）
  - GET `/modulo?a=1e3&b=2`（科学计数法） → 400 + body 不含 `remainder`
  - GET `/modulo?a=Infinity&b=2` → 400 + body 不含 `remainder`
  - GET `/modulo?a=2&b=NaN` → 400 + `.error` 非空
  - GET `/modulo?a=+2&b=3`（前导正号） → 400
  - GET `/modulo?a=.5&b=2`（缺整数部分） → 400
  - GET `/modulo?a=2.&b=3`（缺小数部分） → 400
  - GET `/modulo?a=0xff&b=2`（十六进制） → 400
  - GET `/modulo?a=1,000&b=2`（千分位） → 400
  - GET `/modulo?a=&b=3`（空字符串） → 400
  - GET `/modulo?a=abc&b=3`（非数字） → 400 + body 不含 `remainder`
- 反向同义字段（schema 完整性反向探针）
  - GET `/modulo?a=5&b=3` 成功响应不含 `result`/`value`/`answer`/`mod`/`modulo`/`rem`/`rest`/`residue`/`out`/`output`/`sum`/`product`/`quotient`/`power`/`operation`/`dividend`/`divisor`
- 回归（不破坏现有 endpoint）
  - GET `/health` → 200 + `{ok:true}`（bootstrap）
  - GET `/sum?a=2&b=3` → 200 + `{sum:5}`（W19）
  - GET `/multiply?a=2&b=3` → 200 + `{product:6}`（W20）
  - GET `/divide?a=6&b=2` → 200 + `{quotient:3}`（W21）
  - GET `/power?a=2&b=10` → 200 + `{power:1024}`（W22）
  - GET `/divide?a=5&b=0` → 400（W21 除零兜底仍生效）
  - GET `/power?a=0&b=0` → 400（W22 0^0 拒仍生效）
