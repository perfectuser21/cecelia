---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: buildGeneratorPrompt prdContent + runSubTaskNode 传递链

**范围**: `packages/brain/src/harness-utils.js`（`buildGeneratorPrompt` 加 `prdContent` 参数 + 条件注入段落）；`packages/brain/src/workflows/harness-initiative.graph.js`（`runSubTaskNode` 在 `compiled.invoke` 时传 `prdContent`）；`packages/brain/src/workflows/harness-task.graph.js`（`TaskState` 加 `prdContent` Annotation；`spawnNode` 传 `prdContent` 到 `buildGeneratorPrompt`）
**大小**: S（~25 行净增/修改，3 文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `harness-utils.js buildGeneratorPrompt` 签名含 `prdContent`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');if(!c.includes('prdContent'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `harness-task.graph.js TaskState` 含 `prdContent` Annotation
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('prdContent'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `harness-initiative.graph.js runSubTaskNode` 函数体含 `prdContent`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const idx=c.indexOf('export async function runSubTaskNode');if(idx===-1)process.exit(1);if(!c.slice(idx,idx+3000).includes('prdContent'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `buildGeneratorPrompt` 接受 `prdContent` 参数，非空时 prompt 包含 `## Sprint PRD` 标识
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-utils.js\",\"utf8\");
  if(!c.includes(\"prdContent\")){console.error(\"FAIL: prdContent 参数不存在\");process.exit(1);}
  if(!c.includes(\"Sprint PRD\") && !c.includes(\"sprint_prd\")){console.error(\"FAIL: Sprint PRD 段标识不存在\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] `prdContent` 为 null/空时，`buildGeneratorPrompt` 跳过该段（代码含条件判断 `if(prdContent)` 或等价写法）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-utils.js\",\"utf8\");
  // 函数体必须有条件判断保护，防止空段注入
  const hasPrdGuard=(c.includes(\"prdContent ?\") || c.includes(\"prdContent &&\") || c.includes(\"if (prdContent\") || c.includes(\"if(prdContent\"));
  if(!hasPrdGuard){console.error(\"FAIL: 缺 prdContent 空值保护逻辑\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] `harness-task.graph.js spawnNode` 把 `prdContent` 传给 `buildGeneratorPrompt`（调用点含两个参数）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-task.graph.js\",\"utf8\");
  if(!c.includes(\"prdContent\")){console.error(\"FAIL: harness-task.graph.js 未含 prdContent\");process.exit(1);}
  // buildGeneratorPrompt 调用点附近必须含 prdContent
  const callIdx=c.indexOf(\"buildGeneratorPrompt(\");
  if(callIdx===-1){console.error(\"FAIL: buildGeneratorPrompt 调用点不存在\");process.exit(1);}
  const callCtx=c.slice(callIdx,callIdx+200);
  if(!callCtx.includes(\"prdContent\")){console.error(\"FAIL: buildGeneratorPrompt 调用点未传 prdContent\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] `runSubTaskNode` 在 `compiled.invoke` 调用处传 `prdContent: state.prdContent`
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");
  const fnIdx=c.indexOf(\"export async function runSubTaskNode\");
  if(fnIdx===-1){console.error(\"FAIL: runSubTaskNode 不存在\");process.exit(1);}
  const fnBody=c.slice(fnIdx,fnIdx+3000);
  if(!fnBody.includes(\"prdContent\")){console.error(\"FAIL: runSubTaskNode 未含 prdContent\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] error path — `prdContent` 为 null 时 `buildGeneratorPrompt` 不抛错，仍返回有效 prompt 字符串（代码兜底存在）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-utils.js\",\"utf8\");
  // 验证 buildGeneratorPrompt 签名有默认值或 null 保护
  const hasDefault=(c.includes(\"prdContent = null\") || c.includes(\"prdContent=null\") || c.includes(\"prdContent = undefined\") || c.includes(\"{ fixMode = false, prdContent\") || c.includes(\"{fixMode=false,prdContent\"));
  const hasGuard=(c.includes(\"prdContent ?\") || c.includes(\"prdContent &&\") || c.includes(\"if (prdContent\") || c.includes(\"if(prdContent\"));
  if(!hasDefault && !hasGuard){console.error(\"FAIL: 缺 prdContent null 安全处理\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK
