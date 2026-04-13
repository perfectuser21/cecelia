# Contract DoD — Workstream 1: Health 端点新增 pipeline_version 字段

- [ ] [BEHAVIOR] `GET /api/brain/health` 返回 JSON 包含 `pipeline_version` 字段，值为字符串 `"5.1"`
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(h.pipeline_version!=='5.1')throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Health 端点原有字段（status, uptime, active_pipelines, evaluator_stats, tick_stats, organs, timestamp）保持不变
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const r=['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'];const m=r.filter(k=>!(k in h));if(m.length)throw new Error('FAIL:'+m);console.log('PASS')"
