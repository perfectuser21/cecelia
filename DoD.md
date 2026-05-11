contract_branch: cp-harness-propose-r3-e3ce6436
workstream_index: 1
sprint_dir: sprints/w26-playground-increment

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /increment 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /increment` 路由（含 strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + `Number(value) + 1` 算术 + 返回 `{result, operation: "increment"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /increment', ...)` 块；在 `playground/README.md` 加 `/increment` 端点说明
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 内含 `/increment` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/increment['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内含 strict-schema 整数正则 `^-?\d+$`（不含小数支持）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m||!/\^-\?\\d\+\$/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/increment` 路由使用 query 名 `value`（不复用 `n`/`a`/`b`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\b(req\.query\.value|\{\s*value\s*\})/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/increment` 路由含上界判定 `9007199254740990`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m||!/9007199254740990/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/increment` 路由响应字面含 `operation: "increment"` 字符串
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]increment['\"]/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/increment` 路由响应字面含 `result` 字段（不漂到 `incremented`/`next`/`successor` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);for(const k of ['incremented','successor','n_plus_one','plus_one','succ','incr','incrementation']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /increment'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/increment/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 端点列表含 `/increment` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/increment/.test(c))process.exit(1)"

> **注**：v5.0 [BEHAVIOR] 条目已全部搬迁到 `sprints/w26-playground-increment/tests/ws1/increment.test.js` 的 51 个 `test()` 块中（DoD 纯度规则：本文件只装 [ARTIFACT]）。Evaluator 对 BEHAVIOR 的真实校验通过 `tests/ws1/increment.test.js` vitest 实跑完成；本仓库 v5.0 `dod-behavior-dynamic` CI workflow 会动态运行 BEHAVIOR 验证。
