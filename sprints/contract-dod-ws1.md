# Contract DoD — Workstream 1: Docker 探测模块 + health 端点集成

- [ ] [ARTIFACT] Docker 探测模块文件存在且导出可调用的探测函数
  Test: node -e "const m = require('./packages/brain/src/docker-runtime-probe.js'); if (typeof (m.probe || m.default || m) !== 'function') throw new Error('FAIL: 未导出探测函数'); console.log('OK')"
- [ ] [BEHAVIOR] `GET /api/brain/health` 响应顶层包含 `docker_runtime` 对象，字段类型与枚举值全部符合硬阈值
  Test: curl -sf http://localhost:5221/api/brain/health | node -e "const dr=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).docker_runtime; if(!dr||typeof dr.enabled!=='boolean'||!['healthy','unhealthy','disabled','unknown'].includes(dr.status)||typeof dr.reachable!=='boolean'||!(typeof dr.version==='string'||dr.version===null)||!(typeof dr.error==='string'||dr.error===null))throw new Error('FAIL: docker_runtime 字段不符'); console.log('PASS')"
- [ ] [BEHAVIOR] Docker 不可达时 health 端点返回 200 且耗时 ≤ 3000ms，`reachable=false`/`status=unhealthy`/`error` 非空
  Test: S=$(date +%s%3N); CODE=$(DOCKER_HOST=tcp://127.0.0.1:1 curl -s -o /tmp/h.json -w '%{http_code}' http://localhost:5221/api/brain/health); E=$(date +%s%3N); [ "$CODE" = "200" ] && [ $((E-S)) -le 3000 ] && node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/h.json','utf8')).docker_runtime; if(d.reachable!==false||d.status!=='unhealthy'||typeof d.error!=='string'||d.error.length===0)throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 顶层 `status` 聚合：`docker_runtime.enabled=true && status=unhealthy` 时顶层为 `degraded`
  Test: DOCKER_HOST=tcp://127.0.0.1:1 curl -sf http://localhost:5221/api/brain/health | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(b.docker_runtime.enabled===true&&b.docker_runtime.status==='unhealthy'&&b.status!=='degraded')throw new Error('FAIL: 期望 degraded，实际 '+b.status); console.log('PASS')"
- [ ] [BEHAVIOR] 向后兼容：既有顶层字段（status/uptime/active_pipelines/evaluator_stats/tick_stats/organs/timestamp）与 organs 下五子器官全部保留，类型不变
  Test: curl -sf http://localhost:5221/api/brain/health | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); ['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'].forEach(k=>{if(!(k in b))throw new Error('FAIL missing '+k)}); ['scheduler','circuit_breaker','event_bus','notifier','planner'].forEach(k=>{if(!b.organs[k])throw new Error('FAIL organs.'+k)}); console.log('PASS')"
