---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: map↔画布对齐（画布 stages 由 golden_path 生成 + run 终态回写 step 成熟度）

**范围**: packages/brain 后端 —— map 投影新增画布层（canvas/stage/feature，SSOT=golden_path）+ run 终态回写 step 成熟度 + /api/brain/map 体检表读出。不含 UI 渲染、契约 schema 本体、历史数据迁移工具。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] map-projector.js 导出画布投影引擎 projectGoldenPathCanvas
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/map-projector.js','utf8');if(!c.includes('projectGoldenPathCanvas'))process.exit(1)"

- [ ] [ARTIFACT] map-projection-store.js 导出成熟度回写 writebackStepMaturity
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/map-projection-store.js','utf8');if(!c.includes('writebackStepMaturity'))process.exit(1)"

- [ ] [ARTIFACT] kernel-run-store.js 定义 applyRunTerminalMaturity 且 finalizeKernelRun 终态副作用调用它（生命周期钩子接力）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/kernel-run-store.js','utf8');const defs=(c.match(/applyRunTerminalMaturity/g)||[]).length;if(defs<2)process.exit(1)"

- [ ] [ARTIFACT] 新增 migration 把 'canvas'/'stage' 并入 map_projection_nodes.node_type CHECK
  Test: bash -c 'ls packages/brain/migrations/*.sql | xargs grep -l "map_projection_nodes" | xargs grep -lE "stage" >/dev/null 2>&1 && grep -rlE "'"'"'stage'"'"'" packages/brain/migrations/*.sql >/dev/null 2>&1'

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: 有序 stage 节点由 golden_path steps 投影生成
  动作: 调用 projectGoldenPathCanvas 传入无序两 steps（order_no 2 在前、1 在后，其一含 feature）
  预期观察: 返回 2 个 node_type=stage 节点，按 order_no 升序（首个 order_no=1），并含 canvas 节点、feature 节点、1 条 precedes 边
  等待预算: 0s
  留证: node 命令 stdout（OK 行）
  Test: manual:bash -c 'node --input-type=module -e "import(process.cwd()+String.fromCharCode(47)+\"packages/brain/src/lib/map-projector.js\").then(m=>{const r=m.projectGoldenPathCanvas({scopeKey:\"F1\",ability:{key:\"a\",name:\"A\"},steps:[{key:\"s2\",name:\"S2\",order_no:2},{key:\"s1\",name:\"S1\",order_no:1,features:[{key:\"f1\",name:\"F1\"}]}]});const st=r.nodes.filter(n=>n.node_type===\"stage\");if(st.length!==2)throw new Error(\"count\");if(st[0].attributes.order_no!==1)throw new Error(\"order\");if(!r.nodes.some(n=>n.node_type===\"canvas\"))throw new Error(\"canvas\");if(!r.nodes.some(n=>n.node_type===\"feature\"))throw new Error(\"feature\");if(r.edges.filter(e=>e.edge_type===\"precedes\").length!==1)throw new Error(\"precedes\");console.log(\"OK\")}).catch(e=>{console.error(\"FAIL\",e.message);process.exit(1)})"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: 空 steps 画布为空不报错
  动作: 调用 projectGoldenPathCanvas 传入 steps:[]
  预期观察: 返回 0 个 stage 节点、仅 canvas 节点，不抛异常
  等待预算: 0s
  留证: node 命令 stdout（OK 行）
  Test: manual:bash -c 'node --input-type=module -e "import(process.cwd()+String.fromCharCode(47)+\"packages/brain/src/lib/map-projector.js\").then(m=>{const r=m.projectGoldenPathCanvas({scopeKey:\"F1\",ability:{key:\"a\",name:\"A\"},steps:[]});if(r.nodes.filter(n=>n.node_type===\"stage\").length!==0)throw new Error(\"not empty\");if(!r.nodes.some(n=>n.node_type===\"canvas\"))throw new Error(\"no canvas\");console.log(\"OK\")}).catch(e=>{console.error(\"FAIL\",e.message);process.exit(1)})"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: 成熟度回写落库 + 缺失 step 幂等跳过不写脏 [接缝×2]
  动作: 对真 Postgres 中 seed 的 active projection，调用 writebackStepMaturity（存在 step outcome=done；不存在 step）
  预期观察: 存在 step → DB 中该 stage 节点 attributes.maturity 变 'passing'；不存在 step → 返回 skipped:true 且 stage 节点行数不变、无脏行；全程 tx rollback 无残留
  等待预算: 0s
  留证: verify-writeback.mjs stdout（末行 OK）
  Test: manual:bash -c 'node sprints/09060638-kernel-c07dfadc/tests/verify-writeback.mjs'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: /api/brain/map 暴露画布层节点 + 体检摘要
  动作: seed 一份含 3 个 stage 节点的 active projection 后 GET /api/brain/map?scope=F1
  预期观察: 响应 nodes 含 type=stage 节点（≥3），summary.stages 为 number，summary.stage_maturity 为 object
  等待预算: 0s
  留证: curl 响应 jq 断言输出
  Test: manual:bash -c 'RESP=$(curl -sf "http://127.0.0.1:5221/api/brain/map?scope=F1"); echo "$RESP" | jq -e "(.summary.stages|type==\"number\") and (.summary.stage_maturity|type==\"object\") and ([.nodes[]|select(.type==\"stage\")]|length>=3)"'
  期望: exit 0（true）

- [ ] [BEHAVIOR] [L2] B-05: error path — 缺 scope 返 400 + error 字段
  动作: GET /api/brain/map（不带 scope query）
  预期观察: HTTP 400，响应体含 error.code
  等待预算: 0s
  留证: curl http_code + jq 输出
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/mapnoscope.json -w "%{http_code}" "http://127.0.0.1:5221/api/brain/map"); [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error.code|type==\"string\"" /tmp/mapnoscope.json'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-真验证: 回写效果以 DB 实际 maturity 为准（非「调用即成功」）
  动作: 回写存在 step 后直接 psql 查该 stage 节点 attributes.maturity
  预期观察: DB 中 maturity 值等于本次 outcome 映射值（done→passing），效果确认落到真数据
  等待预算: 0s
  留证: verify-writeback.mjs 内含 psql 复核（末行 OK）
  Test: manual:bash -c 'node sprints/09060638-kernel-c07dfadc/tests/verify-writeback.mjs'
  期望: OK
