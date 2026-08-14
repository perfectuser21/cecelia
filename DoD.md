contract_branch: cp-harness-propose-r1-39542db5-rcbb7227b-a4
sprint_dir: sprints/08132021-controller-lease-renewal-r2

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Controller heartbeat 续租 lease（修 30 分钟杀跑）

**范围**: `writeHeartbeat` 续租 CAS + fail-closed；`controllerSessionId` 从创建端经 `launchKernelProcess`→`runKernelMain`→loop 可信透传；真 PG 集成回归永久入 CI；final-e2e 以本轮唯一 run 的新鲜业务行作领域 oracle。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `heartbeat.js` 的 UPDATE 续租 lease（GREATEST）+ CAS WHERE（session+phase）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/heartbeat.js','utf8');if(!(c.includes('controller_lease_expires_at')&&c.includes('GREATEST')&&c.includes('controller_session_id')&&/phase\s+NOT\s+IN/i.test(c)))process.exit(1)"

- [x] [ARTIFACT] `loop.js` 的 `beat()` 携带 `controllerSessionId`（心跳不再仅凭 run_id）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('controllerSessionId'))process.exit(1)"

- [x] [ARTIFACT] `harness-skill-relay.js` 导出 `buildKernelLaunchArgs` 且 `launchKernelProcess` 携 `--controller-session-id`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!(c.includes('buildKernelLaunchArgs')&&c.includes('--controller-session-id')))process.exit(1)"

- [x] [ARTIFACT] `run.js` 的 `parseArgs` 认 `--controller-session-id` 并透传 `runKernelMain`→loop
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/run.js','utf8');if(!(c.includes('--controller-session-id')&&c.includes('controllerSessionId')))process.exit(1)"

- [x] [ARTIFACT] 永久回归文件落位 + 登记进 POSTGRES_INTEGRATION_TESTS（CI brain-integration 跑）
  Test: node -e "const fs=require('fs');fs.accessSync('packages/brain/src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js');const v=fs.readFileSync('packages/brain/vitest.config.js','utf8');if(!v.includes('kernel-controller-lease-renewal.pg.integration.test.js'))process.exit(1)"

- [x] [ARTIFACT] 合同 E2E 的本轮业务写入领域 oracle 有永久回归测试（canonical parser 提取后验 `psql` 新鲜度与状态）
  Test: manual:bash -c 'bash -lc "cd packages/brain && npx vitest run src/__tests__/kernel-controller-lease-renewal-e2e-oracle.test.js --reporter=verbose"'

- [x] [ARTIFACT] INV-2 [禁写死环境]：续租时长复用单一 SSOT，集成测试不另写死秒数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/heartbeat.js','utf8');if(/\b1800\b/.test(c))process.exit(1)"

- [x] [ARTIFACT] INV-6 [日志脱敏]：`heartbeat.js` 不把 controller_session_id 打进日志明文
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/heartbeat.js','utf8');if(/console\.(log|error|warn)[^\n]*controllerSessionId/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash 单行命令，真 PostgreSQL 执行）

