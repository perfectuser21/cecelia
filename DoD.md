contract_branch: cp-05262117-ws-8a6b1b4a-ws1
workstream_index: 1
sprint_dir: sprints/dev-visibility-v3

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: DB migration + notion-push-sync 两函数实现

**范围**: `packages/brain/migrations/284_notion_synced_decisions_contracts.sql`（新建）；`packages/brain/src/notion-push-sync.js`（新增 `pushDecisions`、`pushInitiativeContracts`，在 `runNotionPushSync` 中调用）
**大小**: M（~105 行净增）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在，含两表 `notion_synced_at` 列
  Test: node -e "const fs=require('fs'),p=require('path');const dir='packages/brain/migrations';const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql'));const found=files.some(f=>{const c=fs.readFileSync(p.join(dir,f),'utf8');return c.includes('decisions') && c.includes('notion_synced_at') && c.includes('initiative_contracts');});if(!found)process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `notion-push-sync.js` 含 `pushDecisions` 函数定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');if(!c.includes('async function pushDecisions'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `notion-push-sync.js` 含 `pushInitiativeContracts` 函数定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');if(!c.includes('async function pushInitiativeContracts'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `pushDecisions` 查询 `notion_synced_at IS NULL` 并在成功后更新 `notion_synced_at`
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/notion-push-sync.js\",\"utf8\");
  if(!c.includes(\"async function pushDecisions\")){console.error(\"FAIL: pushDecisions 不存在\");process.exit(1);}
  if(!c.includes(\"notion_synced_at IS NULL\")){console.error(\"FAIL: 缺过滤条件\");process.exit(1);}
  if(!c.includes(\"notion_synced_at=NOW()\") && !c.includes(\"notion_synced_at = NOW()\")){console.error(\"FAIL: 未更新 notion_synced_at\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] `pushInitiativeContracts` 函数体含 `notion_synced_at IS NULL` 过滤 + `notion_synced_at = NOW()` 更新（对齐 `pushDecisions` 实现强度）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/notion-push-sync.js\",\"utf8\");
  const fnIdx=c.indexOf(\"async function pushInitiativeContracts\");
  if(fnIdx===-1){console.error(\"FAIL: pushInitiativeContracts 不存在\");process.exit(1);}
  const afterFn=c.slice(fnIdx);
  const nextFnIdx=afterFn.indexOf(\"async function \", 10);
  const fnBody=nextFnIdx>0?afterFn.slice(0,nextFnIdx):afterFn.slice(0,2000);
  if(!fnBody.includes(\"notion_synced_at IS NULL\")){console.error(\"FAIL: pushInitiativeContracts 缺 IS NULL 过滤\");process.exit(1);}
  if(!fnBody.includes(\"notion_synced_at=NOW()\") && !fnBody.includes(\"notion_synced_at = NOW()\")){console.error(\"FAIL: pushInitiativeContracts 未更新 notion_synced_at\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] `runNotionPushSync` 函数体调用 `pushDecisions(pool, token)` 和 `pushInitiativeContracts(pool, token)`
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/notion-push-sync.js\",\"utf8\");
  const fnStart=c.indexOf(\"export async function runNotionPushSync\");
  if(fnStart===-1){console.error(\"FAIL: runNotionPushSync 不存在\");process.exit(1);}
  const body=c.slice(fnStart);
  if(!body.includes(\"pushDecisions(\")){console.error(\"FAIL: runNotionPushSync 未调 pushDecisions\");process.exit(1);}
  if(!body.includes(\"pushInitiativeContracts(\")){console.error(\"FAIL: runNotionPushSync 未调 pushInitiativeContracts\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] migration 文件同时覆盖 `decisions` 和 `initiative_contracts` 两张表（不只覆盖其中一张）
  Test: manual:bash -c '
  node -e "
  const fs=require(\"fs\"),p=require(\"path\");
  const dir=\"packages/brain/migrations\";
  const files=fs.readdirSync(dir).filter(f=>f.endsWith(\".sql\"));
  const found=files.some(f=>{
    const c=fs.readFileSync(p.join(dir,f),\"utf8\");
    return c.includes(\"decisions\") && c.includes(\"notion_synced_at\") && c.includes(\"initiative_contracts\");
  });
  if(!found){console.error(\"FAIL: migration 未覆盖两表\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] error path — Brain Notion token 不可用时，`pushDecisions` / `pushInitiativeContracts` 静默跳过（`catch` + `warn` 日志，不 throw），与现有 `pushIssues` 行为一致
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/brain/src/notion-push-sync.js\",\"utf8\");
  const hasWarn=c.includes(\"console.warn\");
  const hasCatch=c.includes(\".catch(\") || c.includes(\"} catch\");
  if(!hasWarn || !hasCatch){console.error(\"FAIL: 缺 warn 日志或 catch 错误处理\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK
