# DoD: Brain ESLint warning 清零

**分支**：cp-04240938-eslint-cleanup

## Definition of Done

- [x] [ARTIFACT] `packages/brain/eslint.config.mjs` 去掉 `crypto: 'readonly'` global（node:crypto import 即可解析）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/eslint.config.mjs','utf8');if(c.includes(\"crypto: 'readonly'\"))process.exit(1)"

- [x] [ARTIFACT] `.github/workflows/ci.yml` `Lint Brain` 步骤 `--max-warnings` 降为 0
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('npx eslint src/ --max-warnings 0'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/alertness/healing.js` 补 `existsSync` import + 删无用常量和 `countClaudeProcesses` import
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/healing.js','utf8');if(!c.includes('readdirSync, readFileSync, existsSync'))process.exit(1);const topImport=c.match(/from '\\.\\.\\/platform-utils\\.js';/);if(!topImport)process.exit(1);if(!c.match(/import \\{ processExists \\} from '\\.\\.\\/platform-utils\\.js';/))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/tick.js` 删未用 imports（getActiveProcessCount/syncOrphanTasksOnStartup/recordSuccess/publishExecutorStatus/getDispatchStats/getParallelAwareness/getTrustScores/getCognitiveSnapshot/getScannerStatus）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const imports=c.slice(0,c.indexOf('\\n\\n'));if(imports.includes('getActiveProcessCount'))process.exit(1);if(imports.includes('syncOrphanTasksOnStartup'))process.exit(1);if(imports.includes('publishExecutorStatus'))process.exit(1);if(imports.includes('getScannerStatus'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/routes/ops.js` 补 `getAllCBStates` 别名 import（from circuit-breaker.getAllStates），删冗余 `exec/promisify/execAsync/createTask/updateTask/readdirSync/resolveRelatedFailureMemories`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8');if(!c.includes('getAllStates as getAllCBStates'))process.exit(1);if(c.includes('const execAsync = promisify(exec)'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/routes/status.js` 补 `WS_EVENTS` import（已在 websocket.js 导出）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes('websocketService, { WS_EVENTS }'))process.exit(1)"

- [x] [BEHAVIOR] ESLint 静态校验 `packages/brain/src/` 残留 0 warning
  Test: manual:node -e "const {execSync}=require('child_process');try{execSync('cd packages/brain && npx eslint src/ --max-warnings 0',{stdio:'pipe'});}catch(e){process.exit(1)}"

- [x] [BEHAVIOR] `packages/brain/src/credential-expiry-checker.js` 补 `createTask` import（line 364 调用未 import 的 no-undef 修复）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/credential-expiry-checker.js','utf8');if(!c.includes(\"import { createTask } from './actions.js'\"))process.exit(1)"

## 成功标准

1. `cd packages/brain && npx eslint src/ --max-warnings 0` exit 0（本地 + CI 均验证）
2. 测试相对 main 无新增失败：vitest run --exclude=integration 结果至少 6780+ passed，failed 数不超过 main 基线（12 failed, harness-parse-tasks 环境敏感）
3. 本次 PR 改动不包含 `// eslint-disable` 也不大改业务逻辑——只做 lint 卫生
