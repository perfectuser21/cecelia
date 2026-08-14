---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Controller heartbeat 续租 lease（修 30 分钟杀跑）

**范围**: `writeHeartbeat` 续租 CAS + parent task 非终态原子绑定 + fail-closed；`controllerSessionId` 可信透传；locale-independent POSIX+Unicode whitespace ownership invariant；续租/recovery 审计原子幂等；migration 416；CodeQL 动态正则；Preview `starting` 端口冲突；真 PG/actual CLI/永久 CI 回归；final-e2e 以本轮唯一 run 和事件作领域 oracle。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `heartbeat.js` 复用 whitespace SSOT，按 task→run 锁序线性化父 task 终态，再以 session+phase+非终态 CAS 续租 lease（GREATEST）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/heartbeat.js','utf8');const required=['CONTROLLER_SESSION_BLANK_SQL_PATTERN','FOR UPDATE OF parent_task','UPDATE initiative_runs AS run','GREATEST(','parent_task.status NOT IN','run.controller_session_id =','run.controller_session_id !~','run.phase NOT IN'];const imported=/import\s*\{[^}]*CONTROLLER_SESSION_BLANK_SQL_PATTERN[^}]*\}\s*from '.\/kernel-run-store\.js'/s.test(c);if(!(imported&&required.every((text)=>c.includes(text))&&c.indexOf('FOR UPDATE OF parent_task')<c.indexOf('UPDATE initiative_runs AS run')))process.exit(1)"

- [x] [ARTIFACT] `loop.js` 的 `beat()` 携带 `controllerSessionId`（心跳不再仅凭 run_id）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('controllerSessionId'))process.exit(1)"

- [x] [ARTIFACT] `harness-skill-relay.js` 导出 `buildKernelLaunchArgs` 且 `launchKernelProcess` 携 `--controller-session-id`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!(c.includes('buildKernelLaunchArgs')&&c.includes('--controller-session-id')))process.exit(1)"

- [x] [ARTIFACT] `run.js` 的 `parseArgs` 认 `--controller-session-id` 并透传 `runKernelMain`→loop
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/run.js','utf8');if(!(c.includes('--controller-session-id')&&c.includes('controllerSessionId')))process.exit(1)"

- [x] [ARTIFACT] lease、actual CLI、migration 416 三份真 PG 永久回归均落位并登记进 POSTGRES_INTEGRATION_TESTS（CI brain-integration 跑）
  Test: node -e "const fs=require('fs');const tests=['kernel-controller-lease-renewal.pg.integration.test.js','kernel-cli-ownership-preaction.pg.integration.test.js','migration-416-controller-session-nonblank.pg.integration.test.js'];for(const f of tests)fs.accessSync('packages/brain/src/__tests__/integration/'+f);const v=fs.readFileSync('packages/brain/vitest.config.js','utf8');if(tests.some((f)=>!v.includes(f)))process.exit(1)"

- [x] [ARTIFACT] 本 sprint 新增/拆出的 JavaScript 测试与真 PG helper 均由永久机械门禁约束为单文件不超过 500 行
  Test: manual:bash -c 'bash -lc "cd packages/brain && npx vitest run src/__tests__/kernel-controller-lease-renewal-file-size.test.js --reporter=verbose"'

- [x] [ARTIFACT] 合同 E2E 的本轮业务写入领域 oracle 有永久回归测试（canonical parser 提取后验 `psql` 新鲜度与状态）
  Test: manual:bash -c 'bash -lc "cd packages/brain && npx vitest run src/__tests__/kernel-controller-lease-renewal-e2e-oracle.test.js --reporter=verbose"'

- [x] [ARTIFACT] INV-2 [禁写死环境]：续租时长复用单一 SSOT，集成测试不另写死秒数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/heartbeat.js','utf8');if(/\b1800\b/.test(c))process.exit(1)"

- [x] [ARTIFACT] INV-6 [日志脱敏]：`heartbeat.js` 不把 controller_session_id 打进日志明文
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/heartbeat.js','utf8');if(/console\.(log|error|warn)[^\n]*controllerSessionId/.test(c))process.exit(1)"

- [x] [ARTIFACT] migration 416 与 rollback 资产存在，up 用 POSIX+完整 Unicode whitespace helper 做 locale-independent 历史归一 + validated nonblank CHECK，down 移除 CHECK/helper
  Test: node -e "const fs=require('fs');const up=fs.readFileSync('packages/brain/migrations/416_controller_session_nonblank.sql','utf8');const down=fs.readFileSync('packages/brain/migrations/rollback/416_controller_session_nonblank.down.sql','utf8');const fn='cecelia_controller_session_is_blank';const start=up.indexOf('CREATE OR REPLACE FUNCTION '+fn),end=up.indexOf(String.fromCharCode(36,36,59),start),helper=up.slice(start,end),slash=String.fromCharCode(92);const points=['0085','00A0','1680','2028','2029','202F','205F','3000','FEFF'];const unicode=points.every((point)=>helper.includes(slash+point))&&helper.includes(slash+'2000-'+slash+'200A');const cleanup=up.includes('SET controller_session_id = NULL')&&up.includes(fn+'(controller_session_id)');const check=up.includes('ADD CONSTRAINT initiative_runs_controller_session_nonblank_check')&&up.includes('NOT VALID')&&up.includes('VALIDATE CONSTRAINT initiative_runs_controller_session_nonblank_check');const rollback=down.includes('DROP CONSTRAINT IF EXISTS initiative_runs_controller_session_nonblank_check')&&down.includes('DROP FUNCTION IF EXISTS '+fn+'(text)');if(!(start>=0&&end>start&&helper.includes('[[:space:]')&&unicode&&cleanup&&check&&rollback))process.exit(1)"

- [x] [ARTIFACT] CodeQL high 回归禁止 `shortTask` 拼入动态 RegExp，legacy 分支用静态 capture + 字符串比较
  Test: manual:bash -c 'bash -lc "cd packages/brain && npx vitest run src/orchestrator/__tests__/ground-truth.test.js -t \"CodeQL 回归|仅为当前 run 的严格 Proposer\""'

- [x] [ARTIFACT] 两份 sprint frozen tests 哈希保持批准值不变
  Test: manual:bash -c 'bash -lc "test \"$(shasum -a 256 sprints/08132021-controller-lease-renewal-r2/tests/controller-session-passthrough.test.js | awk '\''{print $1}'\'')\" = 5e8c33dd6a8b0301621438086508d33b4d090acaf918d2b96c6c48707eb93761 && test \"$(shasum -a 256 sprints/08132021-controller-lease-renewal-r2/tests/kernel-controller-lease-renewal.pg.integration.test.js | awk '\''{print $1}'\'')\" = 929eeb827014f45db4b00b49f198eb845c6546c6fd84e1d37896ab945c57cce0"'

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