- [x] [BEHAVIOR] [L2] B-01: 正确 session 心跳跨 30m 边界 → lease 前移、run 保持 active、reconcile 回收数=0 [接缝×2]
  动作: 建 owned run(lease=1800s)，注入 now=建run+31min 用正确 session 调 writeHeartbeat，紧接 reconcileOwnerlessKernelRuns
  预期观察: writeHeartbeat 返回 rowCount=1；controller_lease_expires_at 前移到 now+1800s（严格晚于 now、未过期）；phase 仍非 done/failed；reconcile 回收列表不含该 run
  等待预算: 0s（注入 now 确定性跨界，无真实等待）
  留证: vitest RED-1 verbose 输出末 5 行（含 ✓ RED-1 / ✓ RED-1b）
  Test: manual:bash -c 'bash -lc "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_test} NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t RED-1 --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-02: 伪造/错误 session 心跳 → CAS rowCount=0、lease 不动，无主 run 仍被 reconcile fail-closed 回收 [接缝×2]
  动作: 建 owned run，注入越界 now 用错误 session 调 writeHeartbeat，再跑 reconcileOwnerlessKernelRuns
  预期观察: rowCount=0；controller_lease_expires_at 不变；reconcile 回收列表含该 run 且其 phase=failed（无主 fail-closed 铁律 INV-9）
  等待预算: 0s
  留证: vitest RED-2 verbose 输出末 5 行（含 ✓ RED-2）
  Test: manual:bash -c 'bash -lc "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_test} NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t RED-2 --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-03: phase=failed 的终态 run 心跳 → rowCount=0、lease 不复活（含 leaseSeconds SSOT 默认）
  动作: 建 owned run 后 finalizeKernelRun 置 failed，再注入越界 now 用正确 session 调 writeHeartbeat（省略 leaseSeconds）
  预期观察: rowCount=0；phase 仍 failed；lease 不变；另一活跃 run 省略 leaseSeconds 时续租量=CONTROLLER_LEASE_DEFAULT_SECONDS(1800s)
  等待预算: 0s
  留证: vitest RED-3 verbose 输出末 5 行（含 ✓ RED-3 / ✓ RED-3b）
  Test: manual:bash -c 'bash -lc "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_test} NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t RED-3 --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-04: controllerSessionId 从创建端可信透传到 detached child（禁止仅凭 run_id 续租，RED-4）
  动作: 跑纯装配单测——parseArgs 解析 --controller-session-id、buildKernelLaunchArgs 构造 argv、resumeToken 透传
  预期观察: 3 个 it 全绿：args.controllerSessionId=传入值；argv 含 --controller-session-id 且其后紧跟同一 sid；argv 含 --run-id 与 --resume-token
  等待预算: 0s
  留证: vitest passthrough verbose 输出（3 passed）
  Test: manual:bash -c 'bash -lc "cd packages/brain && npx vitest run src/__tests__/controller-session-passthrough.test.js --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-05: Golden Path 全链真 PG 端到端（本轮新鲜业务行 oracle + 续租 + CAS fail-closed + reconcile）
  动作: 隔离空库 migration 后，以唯一 task/session 真调 createKernelRun→writeHeartbeat→reconcile；清理前用 psql 绑定本轮 run_id 验业务行，再执行整份真 PG 集成文件
  预期观察: psql count=1 且 created_at 在 5 分钟内、heartbeat/lease 前移、phase=planning、reconcile 不含本 run；RED-1/1b/2/3/3b 全绿
  等待预算: 0s
  留证: final-e2e 输出本轮 run_id 与 OK；vitest 整文件 verbose 输出末 5 行（Tests N passed, 0 failed）
  Test: manual:bash -c 'bash -lc "cd packages/brain && DB_NAME=${DB_NAME:-cecelia_test} NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js --reporter=verbose"'

## Invariant 覆盖（铁律逐条映射，Step 1.3）

- INV-1 [单slot串行] → N/A：本刀不新增并行/跨 slot 调度，单 run 串行心跳。
- INV-2 [禁写死环境] → 见上 ARTIFACT「INV-2」：续租时长复用 `CONTROLLER_LEASE_DEFAULT_SECONDS`，heartbeat.js 不写死 1800；30m 边界用注入 now 而非写死时钟。
- INV-3 [真环境验证] → 见 B-05：续租/CAS/回收全部在真 PostgreSQL 上验证（禁 mock DB 边）。
- INV-4 [多租户默认] → 覆盖：集成测试每例用独立库 + 随机 initiative/task，不共享租户态。
- INV-5 [凭据安全] → N/A：本刀不新增凭据；不落 git/日志。
- INV-6 [日志脱敏] → 见上 ARTIFACT「INV-6」：heartbeat.js 不打印 controller_session_id 明文。
- INV-7 [端点鉴权] → N/A：无新增 HTTP 端点。
- INV-8 [租户隔离] → N/A：无跨租户 SQL。
- INV-9 [无主fail-closed] → 见 B-02：错误/空 session 或终态 run 续租一律 rowCount=0 → fail-closed；无主 run 仍被 reconcile 回收（本刀核心）。
- INV-10 [热修时钟] → N/A：本刀走 default 标准全链（非 hotfix gear），不建共享 validation 时钟。
