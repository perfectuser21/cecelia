# Contract DoD — Workstream 3: Bridge cecelia-run.sh DB 直写改造

- [ ] [BEHAVIOR] send_webhook 通过非注释代码执行 psql INSERT INTO callback_queue
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));const lines=fn.split('\n');const ok=lines.some(l=>l.includes('INSERT INTO callback_queue')&&!l.trim().startsWith('#'));if(!ok){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] psql 连接设置超时（connect_timeout 或 PGCONNECT_TIMEOUT），失败后降级到 HTTP POST curl
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));const lines=fn.split('\n').filter(l=>!l.trim().startsWith('#'));const hasTimeout=lines.some(l=>l.includes('connect_timeout')||l.includes('PGCONNECT_TIMEOUT'));const hasCurl=lines.some(l=>l.includes('curl'));if(!hasTimeout){console.error('FAIL:no timeout');process.exit(1)}if(!hasCurl){console.error('FAIL:no curl fallback');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 原有 curl 发送逻辑完整保留作为 fallback 路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));if(!fn.includes('curl')&&!fn.includes('WEBHOOK_URL')){console.error('FAIL');process.exit(1)}console.log('PASS')"
