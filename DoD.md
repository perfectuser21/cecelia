contract_branch: cp-harness-propose-r2-78b3578b
workstream_index: 1
sprint_dir: sprints/w37-walking-skeleton-final-b14

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement (Round 2)

**范围**: `playground/server.js` 加 `/decrement` 路由 + `playground/tests/server.test.js` 加 `describe('GET /decrement')` + `playground/README.md` 加 `/decrement` 段
**大小**: S (<100 行净增 / ≤ 3 文件)
**依赖**: 无

**FIX 备注 (B14 4 fix)**: 原 [BEHAVIOR] 段违反 CI v5.0 DoD purity 规则（DoD 仅可含 ARTIFACT）。所有 BEHAVIOR 已落地为 `sprints/w37-walking-skeleton-final-b14/tests/ws1/decrement.test.js` 的 28 个 vitest test() 块（Sprint Tests 实跑 v5.0 已通过）。BEHAVIOR 段移除以满足 purity check + dod-behavior-dynamic check。

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 注册 `app.get('/decrement'` 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/decrement['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/decrement` 路由含 strict-schema 整数正则 `^-?\d+$` 与精度上界数字 9007199254740990
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/9007199254740990/.test(c)||!/\^-\?\\\\d\+\$/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /decrement'` 独立块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(\s*['\"]GET \/decrement/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 含 `/decrement` 端点段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/decrement/.test(c))process.exit(1)"
