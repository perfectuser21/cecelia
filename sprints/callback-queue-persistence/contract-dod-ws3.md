# Contract DoD — Workstream 3: Bridge cecelia-run.sh DB 直写改造

- [ ] [BEHAVIOR] send_webhook 优先通过 psql INSERT 写入 callback_queue
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const i=c.indexOf('INSERT INTO callback_queue');if(i<0){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] psql 连接设置超时（5 秒内），失败后降级到 HTTP POST curl
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('connect_timeout')){console.error('FAIL: 缺少超时');process.exit(1)}const fn=c.substring(c.indexOf('send_webhook()'));const ins=fn.indexOf('INSERT');const curl=fn.indexOf('curl',ins);if(ins>curl){console.error('FAIL: INSERT 应在 curl 前');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 原有 curl 发送逻辑完整保留作为 fallback 路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const fn=c.substring(c.indexOf('send_webhook()'));if(!fn.includes('curl')&&!fn.includes('WEBHOOK_URL')){console.error('FAIL');process.exit(1)}console.log('PASS')"
