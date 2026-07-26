---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel telemetry：逻辑轮次与耗时账本

**范围**: additive migration、attempt-store lineage/时间账本、orphan 收口、task 聚合只读 API、4-run/双租户真 PG fixture、最小 dispatcher metadata 接线
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] next migration 固定为 `packages/brain/migrations/361_kernel_attempt_telemetry.sql`，只含 additive DDL
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/361_kernel_attempt_telemetry.sql','utf8');['logical_cycle_id','attempt_kind','retry_of_attempt_id','restart_reason','workstream_key','time_derived'].forEach(k=>{if(!c.includes(k))process.exit(1)});if(/DROP\\s+(TABLE|COLUMN)|ALTER\\s+COLUMN[\\s\\S]*TYPE/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 独立 query 模块与真实 harness route 已接线
  Test: node -e "require('fs').accessSync('packages/brain/src/orchestrator/attempt-telemetry.js');const c=require('fs').readFileSync('packages/brain/src/routes/harness.routes.js','utf8');if(!c.includes('attempt-telemetry'))process.exit(1)"

- [ ] [ARTIFACT] 两份合同测试永久入库并覆盖真 PG 与冻结边界
  Test: node -e "for(const f of ['sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts','sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts'])require('fs').accessSync(f)"

- [ ] [ARTIFACT] Brain 版本账本统一走仓库根 `scripts/check-version-sync.sh`
  Test: node -e "const fs=require('fs');for(const f of ['packages/brain/package.json','packages/brain/package-lock.json','.brain-versions','DEFINITION.md','packages/brain/DEFINITION.md'])fs.accessSync(f);if(!fs.readFileSync('scripts/check-version-sync.sh','utf8').includes('packages/brain/package.json'))process.exit(1)"

- [ ] [ARTIFACT] scope 文件不得触碰 Commander、Memory、Directive、Actor Inbox、唤醒逻辑或第二流程账本
  Test: node -e "const{execFileSync}=require('child_process');const b=process.env.CONTRACT_BASE_SHA;if(!b)process.exit(1);const a=execFileSync('git',['diff','--name-only',b+'...HEAD'],{encoding:'utf8'}).trim().split('\\n');if(a.some(f=>/commander|memory|directive|actor[-_]?inbox|wake|wakeup/i.test(f)||/migrations\\/.*(run_events|process_ledger|actor_inbox)/i.test(f)))process.exit(1)"

## BEHAVIOR 条目（全部三段式、真实执行）

- [ ] [BEHAVIOR] [L2] 真实隔离 PG 执行 additive migration 两次且不改写 357 既有列
  动作: 在唯一临时 schema 先真执行 migration 357，再执行 migration 361 两次
  预期观察: 六个 telemetry 列存在，357 既有列名/类型/nullability 前后相同，afterEach 删除 schema
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '真实隔离 PG 执行 additive migration 两次且不改写 357 既有列' --reporter=verbose
  期望: exit 0；`TEST_DATABASE_URL` 缺失或非 `_test/_scratch` 时测试明确失败，绝不连接生产库

- [ ] [BEHAVIOR] [L2] 生产库 URL 在创建连接或执行 SQL 前 fail-closed
  动作: 向安全守卫分别传 `cecelia`、`cecelia_dev`、`cecelia_test`
  预期观察: 前两者在创建 PG 连接前抛错，只有 `_test` 通过
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '生产库 URL 在创建连接或执行 SQL 前 fail-closed' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] attempt-store 真写 lineage，新 attempt 严格绑定 retry_of_attempt_id
  动作: 通过真实 `createAttemptStore(client)` 写 initial 与 retry attempt
  预期观察: 两行同 logical cycle/workstream；retry 行 `retry_of_attempt_id` 精确等于 initial id，reason 为结构化 `evaluator_failed`
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t 'attempt-store 真写 lineage' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 真调用 orphan 收口入口覆盖 new owner fencing、多轮、重复 callback、null/false
  动作: 真写 expired running orphan，调用生产 `reconcileExpiredKernelAttempt` 两轮，分别让 provider resume 回 `null`/`false`，再重放旧 owner callback
  预期观察: orphan 只结构化终结一次；无重复 recovery；旧 callback deduped；另一个 live 新 owner attempt 保持 running
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '真调用 orphan 收口入口' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 4-run fixture 锁定时间公式、六 role、derived 与 exact totals
  动作: 在真实 PG 写 4 run / 25 attempt / 2 logical cycle fixture 并调用生产 query
  预期观察: 六 role 全集；judge/reporter derived；每条 active=1000/wait=500/wall=1500；totals=25000/12500/37500，role/workstream sum 对齐
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '4-run fixture 锁定时间公式' --reporter=verbose
  期望: exit 0；禁止任意填 0、空数组 `all()` 或只验 number 类型