- [x] [BEHAVIOR] [L2] B-06: 成功续租/recovery 审计与状态原子提交、同 hop 幂等，错误 session/终态/guardRejected 零假事件且 payload 无 session
  动作: 真 PG 执行 AUDIT-1/2/3 与 RACE-A；同 heartbeat_at 重放，并用触发器强制两类审计 INSERT 失败
  预期观察: 两类成功事件各 count=1；同 hop 不重复；错误 session/终态/guardRejected 对应事件 count=0；强制 INSERT 失败后 lease、heartbeat、run/task 终态均回滚；payload 不含 controller session
  等待预算: 0s
  留证: vitest AUDIT/RACE verbose 输出与 DB count/payload assertion
  Test: manual:bash -c 'bash -lc "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t \"AUDIT-[123]|RACE-A:\" --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-07: Preview `starting` 记录端口被外部 listener 占用时，在 admission 锁内重新分配并持久化
  动作: 真 PG seed `starting` 记录并令端口探针报告当前端口冲突，再调用 admitPreview
  预期观察: 返回 admitted=true 且新 port 不等于冲突端口，DB 同一行 port 与返回值一致、status=starting
  等待预算: 0s
  留证: capacity-gate integration regression 输出
  Test: manual:bash -c 'bash -lc "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/capacity-gate.test.js -t \"Preview 回归\" --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-08: actual Node CLI 在 Controller ownership 栅栏前 fail-closed，正确 session 才激活 task
  动作: 真 PostgreSQL seed queued task/run，分别以错误、空白、缺失、不存在和正确 session 启动 actual `node src/orchestrator/run.js` 子进程
  预期观察: 前四类均 exit 2/controller_lease_lost，task 仍 queued，started_at/heartbeat/decision/attempt/event 均不推进；正确 session exit 0 且 task 激活为 in_progress
  等待预算: 15s/子进程
  留证: actual CLI integration verbose 输出（5 passed）与真 PG 后验
  Test: manual:bash -c 'bash -lc "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-cli-ownership-preaction.pg.integration.test.js --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-09: migration 416 真 PG upgrade/rollback/re-upgrade 与重复执行幂等
  动作: 隔离真库回到 415 后 seed 历史空串/空白 ownership，依次执行 upgrade、第二次 upgrade、rollback、re-upgrade、第二次 re-upgrade
  预期观察: 两次首次应用均归一历史空白为 NULL 并得到 validated nonblank CHECK；rollback 真移除 CHECK/schema_version 416；两次重复 upgrade 均无新 migration 且约束仅一份
  等待预算: 0s（本地隔离库直接执行）
  留证: migration 416 integration verbose 输出及 schema_version/pg_constraint/真实空白写入后验
  Test: manual:bash -c 'bash -lc "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-416-controller-session-nonblank.pg.integration.test.js -t MIGRATION-C --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-10: parent task 为 cancelled/completed 时 active planning run 心跳零推进
  动作: 真 PostgreSQL 建 owned planning run，将 parent task 分别置 cancelled/completed，再用正确 session 调 writeHeartbeat
  预期观察: 两例 rowCount=0；run 仍 planning；orchestrator_heartbeat_at 仍 NULL；lease 不动；续租事件 count=0
  等待预算: 0s
  留证: `TASK-TERMINAL-CANCELLED:` 与 `TASK-TERMINAL-COMPLETED:` verbose 输出（2 passed）
  Test: manual:bash -c 'bash -lc "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lease-renewal.pg.integration.test.js -t TASK-TERMINAL- --reporter=verbose"'

- [x] [BEHAVIOR] [L2] B-11: JS 创建、migration 416 与 heartbeat 对 TAB/NBSP/ideographic space 使用同一非空白语义
  动作: 真 PostgreSQL 依次验证 JS 创建拒绝、历史纯空白归一为 NULL、新写 CHECK 23514、rollback 窗口同值参数/历史行 heartbeat rowCount=0
  预期观察: `CREATE-SESSION-C:`、`NEW-WRITE-C:`、`BLANK-C:` 3/3 通过；TAB/NBSP/ideographic space 均无 lease/heartbeat/event 推进
  等待预算: 0s
  留证: migration whitespace integration verbose 输出（3 passed）
  Test: manual:bash -c 'bash -lc "cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-416-controller-session-nonblank.pg.integration.test.js -t \"CREATE-SESSION-C|NEW-WRITE-C|BLANK-C\" --reporter=verbose"'

## Invariant 覆盖（铁律逐条映射，Step 1.3）

- INV-1 [单slot串行] → N/A：本刀不新增并行/跨 slot 调度，单 run 串行心跳。
- INV-2 [禁写死环境] → 见上 ARTIFACT「INV-2」：续租时长复用 `CONTROLLER_LEASE_DEFAULT_SECONDS`，heartbeat.js 不写死 1800；30m 边界用注入 now 而非写死时钟。
- INV-3 [真环境验证] → 见 B-05：续租/CAS/回收全部在真 PostgreSQL 上验证（禁 mock DB 边）。
- INV-4 [多租户默认] → 覆盖：集成测试每例用独立库 + 随机 initiative/task，不共享租户态。
- INV-5 [凭据安全] → 见 B-06：controller session 不落 git、日志或 `cecelia_events.payload`。
- INV-6 [日志脱敏] → 见上 ARTIFACT「INV-6」与 B-06：heartbeat.js 不打印 controller_session_id，事件 payload 也不包含它。
- INV-7 [端点鉴权] → N/A：无新增 HTTP 端点。
- INV-8 [租户隔离] → N/A：无跨租户 SQL。
- INV-9 [无主fail-closed] → 见 B-02/B-10/B-11：错误/纯空白 session、终态 run 或终态 parent task 续租一律 rowCount=0 → fail-closed；无主 run 仍被 reconcile 回收（本刀核心）。
- INV-10 [热修时钟] → N/A：本刀走 default 标准全链（非 hotfix gear），不建共享 validation 时钟。
