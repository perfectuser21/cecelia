# Sprint Contract Draft (Round 2)

## PRD 摘要

在 Brain 中添加 `/api/brain/ping-extended` 端点，返回扩展健康信息：`{status: "ok", timestamp: <ISO8601>, version: <semver>}`。用于验证 harness pipeline 端到端稳定性。

---

## Feature 1: /api/brain/ping-extended 端点 — Happy Path

**行为描述**:
向 Brain 发送 GET 请求到 `/api/brain/ping-extended`，服务器返回 HTTP 200，响应体为 JSON 对象，包含 `status`、`timestamp`、`version` 三个字段。`status` 固定为 `"ok"`，`timestamp` 为 ISO 8601 格式的当前时间，`version` 为合法 semver 字符串。

**硬阈值**:
- HTTP 状态码 = 200
- Content-Type 包含 `application/json`
- 响应体包含 `status` 字段，值严格等于 `"ok"`
- 响应体包含 `timestamp` 字段，值为合法 ISO 8601 时间字符串
- 响应体包含 `version` 字段，值匹配 semver 格式 `X.Y.Z`
- 响应体不包含除 `status`、`timestamp`、`version` 以外的顶层字段

**验证命令**:
```bash
# Happy path: 验证端点返回正确结构和值
curl -sf "localhost:5221/api/brain/ping-extended" | \
  node -e "
    const body = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const keys = Object.keys(body);
    if (keys.length !== 3) throw new Error('FAIL: 期望 3 个字段，实际 ' + keys.length);
    if (body.status !== 'ok') throw new Error('FAIL: status 应为 ok，实际 ' + body.status);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(body.timestamp)) throw new Error('FAIL: timestamp 非 ISO8601: ' + body.timestamp);
    if (isNaN(new Date(body.timestamp).getTime())) throw new Error('FAIL: timestamp 不可解析');
    if (!/^\d+\.\d+\.\d+/.test(body.version)) throw new Error('FAIL: version 非 semver: ' + body.version);
    console.log('PASS: status=ok, timestamp=' + body.timestamp + ', version=' + body.version);
  "

# Content-Type 验证
CTYPE=$(curl -sf -D - -o /dev/null "localhost:5221/api/brain/ping-extended" | grep -i content-type)
echo "$CTYPE" | grep -qi "application/json" && echo "PASS: Content-Type 正确" || (echo "FAIL: Content-Type 不含 application/json: $CTYPE"; exit 1)
```

---

## Feature 2: /api/brain/ping-extended 端点 — 边界与错误处理

**行为描述**:
端点仅接受 GET 方法。使用 POST 等其他方法请求时，返回 4xx 状态码（405 Method Not Allowed 或 404）。端点无需认证，不接受任何查询参数或请求体。

**硬阈值**:
- POST 请求到 `/api/brain/ping-extended` 返回 HTTP 4xx
- 响应时间 < 500ms（纯内存操作，无 DB 查询）
- 连续请求 timestamp 字段值递增

**验证命令**:
```bash
# 边界: POST 方法应被拒绝（4xx）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/ping-extended")
[ "$STATUS" -ge 400 ] && [ "$STATUS" -lt 500 ] && echo "PASS: POST 返回 $STATUS (4xx)" || (echo "FAIL: POST 期望 4xx，实际 $STATUS"; exit 1)

# 边界: 连续请求 timestamp 递增
T1=$(curl -sf "localhost:5221/api/brain/ping-extended" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).timestamp)")
sleep 0.1
T2=$(curl -sf "localhost:5221/api/brain/ping-extended" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).timestamp)")
node -e "
  const t1 = new Date('$T1'), t2 = new Date('$T2');
  if (t2 <= t1) throw new Error('FAIL: t2(' + t2.toISOString() + ') <= t1(' + t1.toISOString() + ')');
  console.log('PASS: timestamp 递增 t1=' + t1.toISOString() + ' t2=' + t2.toISOString());
"
```

---

## Feature 3: version 字段与 package.json 一致

**行为描述**:
`/api/brain/ping-extended` 返回的 `version` 字段必须与 `packages/brain/package.json` 中的 `version` 字段严格一致，确保版本来源为单一事实源。

**硬阈值**:
- `version` 字段值 === `packages/brain/package.json` 中的 `version`

**验证命令**:
```bash
# 验证 version 与 package.json 一致
API_VER=$(curl -sf "localhost:5221/api/brain/ping-extended" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version)")
PKG_VER=$(node -e "console.log(require('./packages/brain/package.json').version)")
[ "$API_VER" = "$PKG_VER" ] && echo "PASS: version 一致 ($API_VER)" || (echo "FAIL: API=$API_VER, package.json=$PKG_VER"; exit 1)
```

---

## Workstreams

workstream_count: 1

### Workstream 1: 实现 /api/brain/ping-extended 端点

**范围**: 在 Brain 的路由层注册 GET `/api/brain/ping-extended`，handler 返回 `{status: "ok", timestamp: new Date().toISOString(), version}` 其中 version 读取自 `package.json`。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] packages/brain/src/ 中存在注册 `/api/brain/ping-extended` 路由的代码
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/server.js','utf8');if(!c.includes('ping-extended'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] GET /api/brain/ping-extended 返回 200 + {status:"ok", timestamp:<ISO8601>, version:<semver>}，且 version 与 package.json 一致
  Test: curl -sf "localhost:5221/api/brain/ping-extended" | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(b.status!=='ok')process.exit(1);if(!/^\d+\.\d+\.\d+/.test(b.version))process.exit(1);if(isNaN(new Date(b.timestamp).getTime()))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] POST /api/brain/ping-extended 返回 4xx（非 GET 方法拒绝）
  Test: node -e "const h=require('http');const r=h.request({hostname:'localhost',port:5221,path:'/api/brain/ping-extended',method:'POST'},res=>{if(res.statusCode>=400&&res.statusCode<500){console.log('PASS: '+res.statusCode);process.exit(0)}else{console.log('FAIL: '+res.statusCode);process.exit(1)}});r.end()"
- [ ] [BEHAVIOR] 响应体恰好 3 个字段（status/timestamp/version），无多余字段
  Test: curl -sf "localhost:5221/api/brain/ping-extended" | node -e "const k=Object.keys(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')));if(k.length!==3)process.exit(1);console.log('PASS: '+k.join(','))"
