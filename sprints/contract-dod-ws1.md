# Contract DoD — Workstream 1: `/iso` + `/unix` 端点路由模块

**范围**: 新建 `packages/brain/src/routes/time.js`，导出默认 Express Router，挂载两个无参数的只读端点 `GET /iso` 与 `GET /unix`。不引入新 npm 依赖，不改 server.js。
**大小**: S（< 100 行新增）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件 `packages/brain/src/routes/time.js` 存在
  Test: test -f packages/brain/src/routes/time.js

- [ ] [ARTIFACT] `time.js` 导出默认 Express Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/express\.Router\s*\(/.test(c))process.exit(1);if(!/export\s+default\s+router/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `time.js` 注册了 `GET /iso` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/iso['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册了 `GET /unix` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/unix['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/package.json` 的 `dependencies` 字段未新增任何条目（对照 main 基线）
  Test: bash -c "git fetch origin main --depth=1 >/dev/null 2>&1 || true; node -e \"const base=JSON.parse(require('child_process').execSync('git show origin/main:packages/brain/package.json').toString());const cur=JSON.parse(require('fs').readFileSync('packages/brain/package.json','utf8'));const added=Object.keys(cur.dependencies||{}).filter(k=>!(base.dependencies||{})[k]);if(added.length)process.exit(1)\""

- [ ] [ARTIFACT] `time.js` 新增行数 < 100（小改动保证）
  Test: bash -c "[ \$(wc -l < packages/brain/src/routes/time.js) -lt 100 ]"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/iso-unix.test.js`，覆盖：
- GET /iso 返回 200 且含 iso 字符串字段
- GET /iso iso 字段可被 `new Date()` 解析回相同 ISO-8601
- GET /iso 时间戳与墙钟偏差 < 1 秒
- GET /unix 返回 200 且 unix 字段是正整数
- GET /unix 是秒级粒度（与 `Math.floor(Date.now()/1000)` 差值 ≤ 5 秒，且 < 1e11）
