---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Fleet Worker 实例 ownership fence 与 quarantined attempt 确定终态

**范围**: 容器 ownership 加稳定 instance namespace（data root 派生/持久化）+ reconcile 只作用本实例 namespace + 旧容器 fail-closed；`quarantined` expired attempt 一次事务 failed(专属 error_code)+append-only evidence+允许 replacement；幂等。
**大小**: M

> 以下 [BEHAVIOR] 均在真实目标（真实 Docker daemon / 真实 PostgreSQL）上验证，禁 mock 被改的边（见 contract-draft.md ## 禁 mock 边清单）。集成/单测文件由 generator 落地至 ## ARTIFACT 指定路径。命令均从仓库根目录执行。

## ARTIFACT 条目

- [ ] [ARTIFACT] reconciler 锁定专属 error_code 并纳入 TERMINAL_CODES
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/expired-attempt-reconciler.js','utf8');if(!(c.includes('worker_attempt_quarantined_terminalized')&&/TERMINAL_CODES[\s\S]*worker_attempt_quarantined_terminalized/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] attempt-runner labelsFor 写 instance_namespace 容器 label
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/fleet-worker/attempt-runner.cjs','utf8');if(!c.includes('cecelia.fleet.instance_namespace'))process.exit(1)"

- [ ] [ARTIFACT] fleet-worker 从 data root 派生/持久化 instance namespace 并传入 runner
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/fleet-worker/fleet-worker.cjs','utf8');if(!(c.includes('instanceNamespace')&&c.includes('instance-namespace')))process.exit(1)"

- [ ] [ARTIFACT] 真实 PG quarantined 集成测试注册进 POSTGRES_INTEGRATION_TESTS（进 CI 回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('expired-attempt-quarantined.pg.integration.test.js'))process.exit(1)"

- [ ] [ARTIFACT] 真实 Docker fence 集成测试存在且不 mock docker（禁 mock 被改的边）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/fleet-worker/instance-namespace-fence.integration.test.cjs','utf8');if(c.includes('vi.mock')||c.includes('createDockerAdapter')===false)process.exit(1)"

## BEHAVIOR 条目（真实目标验证，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L3] B-01: 双实例共享 Docker，本实例只认领自己 namespace 容器（RED-1/RED-2/INV-1）[接缝×2]
  动作: 用真实 Docker 建 nsA(他实例)+旧无 namespace 两容器，以本实例(nsB)跑 listOwned 认领决策
  预期观察: listOwned(nsB) 不含 nsA/旧容器；两容器 docker inspect Running=true（全程未被 SIGKILL/docker rm）
  等待预算: 0s
  留证: sprints/08132138-fleet-worker-instance-fencing/tools/fence-listowned.cjs stdout（OK 行）+ docker inspect 输出
  Test: manual:bash -c 'node sprints/08132138-fleet-worker-instance-fencing/tools/fence-listowned.cjs'

- [ ] [BEHAVIOR] [L3] B-02: quarantined expired attempt 一次事务确定终态 + replacement + 幂等（RED-3/RED-4/RED-5）
  动作: 真实 PostgreSQL 空库跑 quarantined 集成用例：造 quarantined expired attempt → reconcileExpiredAttempt（真实 authority terminalize）→ 二次 reconcile
  预期观察: attempt=failed 且 error_code=worker_attempt_quarantined_terminalized；新增恰 1 条 append-only evidence 行；派生出 replacement attempt；二次 reconcile 无新增终态/deny 行
  等待预算: 90s
  留证: pg integration 测试 stdout（PASS）+ 内部 psql 断言输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/expired-attempt-quarantined.pg.integration.test.js --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: reconcileExpiredAttempt(quarantined) 不再落 worker_attempt_state_unresolved
  动作: 单元跑 quarantined 分支路由（inspect.status=quarantined）
  预期观察: 返回 status=replacement_required（loop 可推进）；terminalize 收到 code=worker_attempt_quarantined_terminalized；返回不含 infrastructure_blocked / signature≠worker_attempt_state_unresolved
  等待预算: 0s
  留证: reconciler 单测 stdout（PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/expired-attempt-reconciler.test.js -t quarantined --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: 二次 reconcile 已 failed 的 quarantined attempt 幂等
  动作: 单元：对已终态(failed) attempt 再跑 reconcileExpiredAttempt
  预期观察: 返回 not_expired；terminalize 未被再次调用（无重复终态、无新增 deny）
  等待预算: 0s
  留证: reconciler 单测 stdout（PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/expired-attempt-reconciler.test.js -t idempotent --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: reconcile 回收决策只作用本实例 namespace（旧容器 fail-closed）
  动作: 单元：listOwned 返回他实例(nsA)+旧无 namespace 容器时跑 reconcile
  预期观察: docker.remove 未对 nsA/旧容器调用；只回收本实例 namespace 未记录容器
  等待预算: 0s
  留证: attempt-runner 单测 stdout（PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/attempt-runner.test.cjs -t namespace --reporter=dot'

## Invariant 覆盖（铁律映射 — Step 1.3）

- INV-1 [不互杀]（修复禁止 stop/删他人 Worker 或生产容器）→ 由 **B-01**（fence-listowned 断言 nsA/旧容器 Running=true 未被 rm）+ **B-05**（单元断言 docker.remove 未对他实例/旧容器调用）覆盖。
- INV-2 [验证命令实跑] → 本合同全部 [BEHAVIOR] Test: 为真实 docker/psql/node exit-code 断言（无 vitest include-范围外绿态兜底、无 `|| true`、无 `exit 0` 兜底）。
- INV-3 [judge 证据窗口] → N/A（evaluator 侧义务）：evaluator 产 `.brain-result.json` 时须把 B-01/B-02 一手断言输出放入 judge 消费窗口前 8 条×600 字符；本合同在 ## E2E 验收 末尾统一 echo 关键结论供收割。
