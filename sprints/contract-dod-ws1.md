# Contract DoD — Workstream 1: 实现 /api/brain/ping-extended 端点

- [ ] [ARTIFACT] packages/brain/src/ 中存在注册 `/api/brain/ping-extended` 路由的代码
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/server.js','utf8');if(!c.includes('ping-extended'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] GET /api/brain/ping-extended 返回 200 + {status:"ok", timestamp:<ISO8601>, version:<semver>}，且 version 与 package.json 一致
  Test: curl -sf "localhost:5221/api/brain/ping-extended" | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(b.status!=='ok')process.exit(1);if(!/^\d+\.\d+\.\d+/.test(b.version))process.exit(1);if(isNaN(new Date(b.timestamp).getTime()))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] POST /api/brain/ping-extended 返回 4xx（非 GET 方法拒绝）
  Test: node -e "const h=require('http');const r=h.request({hostname:'localhost',port:5221,path:'/api/brain/ping-extended',method:'POST'},res=>{if(res.statusCode>=400&&res.statusCode<500){console.log('PASS: '+res.statusCode);process.exit(0)}else{console.log('FAIL: '+res.statusCode);process.exit(1)}});r.end()"
- [ ] [BEHAVIOR] 响应体恰好 3 个字段（status/timestamp/version），无多余字段
  Test: curl -sf "localhost:5221/api/brain/ping-extended" | node -e "const k=Object.keys(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')));if(k.length!==3)process.exit(1);console.log('PASS: '+k.join(','))"
