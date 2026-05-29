---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: Planner 节点异步化（spawnDockerDetached + interrupt）

**范围**: 改造 `packages/brain/src/workflows/harness-initiative.graph.js` 的 `runPlannerNode`：将 `reconnectOrSpawn` 改为 `spawnDockerDetached` + 写 `walking_skeleton_thread_lookup` + `interrupt()` 挂起 graph
**大小**: M (~100 行净改，1 文件)
**依赖**: WS1 完成后

## ARTIFACT 条目

- [x] [ARTIFACT] `harness-initiative.graph.js` 文件顶部 imports 包含 `spawnDockerDetached`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!c.includes('spawnDockerDetached'))process.exit(1)"

- [x] [ARTIFACT] `runPlannerNode` 函数体内不再含 `reconnectOrSpawn` 调用（已移除阻塞）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); const start=c.indexOf('export async function runPlannerNode'); const end=c.indexOf('\nexport ',start+1); const fn=c.slice(start,end>0?end:start+4000); if(fn.includes('reconnectOrSpawn'))process.exit(1)"

- [x] [ARTIFACT] `runPlannerNode` 函数体内含 `interrupt()` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); const start=c.indexOf('export async function runPlannerNode'); const end=c.indexOf('\nexport ',start+1); const fn=c.slice(start,end>0?end:start+4000); if(!fn.includes('interrupt'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] harness-initiative.graph.js 导入并使用 spawnDockerDetached（WS2 实现前文件中不含此符号，FAIL → 真红）
  Test: manual:bash -c 'grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-initiative.graph.js || { echo "FAIL: harness-initiative.graph.js 未用 spawnDockerDetached"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] runPlannerNode 函数体移除阻塞调用（函数体不含 reconnectOrSpawn）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\"); const start=c.indexOf(\"export async function runPlannerNode\"); if(start<0){console.error(\"FAIL: runPlannerNode not found\");process.exit(1)} const end=c.indexOf(\"\nexport \",start+1); const fn=c.slice(start,end>0?end:start+4000); if(fn.includes(\"reconnectOrSpawn\")){console.error(\"FAIL: runPlannerNode 仍含阻塞 reconnectOrSpawn\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] runPlannerNode 函数体含 interrupt() 调用（挂起 graph，非阻塞返回）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\"); const start=c.indexOf(\"export async function runPlannerNode\"); if(start<0){console.error(\"FAIL: 函数不存在\");process.exit(1)} const end=c.indexOf(\"\nexport \",start+1); const fn=c.slice(start,end>0?end:start+4000); if(!fn.includes(\"interrupt\")){console.error(\"FAIL: runPlannerNode 缺 interrupt()\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] harness-initiative.graph.js 含 thread_lookup 写入逻辑（Planner 容器 ID 映射，实现前文件无此逻辑）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\"); if(!c.includes(\"walking_skeleton_thread_lookup\") && !c.includes(\"harness-thread-lookup\")){console.error(\"FAIL: 缺 thread_lookup 写入\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] error path — runPlannerNode 在 spawnDockerDetached 失败时返回 error 对象（不崩溃 graph）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\"); const start=c.indexOf(\"export async function runPlannerNode\"); const end=c.indexOf(\"\nexport \",start+1); const fn=c.slice(start,end>0?end:start+4000); if(!fn.includes(\"catch\") && !fn.includes(\"error\")){console.error(\"FAIL: runPlannerNode 缺少错误处理\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK
