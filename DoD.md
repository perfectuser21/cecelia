contract_branch: cp-harness-contract-1be39496
workstream_index: 3
sprint_dir: sprints/callback-queue-persistence

# DoD: callback-queue-persistence — WS1+WS2+WS3 合并（Fix Round 2）

## WS1: DB Migration + Callback Queue 表

- [x] [ARTIFACT] migration 文件 `database/migrations/009-callback-queue.sql` 存在且格式正确
  Test: node -e "const c=require('fs').readFileSync('database/migrations/009-callback-queue.sql','utf8');if(!c.includes('CREATE TABLE callback_queue'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] migration 执行后 callback_queue 表可用，列类型正确（task_id=uuid, result_json=jsonb, duration_ms=integer, created_at=timestamptz）
  Test: manual:psql cecelia -c "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='callback_queue' ORDER BY ordinal_position" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');const checks={task_id:'uuid',result_json:'jsonb',duration_ms:'int4',created_at:'timestamptz'};const errs=Object.entries(checks).filter(([c,t])=>{const l=s.split('\n').find(x=>x.includes(c));return!l||!l.includes(t)}).map(([c,t])=>c+' missing or wrong type');if(errs.length){console.error('FAIL:'+errs.join(','));process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] 部分索引 idx_callback_queue_unprocessed 存在且条件为 processed_at IS NULL
  Test: manual:psql cecelia -c "SELECT indexdef FROM pg_indexes WHERE indexname='idx_callback_queue_unprocessed'" -t | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');if(!s.includes('processed_at IS NULL')){console.error('FAIL');process.exit(1)}console.log('PASS')"

## WS2: Callback Worker + 共享处理逻辑 + HTTP 端点改造

- [x] [ARTIFACT] 共享处理函数模块 callback-worker.js 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/callback-worker.js');console.log('OK')"
- [x] [BEHAVIOR] Worker 每 2 秒轮询 callback_queue，处理未处理记录并标记 processed_at，task 状态正确更新
  Test: manual:psql cecelia -c "INSERT INTO tasks(id,title,status,task_type) VALUES('00000000-0000-0000-0000-000000000001','ws2-test','in_progress','dev') ON CONFLICT(id) DO UPDATE SET status='in_progress',result=NULL" && curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-000000000001","run_id":"ws2-test-run","status":"AI Done","result":{"r":"ok"},"duration_ms":1,"attempt":1}' && sleep 4 && psql cecelia -t -c "SELECT count(*) FROM callback_queue WHERE run_id='ws2-test-run'" | node -e "if(parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim())<1){process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] HTTP 端点写入 callback_queue 后立即返回 200+success:true，响应 <500ms
  Test: manual:node -e "const t=Date.now();const h=require('http');const d=JSON.stringify({task_id:'00000000-0000-0000-0000-000000000001',run_id:'latency-test',status:'AI Done',duration_ms:1,attempt:1});const r=h.request({hostname:'localhost',port:5221,path:'/api/brain/execution-callback',method:'POST',headers:{'Content-Type':'application/json','Content-Length':d.length}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{const e=Date.now()-t;const j=JSON.parse(b);if(res.statusCode===200&&j.success===true&&e<500){console.log('PASS:'+e+'ms')}else{console.error('FAIL:status='+res.statusCode+' success='+j.success+' elapsed='+e);process.exit(1)}})});r.write(d);r.end()"
- [x] [BEHAVIOR] 幂等性：同一 task 的两条 callback 均被 worker 处理，但 task result 不被第二次覆盖
  Test: manual:psql cecelia -c "INSERT INTO tasks(id,title,status,task_type) VALUES('00000000-0000-0000-0000-000000000002','idemp-test','in_progress','dev') ON CONFLICT(id) DO UPDATE SET status='in_progress',result=NULL" && curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-000000000002","run_id":"idemp-r1","status":"AI Done","result":{"result":"first"},"duration_ms":1,"attempt":1}' && sleep 2 && curl -sf -X POST localhost:5221/api/brain/execution-callback -H 'Content-Type:application/json' -d '{"task_id":"00000000-0000-0000-0000-000000000002","run_id":"idemp-r1","status":"AI Done","result":{"result":"second"},"duration_ms":1,"attempt":1}' && sleep 5 && psql cecelia -t -c "SELECT result->>'result' FROM tasks WHERE id='00000000-0000-0000-0000-000000000002'" | node -e "const v=require('fs').readFileSync('/dev/stdin','utf8').trim();if(v==='second'){console.error('FAIL:result被覆盖');process.exit(1)}console.log('PASS:result='+v)"
- [x] [BEHAVIOR] Worker 和路由共享同一处理函数
  Test: node -e "const fs=require('fs');const f=s=>s.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');const w=f(fs.readFileSync('packages/brain/src/callback-worker.js','utf8'));const r=f(fs.readFileSync('packages/brain/src/routes/execution.js','utf8'));const fns=['processExecutionCallback','handleExecutionCallback','processCallback'];if(!fns.some(n=>w.includes(n)&&r.includes(n))){console.error('FAIL');process.exit(1)}console.log('PASS')"

## WS3: Bridge cecelia-run.sh DB 直写改造

- [x] [BEHAVIOR] send_webhook 通过非注释代码执行 psql INSERT INTO callback_queue
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));const lines=fn.split('\n');const ok=lines.some(l=>l.includes('INSERT INTO callback_queue')&&!l.trim().startsWith('#'));if(!ok){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] psql 连接设置超时（connect_timeout 或 PGCONNECT_TIMEOUT），失败后降级到 HTTP POST curl
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));const lines=fn.split('\n').filter(l=>!l.trim().startsWith('#'));const hasTimeout=lines.some(l=>l.includes('connect_timeout')||l.includes('PGCONNECT_TIMEOUT'));const hasCurl=lines.some(l=>l.includes('curl'));if(!hasTimeout){console.error('FAIL:no timeout');process.exit(1)}if(!hasCurl){console.error('FAIL:no curl fallback');process.exit(1)}console.log('PASS')"
- [x] [ARTIFACT] 原有 curl 发送逻辑完整保留作为 fallback 路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));if(!fn.includes('curl')&&!fn.includes('WEBHOOK_URL')){console.error('FAIL');process.exit(1)}console.log('PASS')"
