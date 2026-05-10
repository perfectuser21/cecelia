contract_branch: cp-harness-propose-r3-eaf2a56f
workstream_index: 1
sprint_dir: sprints/w19-playground-sum

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /sum

**范围**：playground/server.js 加 `/sum` 路由 + playground/tests/server.test.js 加用例 + playground/README.md 更新端点段
**大小**：S（< 100 行）
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/sum` 路由注册
  Test: `node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删）
  Test: `node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/sum` 的测试用例
  Test: `node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/sum'))process.exit(1)"`

- [ ] [ARTIFACT] `playground/tests/server.test.js` 同时含 happy path（200 / sum 字段断言）+ error path（400 / error 字段断言）
  Test: `node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)))process.exit(1)"`

- [ ] [ARTIFACT] `playground/README.md` 已更新端点段，`/sum` 不再标记为"不在 bootstrap 范围"
  Test: `node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/sum')||/不在 bootstrap 范围/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 express）
  Test: `node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"`

- [ ] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 supertest + vitest）
  Test: `node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"`

## BEHAVIOR 索引（实际测试在 sprints/w19-playground-sum/tests/ws1/）

见 `sprints/w19-playground-sum/tests/ws1/sum.test.js`，覆盖：
- GET `/sum?a=2&b=3` → 200 + body `{sum:5}`
- GET `/sum?a=2`（缺 b） → 400 + body `.error` 非空字符串
- GET `/sum?a=abc&b=3`（非数字） → 400 + `.error` 非空 + body 不含 `sum` 字段
- GET `/sum?a=-1&b=1` → 200 + `{sum:0}`（负数合法）
- GET `/sum?a=1.5&b=2.5` → 200 + `{sum:4}`（小数合法）
- GET `/health` → 200 + `{ok:true}`（回归不破坏）
