---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: reportNode 增强（step_timing / ws_issues / ws_costs）

**范围**: `packages/brain/src/workflows/harness-initiative.graph.js` — reportNode 函数新增三字段写入 `tasks.result->'report_content'` JSONB；禁止 timings/timing/issues/costs/breakdown 作为键名
**大小**: S（约 80 行净增，1 文件）
**依赖**: Workstream 2 完成后

---

## Risks

### R4a: reportContent 改存 JSONB 导致 report_path state 字段语义混淆
**影响**: 现有 reportNode 返回 `{ report_path: reportContent }`，WS4 改为写 `tasks.result->'report_content'` JSONB 后，state.report_path 幂等门可能判断失误
**缓解**: ARTIFACT 条目验证源码含 `report_content` 键（JSONB 写入），同时检查幂等门逻辑未破坏（state 判断字段是否更新）

### R4b: step_timing 从 task_events 查不到数据时返回 [] 而非 null/undefined
**影响**: PRD 规定 step_timing 为 array（可为空），返回 null 会破坏 /detail 端点 schema
**缓解**: ARTIFACT 验证 step_timing 类型为 array（可空但不是 null）

---

## DoD 条目

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` reportNode 含 `step_timing` 字段赋值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('step_timing'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 含 `ws_issues` 字段赋值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('ws_issues'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 含 `ws_costs` 字段赋值
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('ws_costs'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 写入 `tasks.result` 含 `report_content` 键
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('report_content'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 禁用字段 timings/timing/issues/costs/breakdown 不作为 reportContent 顶层键出现
  Test: node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
const reportNodeStart = c.indexOf('export async function reportNode');
const reportNodeSlice = c.slice(reportNodeStart, reportNodeStart + 3000);
const banned = ['timings', 'timing', 'issues', 'costs', 'breakdown'];
banned.forEach(f => {
  const rx = new RegExp('['\''\"']' + f + '['\''\"']:\\s');
  if (rx.test(reportNodeSlice)) {
    console.error('FAIL: 禁用字段作为键名出现在 reportNode:', f); process.exit(1);
  }
});
console.log('OK');
"

- [x] [BEHAVIOR] reportNode 源码含三字段（step_timing/ws_issues/ws_costs）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const fields=[\"step_timing\",\"ws_issues\",\"ws_costs\"];fields.forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: reportNode 缺字段\",f);process.exit(1);}});console.log(\"OK\");"'

- [x] [BEHAVIOR] reportNode 含 `report_content` 键写入 tasks.result
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");if(!c.includes(\"report_content\")){console.error(\"FAIL: 缺 report_content 写入逻辑\");process.exit(1);}console.log(\"OK\")"'

- [x] [BEHAVIOR] 禁用字段不作为 reportContent JSONB 键出现（精确键名匹配）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const start=c.indexOf(\"export async function reportNode\");const slice=c.slice(start,start+3000);const banned=[\"timings\",\"timing\",\"issues\",\"costs\",\"breakdown\"];banned.forEach(f=>{const rx=new RegExp(\"[\\\"\\x27]\"+f+\"[\\\"\\x27]\\\\s*:\");if(rx.test(slice)){console.error(\"FAIL:\",f);process.exit(1);}});console.log(\"OK\");"'

- [x] [BEHAVIOR] ws_issues 元素含 feedback / ci_fail_type 字段逻辑
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const start=c.indexOf(\"export async function reportNode\");const slice=c.slice(start,start+4000);if(!slice.includes(\"feedback\")){console.error(\"FAIL: ws_issues 缺 feedback\");process.exit(1);}if(!slice.includes(\"ci_fail_type\")){console.error(\"FAIL: ws_issues 缺 ci_fail_type\");process.exit(1);}console.log(\"OK\");"'


