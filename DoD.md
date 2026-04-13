contract_branch: cp-0413025250-f6f91e22-6e6b-459e-9b35-2923e1
workstream_index: 1
sprint_dir: sprints/harness-v51-validation

- [x] [BEHAVIOR] `GET /api/brain/health` 返回 JSON 包含 `pipeline_version` 字段，值为字符串 `"5.1"`
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(h.pipeline_version!=='5.1')throw new Error('FAIL');console.log('PASS')"
- [x] [BEHAVIOR] Health 端点原有字段（status, uptime, active_pipelines, evaluator_stats, tick_stats, organs, timestamp）保持不变
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const r=['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'];const m=r.filter(k=>!(k in h));if(m.length)throw new Error('FAIL:'+m);console.log('PASS')"
