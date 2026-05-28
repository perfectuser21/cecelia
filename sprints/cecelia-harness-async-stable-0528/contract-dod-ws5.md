---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 5: Intervention Handler + task-router 注册

**范围**: 新建 `packages/brain/src/harness-intervention-handler.js`（读 Docker logs，调 Brain LLM 客户端分析，返回 action=retry/skip/alert 写入 task result）；修改 `packages/brain/src/task-router.js` 注册 handler。
**大小**: M (~140 行，2 文件)
**依赖**: WS4 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/harness-intervention-handler.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/harness-intervention-handler.js')"

- [ ] [ARTIFACT] handler 含 `action` 字段输出（retry/skip/alert 之一）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8'); if(!c.includes('action'))process.exit(1)"

- [ ] [ARTIFACT] handler 含 docker logs 读取逻辑（通过 container_id 查 thread_lookup）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8'); if(!c.includes('docker') && !c.includes('logs') && !c.includes('container'))process.exit(1)"

- [ ] [ARTIFACT] `task-router.js` 路由 `harness_intervention` 到 `harness-intervention-handler.js`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8'); if(!c.includes('harness-intervention-handler'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] harness-intervention-handler.js 文件存在（实现前不存在 → 真红）
  Test: manual:bash -c 'node -e "require(\"fs\").accessSync(\"packages/brain/src/harness-intervention-handler.js\")" || { echo "FAIL: harness-intervention-handler.js 不存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] handler 含 action 字段逻辑（retry/skip/alert）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-intervention-handler.js\",\"utf8\"); if(!c.includes(\"action\")){console.error(\"FAIL: 缺 action 字段\");process.exit(1)} const hasActions=c.includes(\"retry\")||c.includes(\"skip\")||c.includes(\"alert\"); if(!hasActions){console.error(\"FAIL: 缺 retry/skip/alert 动作值\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] task-router.js 注册 harness_intervention → harness-intervention-handler（路由前 task-router 不含此路径 → 真红）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/task-router.js\",\"utf8\"); if(!c.includes(\"harness-intervention-handler\")){console.error(\"FAIL: task-router 未注册 harness-intervention-handler\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] error path — handler 含 try-catch（LLM 分析失败时不崩溃，返回 action=alert）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-intervention-handler.js\",\"utf8\"); if(!c.includes(\"catch\") && !c.includes(\"try\")){console.error(\"FAIL: handler 缺错误处理\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] handler 含 LLM 客户端调用（使用现有 Brain LLM 客户端，不引入新外部依赖）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-intervention-handler.js\",\"utf8\"); if(!c.includes(\"llm\") && !c.includes(\"anthropic\") && !c.includes(\"claude\") && !c.includes(\"LLM\")){console.error(\"FAIL: handler 缺 LLM 调用\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK
