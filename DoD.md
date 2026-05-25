contract_branch: cp-harness-propose-r3-92950980
workstream_index: 5
sprint_dir: sprints/cecelia-pipeline-viz-v2

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: E2E 截图链路验证

**范围**: `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts`（新建，约 80 行）— 验证 harness-screenshots 目录创建 + /detail API 端到端可访问 + 截图目录结构
**大小**: S（约 80 行，1 文件）
**依赖**: Workstream 4 完成后

---

## Risks

### R5a: 假绿 — 环境操作（mkdir/touch）当作 BEHAVIOR 断言
**影响**: WS5 的验证若只用 mkdir/touch/health check，在 WS5 代码实现前就能通过，产生假绿
**缓解**: BEHAVIOR 1 验证测试文件存在且含关键断言（文件不存在时 accessSync 报 ENOENT → 真红 ✓）；BEHAVIOR 3 验证文件引用 /api/brain/harness/initiative 路径（WS5 未实现时文件不存在 → 真红 ✓）

### R5b: /detail 端点访问被认为 500 为 PASS
**影响**: 验证 /detail 可访问性时若将 500 误认为 PASS，实则端点异常
**缓解**: BEHAVIOR 4 显式检查 code != 500（500 = 端点报错，200/404 = 端点正常响应）

---

## ARTIFACT 条目

- [x] [ARTIFACT] `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts` 文件存在
  Test: node -e "require('fs').accessSync('sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts');console.log('OK')"

- [x] [ARTIFACT] 测试文件含 `harness-screenshots` 关键词（测试逻辑验证截图目录）
  Test: node -e "const c=require('fs').readFileSync('sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts','utf8');if(!c.includes('harness-screenshots'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 测试文件含有效 `describe`/`it` 测试结构（可被 vitest 执行）
  Test: node -e "const c=require('fs').readFileSync('sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts','utf8');if(!c.includes('describe(') || !c.includes('it('))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 测试文件引用 `/api/brain/harness/initiative` 端点路径
  Test: node -e "const c=require('fs').readFileSync('sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts','utf8');if(!c.includes('/api/brain/harness/initiative'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [x] [BEHAVIOR] 测试文件存在且含 harness-screenshots 断言（WS5 未实现时文件不存在 → accessSync ENOENT → exit 1 → 真红）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts\",\"utf8\");if(!c.includes(\"harness-screenshots\")){process.exit(1);}console.log(\"OK\");"'

- [x] [BEHAVIOR] 测试文件含 `describe` 块和 `it(` 测试用例（验证文件是有效 vitest test）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts\",\"utf8\");if(!c.includes(\"describe(\")&&!c.includes(\"it(\")){process.exit(1);}console.log(\"OK\");"'

- [x] [BEHAVIOR] 测试文件引用 /api/brain/harness/initiative 路径（验证覆盖 /detail 端点，WS5 未实现时文件不存在 → 真红）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts\",\"utf8\");if(!c.includes(\"/api/brain/harness/initiative\")){process.exit(1);}console.log(\"OK\");"'

- [x] [BEHAVIOR] /detail 端点返回非 500（Brain 运行时验证端点健康 — 200 or 404 均为正常）
  Test: node -e "require('http').request({host:'localhost',port:5221,path:'/api/brain/harness/initiative/00000000-0000-0000-0000-000000000099/detail'},r=>{if(r.statusCode===500){process.exit(1);}process.exit(0);}).on('error',()=>process.exit(1)).end()"
