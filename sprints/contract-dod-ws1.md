# Contract DoD — Workstream 1: 实现 /api/brain/ping-extended 端点

- [ ] [ARTIFACT] packages/brain/src/ 中存在注册 `/api/brain/ping-extended` 路由的代码（含 app.get 或 router.get）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/server.js','utf8');if(!c.includes('ping-extended')||(!c.includes('app.get')&&!c.includes('router.get')))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] GET /api/brain/ping-extended 返回 200 + {status:"ok", timestamp:<ISO8601>, version:<semver>}，恰好 3 个字段
  Test: curl -sf "localhost:5221/api/brain/ping-extended" | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(Object.keys(b).length!==3)process.exit(1);if(b.status!=='ok')process.exit(1);if(!/^\d+\.\d+\.\d+/.test(b.version))process.exit(1);if(isNaN(new Date(b.timestamp).getTime()))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] POST /api/brain/ping-extended 返回 4xx（非 GET 方法拒绝）
  Test: node -e "const{execSync}=require('child_process');const s=execSync('curl -s -o /dev/null -w \"%{http_code}\" -X POST localhost:5221/api/brain/ping-extended').toString().trim();const c=parseInt(s);if(c<400||c>=500){console.log('FAIL:'+c);process.exit(1)}console.log('PASS:'+c)"
- [ ] [BEHAVIOR] version 字段与 packages/brain/package.json 一致
  Test: node -e "const{execSync}=require('child_process');const a=JSON.parse(execSync('curl -sf localhost:5221/api/brain/ping-extended').toString()).version;const p=require('./packages/brain/package.json').version;if(a!==p){console.log('FAIL:'+a+'!='+p);process.exit(1)}console.log('PASS:'+a)"