- [ ] [BEHAVIOR] [L2] 4/2/5/9/5 raw counts 与 retry/recovery/invalid 损耗可分离
  动作: 查询同一 4-run fixture 的 `raw_counts`、logical cycles 与结构化分类
  预期观察: run/cycle/planner/reviewer/generator/judge 对应 4/2/4/5/9/5；retry=2、recovery=1、invalid=1
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '4-run fixture 锁定时间公式' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 双租户真实 PG fixture 不可交叉读取
  动作: 同一隔离 schema 写 tenant-a/task-a 与 tenant-b/task-b；用 tenant-a 查询两者
  预期观察: task-a 只含 run-a；task-b 返回结构化 `telemetry_not_found`，不以空成功泄露存在性
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '双租户真实 PG fixture 不可交叉读取' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] invalid/retry/recovery 只读结构化字段且响应脱敏
  动作: 在 normal attempt 的 agent text/error_message 注入相反噪声与 secret/token，再查询 telemetry
  预期观察: 噪声不增加分类计数；JSON 不含 `SUPER-SECRET`、bearer、callback_secret_hash、原始 agent 内容
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '双租户真实 PG fixture 不可交叉读取|4-run fixture 锁定时间公式' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] logical_cycle_id 是 string 且 GET telemetry route 注册
  动作: 检查真实 harness router 路由表并对 4-run 响应逐 attempt 验类型
  预期观察: 路径精确为 `/tasks/:task_id/attempt-telemetry`；每个 `logical_cycle_id` 都是 string
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t 'GET /tasks/:task_id/attempt-telemetry|4-run fixture 锁定时间公式' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] GET telemetry 缺 tenant header 明确 400，tenant/task 不匹配不可见
  动作: 对真实 harness router 发不带 `x-tenant-id` 的 GET；并在真 PG query 用 tenant-a 查 tenant-b task
  预期观察: 前者 400 + error string 而非通用 404；后者结构化 `telemetry_not_found`
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t 'GET telemetry 缺 x-tenant-id|双租户真实 PG fixture' --reporter=verbose
  期望: exit 0

- [ ] [BEHAVIOR] [L2] Kernel route/decision/contract frozen metadata 与改动前等价
  动作: 固定 action metadata 快照，并真跑 derive/contract-store/kernel-handlers/callback regression
  预期观察: action→role/skill/readOnly/expectedOutput 逐字段等价；合同批准物化与 Kernel 决策回归全绿
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts -t 'Kernel action 路由元数据|合同冻结' --reporter=verbose
  期望: exit 0

## Invariant 条目（PRD 九条铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 长等 attempt heartbeat 新鲜时不能被收口
  动作: 创建 lease 尚未过期、owner 已更新的 running attempt 并调用收口入口
  预期观察: status/lease_owner/completed_at 保持 `running/new-owner/null`
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '真调用 orphan 收口入口' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-2 watchdog_overdue 恢复 lineage 可追溯
  动作: 真写 retry/recovery attempt
  预期观察: 非 initial attempt 的 `retry_of_attempt_id` 指回同 task 旧 attempt，restart_reason 为结构化枚举
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t 'attempt-store 真写 lineage|真调用 orphan 收口入口' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-3 lease/heartbeat/orphan 时间关系有明确边界
  动作: 同时测试 expired 与 live lease
  预期观察: 只收口 `lease_expires_at < NOW()`，等于或晚于 NOW 的 attempt 不收口
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '真调用 orphan 收口入口' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-4 多轮扫描不重置状态
  动作: 对同一个 orphan 连续调用两次生产收口入口
  预期观察: 终结严格一次，第二轮 no-op
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '真调用 orphan 收口入口' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-5 `null`/`false` 失败分支不被 try/catch 吞掉
  动作: provider resume 分别返回 null 与 false
  预期观察: attempt 结构化终结且重复 callback deduped，不留下 running
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '真调用 orphan 收口入口' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-6 真实 PostgreSQL 接缝 Red→Green
  动作: 在隔离 schema 真跑 migration/store/query/orphan 全套
  预期观察: 所有 PG contract 用例通过并清理 schema
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-7 时间窗口与 lease 不依赖自然语言或魔法兜底
  动作: 跑确定公式、负区间和 live/expired lease fixture
  预期观察: 时间 exact oracle 与 lease 边界同时通过
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '时间公式冻结|真调用 orphan 收口入口' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-8 tenant_id + task_id 双作用域隔离
  动作: 用 tenant-a 交叉查询 tenant-b task
  预期观察: 返回 `telemetry_not_found`，tenant-b attempt id 不可见
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '双租户真实 PG fixture 不可交叉读取' --reporter=verbose

- [ ] [BEHAVIOR] [L2] INV-9 secrets/PII/agent 原始内容不出现在账本 API
  动作: 在 DB 私有列写入 bearer/token/raw-agent-content 后查询
  预期观察: JSON 白名单输出不含任一敏感串
  验证命令: Test: manual:bash node ./node_modules/vitest/vitest.mjs run sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts -t '4-run fixture 锁定时间公式|双租户真实 PG fixture' --reporter=verbose
