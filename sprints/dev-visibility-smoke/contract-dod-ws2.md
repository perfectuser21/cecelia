---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 2: prd-injection-smoke 集成测试

**范围**: 创建 `sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts`，以 vitest 集成测试验证 `buildGeneratorPrompt` prdContent 注入路径（含 prdContent=null 边界情况）+ Brain tasks 查询（`GET /api/brain/tasks/$TASK_ID` + `completed or in_progress`）
**大小**: S（< 80 行）
**依赖**: Workstream 1（集成测试含 smoke-verify.sh 可执行性断言）

## ARTIFACT 条目

- [x] [ARTIFACT] `sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts` 文件存在
  Test: node -e "require('fs').accessSync('sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts')" && echo OK

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] prd-injection-smoke.test.ts 含 buildGeneratorPrompt 函数调用（非空导入 + 调用）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts\",\"utf8\");if(!c.includes(\"buildGeneratorPrompt\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] prd-injection-smoke.test.ts 含 toContain("## Sprint PRD") 断言（验证注入关键词）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts\",\"utf8\");if(!c.includes(\"Sprint PRD\"))process.exit(1);if(!c.includes(\"toContain\")||!c.includes(\"expect\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] prd-injection-smoke.test.ts 含 smoke-verify.sh 存在性断言（边界情况 WS1 前置验证）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts\",\"utf8\");if(!c.includes(\"smoke-verify.sh\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] prd-injection-smoke.test.ts 含 prdContent=null 边界情况测试（prompt 含错误标注，不静默跳过）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts\",\"utf8\");if(!c.includes(\"null\"))process.exit(1);if(!c.includes(\"error\")&&!c.includes(\"ERROR\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] buildGeneratorPrompt(prdContent=null) 实际返回含错误标注的 prompt（不抛异常、不返空字符串）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/harness-utils.js\").then(function(m){var p=m.buildGeneratorPrompt({id:\"x\",title:\"t\",description:\"t\",payload:{dod:[],files:[],parent_task_id:\"p\",logical_task_id:\"w\"}},{prdContent:null});if(typeof p!==\"string\"||p.length===0){console.error(\"FAIL:返回非字符串或空\");process.exit(1)}var l=p.toLowerCase();if(!l.includes(\"error\")&&!p.includes(\"PRD不存在\")&&!p.includes(\"无法读取\")){console.error(\"FAIL:prdContent=null时无错误标注,prompt前80:\"+p.slice(0,80));process.exit(1)}console.log(\"OK\")}).catch(function(e){console.error(\"FAIL:\",e.message);process.exit(1)})"'
  期望: OK

- [x] [BEHAVIOR] prd-injection-smoke.test.ts 含 Brain tasks 查询断言（用 TASK_ID 具体查询 + status == completed or in_progress）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts\",\"utf8\");if(!c.includes(\"TASK_ID\"))process.exit(1);if(!c.includes(\"completed\"))process.exit(1);if(!c.includes(\"in_progress\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] vitest 运行 tests/ws2/ 全部测试通过（WS1+WS3 均完成后）
  Test: manual:bash -c 'node -e "const {spawnSync}=require(\"child_process\");let tid=\"\";try{const cr=spawnSync(\"curl\",[\"-sf\",\"-X\",\"POST\",\"http://localhost:5221/api/brain/tasks\",\"-H\",\"Content-Type: application/json\",\"-d\",\"{\\\"title\\\":\\\"Smoke\\\",\\\"task_type\\\":\\\"harness_generate\\\"}\"],{encoding:\"utf8\",timeout:3000});const d=JSON.parse(cr.stdout||\"{}\"||cr.stderr);if(d.id){tid=d.id;spawnSync(\"curl\",[\"-sf\",\"-X\",\"PATCH\",\"http://localhost:5221/api/brain/tasks/\"+tid,\"-H\",\"Content-Type: application/json\",\"-d\",\"{\\\"status\\\":\\\"completed\\\"}\"],{encoding:\"utf8\",timeout:3000})}}catch(e){}const env={...process.env};if(tid)env.TASK_ID=tid;const vr=spawnSync(\"npx\",[\"vitest\",\"run\",\"../../sprints/dev-visibility-smoke/tests/ws2/\",\"--reporter=verbose\"],{env,encoding:\"utf8\",maxBuffer:2097152,cwd:\"packages/brain\"});vr.status===0?console.log(\"OK\"):process.exit(1)"'
  期望: OK（WS1+WS3 均完成后）
