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

- [x] [ARTIFACT] ws_issues 元素含 feedback / ci_fail_type 字段逻辑
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const start=c.indexOf(\"export async function reportNode\");const slice=c.slice(start,start+4000);if(!slice.includes(\"feedback\")){console.error(\"FAIL: ws_issues 缺 feedback\");process.exit(1);}if(!slice.includes(\"ci_fail_type\")){console.error(\"FAIL: ws_issues 缺 ci_fail_type\");process.exit(1);}console.log(\"OK\");"'
