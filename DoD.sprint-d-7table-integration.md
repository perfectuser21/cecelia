# Sprint D — Harness × 7张表集成 DoD

## ARTIFACT 条目

- [x] [ARTIFACT] GET /api/brain/journey_features 路由存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/journeys.js','utf8');if(!c.includes('GET /api/brain/journey_features'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] registry.js 不含 registered_at
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/registry.js','utf8');if(c.includes('registered_at'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] execution.js PASS 分支含 thickness write-back
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('Feature thickness'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] execution.js 含5处 feature_id 传播
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const m=c.match(/feature_id: harnessPayload\.feature_id/g)||[];if(m.length<5)process.exit(1);console.log('OK count='+m.length)"

- [x] [ARTIFACT] smoke 脚本存在
  Test: node -e "require('fs').accessSync('packages/brain/scripts/smoke/sprint-d-7table-smoke.sh');console.log('OK')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] GET /journey_features 返回 200
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/journey_features); [ "$CODE" = "200" ] && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] GET /registry?type=skill 返回 200（registered_at fix）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5221/api/brain/registry?type=skill"); [ "$CODE" = "200" ] && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] POST feature + GET journey_id 过滤返回数据
  Test: manual:node -e "fetch('http://localhost:5221/api/brain/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'DoD J',journey_type:'autonomous',description:'d',e2e_test_path:'n'})}).then(r=>r.json()).then(j=>fetch('http://localhost:5221/api/brain/journey_features?journey_id='+j.id)).then(r=>r.json()).then(arr=>{if(!Array.isArray(arr))throw new Error('not array');console.log('OK count='+arr.length)})"
  期望: OK

- [x] [BEHAVIOR] PATCH thickness medium 成功
  Test: manual:bash -c 'FID=$(curl -sf -X POST http://localhost:5221/api/brain/journey_features -H "Content-Type: application/json" -d "{\"name\":\"DoD F\"}" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>console.log(JSON.parse(d).id))"); THICK=$(curl -sf -X PATCH "http://localhost:5221/api/brain/journey_features/$FID" -H "Content-Type: application/json" -d "{\"thickness\":\"medium\"}" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>console.log(JSON.parse(d).thickness))"); [ "$THICK" = "medium" ] && echo OK || exit 1'
  期望: OK
