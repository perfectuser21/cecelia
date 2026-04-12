# Contract DoD — Workstream 1: Health 端点新增 evaluator_stats 聚合查询

- [ ] [BEHAVIOR] `GET /api/brain/health` 响应包含 `evaluator_stats` 字段，含 `total_runs`、`passed`、`failed`、`last_run_at` 四个子字段
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!h.evaluator_stats) process.exit(1); const s=h.evaluator_stats; if(typeof s.total_runs!=='number'||typeof s.passed!=='number'||typeof s.failed!=='number'||!('last_run_at' in s)) process.exit(1); if(s.total_runs!==s.passed+s.failed) process.exit(1); console.log('PASS')"
- [ ] [BEHAVIOR] 无 Evaluator 记录时 `evaluator_stats` 返回零值对象 `{total_runs:0, passed:0, failed:0, last_run_at:null}`，不为 null 或缺失
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const s=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats; if(s===null||s===undefined) process.exit(1); console.log('PASS: evaluator_stats is object')"
- [ ] [BEHAVIOR] Health 端点响应时间无显著退化（平均 < 200ms）
  Test: node -e "const http=require('http');let t=[];let d=0;for(let i=0;i<5;i++){const s=Date.now();http.get('http://localhost:5221/api/brain/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{t.push(Date.now()-s);d++;if(d===5){const a=t.reduce((x,y)=>x+y,0)/5;if(a>200)process.exit(1);console.log('PASS: avg='+a.toFixed(0)+'ms')}})})}"
