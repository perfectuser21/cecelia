contract_branch: cp-harness-propose-r3-92950980
workstream_index: 4
sprint_dir: sprints/cecelia-pipeline-viz-v2

# DoD — WS4: reportNode 增强（step_timing / ws_issues / ws_costs）

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` reportNode 含 `step_timing` 字段赋值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('step_timing'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 含 `ws_issues` 字段赋值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('ws_issues'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 含 `ws_costs` 字段赋值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('ws_costs'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 写入 `tasks.result` 含 `report_content` 键
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('report_content'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 禁用字段 timings/timing/issues/costs/breakdown 不作为 reportContent 顶层键出现
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const start=c.indexOf(\"export async function reportNode\");const slice=c.slice(start,start+3000);const banned=[\"timings\",\"timing\",\"issues\",\"costs\",\"breakdown\"];banned.forEach(f=>{const rx=new RegExp(\"[\\\"\\x27]\"+f+\"[\\\"\\x27]\\\\s*:\");if(rx.test(slice)){console.error(\"FAIL:\",f);process.exit(1);}});console.log(\"OK\");"'

## BEHAVIOR 条目

- [x] [BEHAVIOR] reportNode 源码含三字段（step_timing/ws_issues/ws_costs），WS4 未实现时 grep 返回 exit 1 → 真红
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const fields=[\"step_timing\",\"ws_issues\",\"ws_costs\"];fields.forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: reportNode 缺字段\",f);process.exit(1);}});console.log(\"OK\")"'

- [x] [BEHAVIOR] reportNode 含 `report_content` 键写入 tasks.result（WS4 未实现时字符串不存在 → exit 1 → 真红）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");if(!c.includes(\"report_content\")){console.error(\"FAIL: 缺 report_content 写入逻辑\");process.exit(1);}console.log(\"OK\")"'

- [x] [BEHAVIOR] 禁用字段（timings/timing/issues/costs/breakdown）不作为 reportContent JSONB 键出现（精确键名匹配，不误杀 ws_issues/ws_costs/step_timing）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const start=c.indexOf(\"export async function reportNode\");const slice=c.slice(start,start+3000);const banned=[\"timings\",\"timing\",\"issues\",\"costs\",\"breakdown\"];banned.forEach(f=>{const rx=new RegExp(\"[\\\"\\x27]\"+f+\"[\\\"\\x27]\\\\s*:\");if(rx.test(slice)){console.error(\"FAIL: 禁用字段作为独立键名出现在 reportNode 上下文:\",f);process.exit(1);}});console.log(\"OK\")"'

- [x] [BEHAVIOR] ws_issues 元素含 ws_id / feedback / ci_fail_type 字段描述（源码逻辑验证）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const start=c.indexOf(\"export async function reportNode\");const slice=c.slice(start,start+4000);if(!slice.includes(\"feedback\")){console.error(\"FAIL: ws_issues 缺 feedback 字段\");process.exit(1);}if(!slice.includes(\"ci_fail_type\")){console.error(\"FAIL: ws_issues 缺 ci_fail_type 字段\");process.exit(1);}console.log(\"OK\")"'
