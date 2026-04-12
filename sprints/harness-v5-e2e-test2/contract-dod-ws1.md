# Contract DoD — Workstream 1: Health 端点添加 active_pipelines 查询

- [ ] [BEHAVIOR] `GET /api/brain/health` 返回 JSON 顶层包含 `active_pipelines` 字段，值为非负整数
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!('active_pipelines' in d))throw new Error('FAIL');if(typeof d.active_pipelines!=='number'||!Number.isInteger(d.active_pipelines)||d.active_pipelines<0)throw new Error('FAIL');console.log('PASS: '+d.active_pipelines)"
- [ ] [BEHAVIOR] `active_pipelines` 值与数据库 `SELECT count(*) FROM tasks WHERE task_type='harness_planner' AND status='in_progress'` 一致
  Test: bash -c 'A=$(curl -sf localhost:5221/api/brain/health|node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))");B=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='"'"'harness_planner'"'"' AND status='"'"'in_progress'"'"'");[ "$A" = "$B" ]&&echo "PASS: $A==$B"||{ echo "FAIL: $A!=$B";exit 1; }'
- [ ] [BEHAVIOR] 仅统计 `task_type='harness_planner'`，其他 harness 类型（harness_generator/harness_evaluator/harness_contract_propose）不计入
  Test: bash -c 'A=$(curl -sf localhost:5221/api/brain/health|node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).active_pipelines))");P=$(psql cecelia -t -A -c "SELECT count(*) FROM tasks WHERE task_type='"'"'harness_planner'"'"' AND status='"'"'in_progress'"'"'");[ "$A" = "$P" ]&&echo "PASS: active_pipelines=$A matches harness_planner only=$P"||{ echo "FAIL: $A!=$P";exit 1; }'
- [ ] [BEHAVIOR] health 端点返回 200 且核心字段（status）不因 active_pipelines 查询而丢失
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.status)throw new Error('FAIL: 缺少 status');if(!('active_pipelines' in d))throw new Error('FAIL: 缺少 active_pipelines');console.log('PASS: status='+d.status+', active_pipelines='+d.active_pipelines)"
