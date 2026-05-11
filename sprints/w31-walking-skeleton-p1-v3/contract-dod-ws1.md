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

## BEHAVIOR 索引

> BEHAVIOR 条目按 v5.0 纯度规则搬到 `sprints/w31-walking-skeleton-p1-v3/tests/ws1/decrement.test.js`（27 个 it()），不在本 DoD 文件出现。
> evaluator 跑 `npx vitest run sprints/w31-walking-skeleton-p1-v3/tests/ws1/decrement.test.js` 验证。
