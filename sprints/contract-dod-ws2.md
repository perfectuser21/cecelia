# Contract DoD — Workstream 2: `/timezone` 端点与错误分支

**范围**: 在 WS1 建立的 `packages/brain/src/routes/time.js` 内新增 `GET /timezone`，通过 Node 内置 `Intl.DateTimeFormat` 实现，对非法/缺失 `tz` 返回 HTTP 400 + `{ error }`。不新增依赖。
**大小**: S（< 60 行新增）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `time.js` 注册了 `GET /timezone` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/timezone['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 使用 `Intl.DateTimeFormat` 做时区格式化
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/Intl\.DateTimeFormat/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 包含 try/catch 用于捕获 `Intl.DateTimeFormat` 抛出的 `RangeError`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/try\s*\{[\s\S]*Intl\.DateTimeFormat[\s\S]*\}\s*catch/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 含 HTTP 400 响应（非法/缺失 tz 的错误分支）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/\.status\(\s*400\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 错误分支返回体含 `error` 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/\berror\s*:/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 仍未新增 npm 依赖（对照 main 基线；与 WS1 相同约束）
  Test: bash -c "git fetch origin main --depth=1 >/dev/null 2>&1 || true; node -e \"const base=JSON.parse(require('child_process').execSync('git show origin/main:packages/brain/package.json').toString());const cur=JSON.parse(require('fs').readFileSync('packages/brain/package.json','utf8'));const added=Object.keys(cur.dependencies||{}).filter(k=>!(base.dependencies||{})[k]);if(added.length)process.exit(1)\""

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/timezone.test.js`，覆盖：
- GET /timezone?tz=Asia/Shanghai 返回 200，body.tz 原样回显，formatted 非空
- GET /timezone?tz=UTC 返回 200，body.tz=UTC
- 不同合法时区得到不同 formatted（Asia/Shanghai 与 America/Los_Angeles 不同）
- GET /timezone?tz=Not/AReal_Zone 返回 400，body.error 非空
- GET /timezone 无 tz 参数返回 400，body.error 非空
- GET /timezone?tz=（空字符串）返回 400，body.error 非空
- 注入形态时区串（URL-encoded `' OR 1=1--`）返回 400 而非 500
