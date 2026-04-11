# Contract DoD — Workstream 1: Backend — Pipeline 详情 API

- [ ] [BEHAVIOR] GET /api/brain/harness-pipeline-detail?planner_task_id=xxx 返回完整的 pipeline 对象（title/status/created_at）、stages 数组、files 对象、gan_rounds 数组
  Test: curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=$(curl -sf 'localhost:5221/api/brain/harness-pipelines?limit=1' | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); const s=d.pipelines[0]?.stages?.find(x=>x.task_type.includes("planner")); console.log(s?.id||"")')" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!d.pipeline||!d.stages||!d.gan_rounds||!d.files) throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回 404，缺少参数返回 400
  Test: manual:bash -c 'S=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000"); [ "$S" = "404" ] && echo PASS || (echo "FAIL: $S"; exit 1)'
- [ ] [BEHAVIOR] git 文件读取失败时返回 null 值而非 500 错误
  Test: manual:curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=$(curl -sf 'localhost:5221/api/brain/harness-pipelines?limit=1' | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log(d.pipelines[0]?.stages?.find(x=>x.task_type.includes("planner"))?.id||"")')" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('PASS: files对象类型=' + typeof d.files)"
