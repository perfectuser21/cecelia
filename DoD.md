# DoD — Harness Evaluator 执行环境三处修复

**范围**: `evaluateContractNode` 按 target_environment 路由（mac_web→host / 其余→docker）+ 补 WECHAT_RPA_WORKFLOW；Dockerfile 加 postgresql-client；新增 sync-skills-snapshot.sh。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] harness-task.graph.js 导入 executeOnHost（host 执行器接通）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes(\"from '../spawn/host-executor.js'\"))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] harness-task.graph.js 导入 readAndValidateBrainResult（host 路径读 verdict）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('readAndValidateBrainResult'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] Dockerfile 安装 postgresql-client（psql 合同验证命令可用）
  Test: manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/Dockerfile','utf8');if(!c.includes('postgresql-client'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] scripts/sync-skills-snapshot.sh 存在且列出 6 个 harness skill
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/sync-skills-snapshot.sh','utf8');['harness-planner','harness-contract-proposer','harness-contract-reviewer','harness-generator','harness-evaluator','harness-report'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] evaluateContractNode 按 targetEnv 路由：mac_web 走 executeOnHost，源码含 `if (targetEnv === 'mac_web')` 分支
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes(\"targetEnv === 'mac_web'\")||!c.includes('opts.executeOnHost'))process.exit(1);console.log('OK')"

- [x] [BEHAVIOR] host 路径用 localhost（host.docker.internal 不可解析），含 `BRAIN_URL: 'http://localhost:5221'` 与 `postgresql://localhost/cecelia`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes(\"'http://localhost:5221'\")||!c.includes('postgresql://localhost/cecelia'))process.exit(1);console.log('OK')"

- [x] [BEHAVIOR] 两条路径都注入 WECHAT_RPA_WORKFLOW（共享 baseEvalEnv）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('WECHAT_RPA_WORKFLOW'))process.exit(1);console.log('OK')"

- [x] [BEHAVIOR] 路由 vitest 测试文件存在且覆盖 mac_web→host / local_api→docker 回归 / WECHAT_RPA_WORKFLOW 三场景（brain-unit CI job 实跑）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-task-evaluator-host-routing.test.js','utf8');['executeOnHost','spawnDetached','local_api','WECHAT_RPA_WORKFLOW'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('OK')"
