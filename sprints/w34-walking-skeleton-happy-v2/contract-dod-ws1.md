---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 `GET /subtract` 路由

**范围**: 在 `playground/server.js` 加 `GET /subtract` 路由 + `playground/tests/server.test.js` 加 describe 块 + `playground/README.md` 加端点条目
**大小**: S（≈ 10-12 行 server.js + ≈ 30-40 个新 test + 1 行 README）
**依赖**: 无

---

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 含 `app.get('/subtract'` 路由声明
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes(\"app.get('/subtract'\"))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] `playground/server.js` 含字面字符串 `operation: 'subtract'` 或 `operation: \"subtract\"`（response body 字面）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/operation\s*:\s*['\"]subtract['\"]/.test(c))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /subtract'` 测试块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/subtract/.test(c))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] `playground/README.md` 端点列表含 `/subtract`
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/subtract'))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] `playground/server.js` 未引入新依赖（与 main 对比 package.json 的 dependencies 段一字不动）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('playground/package.json','utf8'));const d=p.dependencies||{};const keys=Object.keys(d).sort().join(',');if(keys!=='express')process.exit(1)"
  期望: exit 0

---

> BEHAVIOR 条目已迁移到 `tests/ws1/subtract.test.ts` 的 27 个 test() 块（v5.0 规则要求 contract-dod 只装 [ARTIFACT]）。
> evaluator 的 manual:bash 命令保留在 `dod-behavior-dynamic` CI job 动态运行，本文件仅追踪静态 ARTIFACT。
