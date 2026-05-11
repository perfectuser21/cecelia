contract_branch: cp-harness-propose-r1-960e97e7
workstream_index: 1
sprint_dir: sprints/w31-walking-skeleton-p1-v3

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement 路由 + 单测 + README

**范围**: 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /decrement` 路由（含 `keys.length===1 && keys[0]==='value'` 校验 + strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上下界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块；在 `playground/README.md` 加 `/decrement` 端点说明

**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 内含 `/decrement` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/decrement['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/decrement` 路由块含 strict-schema 整数正则 `^-?\d+$`（不含小数支持，与 STRICT_NUMBER 浮点 regex 不同）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/\^-\?\\d\+\$/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/decrement` 路由使用 query 名 `value`（不复用 `n`/`a`/`b`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\b(req\.query\.value|\{\s*value\s*\})/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/decrement` 路由含双侧精度上界判定常量 `9007199254740990`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/9007199254740990/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/decrement` 路由响应字面含 `operation: "decrement"` 字符串（非变体）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]decrement['\"]/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/decrement` 路由响应字面含 `result` 字段，且 W26 模板 `operation: "increment"` 字面**不再出现在 /decrement 块内**（防漏改）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);if(/operation\s*:\s*['\"]increment['\"]/.test(m[0])){console.error('FAIL: /decrement 块内仍出现 operation:\"increment\" — W26 模板漏改');process.exit(1)}for(const k of ['decremented','prev','previous','predecessor','pred','n_minus_one','minus_one','sub_one','subtracted','decrementation','incremented','n_plus_one','successor']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /decrement'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/decrement/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 端点列表含 `/decrement` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/decrement/.test(c))process.exit(1)"

## BEHAVIOR 条目（v5.0 已搬到 sprints/w31-walking-skeleton-p1-v3/tests/ws1/decrement.test.js 27 个 it()；本节为 integrity 镜像）

- [x] [BEHAVIOR] GET /decrement?value=5 → 200 + 严 schema `{result:4, operation:"decrement"}` + 顶层 keys 完整性 `["operation","result"]`
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=5 响应 `.operation != "increment"`（防 W26 模板漏改 — W31 独有最易踩坑）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=5 响应不含任一禁用字段（30 个禁用名反向 has() | not）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=0 → 200 + result==-1（off-by-one 零侧）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=1 → 200 + result==0（off-by-one 严格 0 数字字面，非 null/undefined/false）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=-1 → 200 + result==-2（off-by-one 负侧）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=9007199254740990 → 200 + result==9007199254740989（精度上界 happy）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=-9007199254740990 → 200 + result==-9007199254740991 (===Number.MIN_SAFE_INTEGER)（精度下界 happy）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=9007199254740991 → 400 + 错误体 keys==["error"] + 不含 result/operation（上界 +1 拒）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=-9007199254740991 → 400 + 错误体 keys==["error"]（下界 -1 拒）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] strict-schema 拒（1.5 / 1.0 / 1e2 / 0xff / abc / Infinity / NaN / 空串 / 仅负号 / 双重负号 / 前导+ / 千分位 / 尾部负号 共 13 类 → 全 400）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement（缺 value 参数） → 400
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] 错 query 名（n/x/y/m/val/input/v/count/a/b 等 ≥ 10 个）一律 → 400
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=5&extra=x（多余 query）→ 400 + 错误体不含 result/operation
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] GET /decrement?value=01 → 200 + result==0（前导 0 happy，非八进制错位）
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] 已有 8 路由 (/health /sum /multiply /divide /power /modulo /factorial /increment) happy 用例回归全通过
  Test: tests/ws1/decrement.test.js

- [x] [BEHAVIOR] 上界拒错误体 schema 完整性 + 不含 result/operation 双联（独立断言巩固 Risk 8 错误体污染防御）
  Test: tests/ws1/decrement.test.js
