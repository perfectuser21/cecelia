# DoD: 蓝绿 green canary 根治合卡——CANARY_HOST 容器视角 + 防幽灵代理双保险 + smoke 就绪等待 + TEMP_PORT 5230

- [x] [BEHAVIOR] bluegreen.sh 探活与 smoke 目标主机可配置：容器内(/.dockerenv)默认 host.docker.internal，宿主默认 localhost，CANARY_HOST 可覆盖
      Test: manual:bash scripts/__tests__/bluegreen-canary-host.test.sh
- [x] [BEHAVIOR] 不再存在写死 http://localhost:${port} 的金丝雀地址
      Test: manual:bash -c "! grep -n 'http://localhost:\${port}' scripts/lib/bluegreen.sh"
- [x] bluegreen.sh 语法有效
      Test: manual:bash -n scripts/lib/bluegreen.sh
- [x] [BEHAVIOR] 健康 poll 的 curl 命中必须与 docker health 同时成立（防 staging 槽位 5223 幽灵代理把 blue 的 200 当 green）
      Test: manual:node -e "const s=require('fs').readFileSync('scripts/lib/bluegreen.sh','utf8');if(!/hs.*=.*healthy.*&&.*curl|curl.*&&.*healthy/.test(s)&&!s.includes('\"$hs\" = \"healthy\" ] && curl'))process.exit(1)"
- [x] [BEHAVIOR] pre-swap smoke 前有宿主端口就绪等待（≤90s，超时保留 blue）
      Test: manual:node -e "const s=require('fs').readFileSync('scripts/lib/bluegreen.sh','utf8');if(!s.includes('_ready_wait')||!s.includes('healthz'))process.exit(1)"
- [x] [BEHAVIOR] TEMP_PORT 已挪出 dashboard staging 撞港区（5223→5230）
      Test: manual:node -e "const s=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!s.includes('TEMP_PORT=5230')||s.includes('TEMP_PORT=5223'))process.exit(1)"
- [x] 两脚本 bash -n 语法绿
      Test: manual:bash -n scripts/brain-deploy.sh && bash -n scripts/lib/bluegreen.sh
