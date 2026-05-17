# DoD — Harness 任务标题 dedup 修复

## 问题
harness 链路任务（[Contract] P1 / [Contract Review] R1 等）在 goal_id=null + project_id=null 时，
24h 内重复执行同一功能的 E2E 测试会触发 createTask dedup 检查，导致链路在第二步断裂。

## 修复
在 execution.js 的 harness try 块顶部计算 `plannerShort`（planner_task_id 前 8 字符），
并附加到所有 harness 任务标题后，确保每次 pipeline 运行生成唯一标题。

## DoD

- [x] [ARTIFACT] `plannerShort` 常量已在 execution.js harness try 块顶部定义
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8'); if(!c.includes('plannerShort = (harnessPayload.planner_task_id'))process.exit(1); console.log('OK')"`

- [x] [ARTIFACT] 所有 14 处 harness 任务标题均含 `\${plannerShort}` 后缀
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8'); const m=c.match(/title.*plannerShort/g); console.log('count=',m?m.length:0); if(!m||m.length<14)process.exit(1)"`

- [x] [BEHAVIOR] execution-callback 同一 planner 运行创建的链路任务标题包含 planner ID 前缀，不与其他运行冲突
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8'); const ok=c.includes('[Contract] P1 — \${plannerShort}') && c.includes('[Contract Review] R\${proposeRound} — \${plannerShort}'); console.log(ok?'PASS':'FAIL'); process.exit(ok?0:1)"
