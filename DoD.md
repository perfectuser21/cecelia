contract_branch: cp-harness-propose-r2-230fe8f9
workstream_index: 1
sprint_dir: sprints/w36-walking-skeleton-final-b13

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement endpoint

**范围**: `playground/server.js` 新增 `GET /decrement`（query 名 `value`，strict-schema `^-?\d+$`，`|Number(value)| > 9007199254740990` 显式拒，`Number(value) - 1` 算术，返回 `{result, operation: "decrement"}`）+ `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块 + `playground/README.md` 新增 `/decrement` 段。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 含 `app.get('/decrement'` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes(\"app.get('/decrement'\"))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` /decrement 段含 strict-schema 整数正则 `^-?\d+$`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\\/\\^-\\?\\\\d\\+\\$\\//.test(c) && !c.includes('^-?\\\\d+$'))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` /decrement 含上界数字 9007199254740990
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes('9007199254740990'))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` /decrement 算术表达式字面含减号（不是 `+ 1`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\\.get\\('\\/decrement'[\\s\\S]*?app\\.get\\(/);const body=m?m[0]:'';if(!/-\\s*1/.test(body)||/\\+\\s*1/.test(body))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` /decrement 响应含字面 `operation: 'decrement'` 字符串
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/operation:\\s*['\\\"]decrement['\\\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /decrement'` 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes(\"describe('GET /decrement\"))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 含 `/decrement` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/decrement'))process.exit(1)"

## BEHAVIOR 索引

BEHAVIOR 测试已搬到 `sprints/w36-walking-skeleton-final-b13/tests/ws1/decrement.test.js`（v5.0 规则：BEHAVIOR 必须在 .test.ts/.test.js 文件里）。覆盖 9 个 describe 块、47 条 it()，包含：

- happy 值复算 + schema 完整性（5 it）
- off-by-one 防盲抄 W26 increment（3 it）
- 精度上下界 happy（2 it）
- 上下界拒 + 错误体 schema 完整性（4 it）
- strict-schema 拒（15 it）
- 错 query 名 + 缺参（5 it）
- 前导 0 happy（3 it）
- 禁用字段名反向断言（2 it）
- 8 路由回归（8 it）
