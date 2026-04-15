# Contract DoD — Workstream 4: 监控端点 + Dashboard 页面

- [ ] [BEHAVIOR] GET /api/brain/harness/pipeline-health 返回 200 + JSON，含 pipelines 数组和汇总字段
  Test: manual:curl -sf localhost:5221/api/brain/harness/pipeline-health | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.pipelines)){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 超过 6 小时无进展的 pipeline 在响应中标记 pipeline_stuck=true
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8');if(!c.includes('pipeline_stuck')&&!c.includes('6'))process.exit(1);console.log('PASS')"
- [ ] [ARTIFACT] server.js 或路由文件注册了 pipeline-health 端点
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/server.js','utf8');if(!c.includes('pipeline-health'))process.exit(1);console.log('OK')"
- [ ] [ARTIFACT] Dashboard 存在 Harness 监控页面组件且引用 pipeline-health API
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src',{recursive:true}).filter(f=>/harness|pipeline.monitor/i.test(f)&&/\.(tsx|jsx)$/.test(f));if(files.length===0)process.exit(1);console.log('OK: '+files.join(','))"
- [ ] [BEHAVIOR] Dashboard 监控页面能渲染空状态（无活跃 pipeline 时不报错）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src',{recursive:true}).filter(f=>/harness|pipeline/i.test(f)&&/\.(tsx|jsx)$/.test(f));const c=files.map(f=>fs.readFileSync('apps/dashboard/src/'+f,'utf8')).join('');if(!c.includes('empty')||!c.includes('pipeline-health'))process.exit(1);console.log('PASS')"
