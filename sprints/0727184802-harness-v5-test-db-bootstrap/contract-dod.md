---
skeleton: false
journey_type: autonomous
---
# Contract DoD - Sprint: Kernel/Engine 测试数据库合同统一与隔离执行能力

**范围**: 统一 `TEST_DATABASE_URL` 测试库能力、bootstrap 显式迁移、import purity、capability fail-closed、cleanup receipt 与 local/fleet parity。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] contract tests 已覆盖 capability 路由、bootstrap、cleanup、parity 与 import purity
  Test: node -e "const fs=require('fs');const a='sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts';const b='sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts';if(!fs.existsSync(a)||!fs.existsSync(b))process.exit(1)"

- [ ] [ARTIFACT] contract draft 含 `## 禁 mock 边清单`、`## 真实调用方请求 shape` 与 `## E2E 验收`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/0727184802-harness-v5-test-db-bootstrap/contract-draft.md','utf8');for(const k of ['## 禁 mock 边清单','## 真实调用方请求 shape','## E2E 验收']){if(!c.includes(k))process.exit(1)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] DB capability 只发给声明 DB-backed B1-B5 的角色
  动作: 运行 capability contract test，检查 planner/proposer/reviewer/generator/evaluator 的 DB-backed 命令与 judge/无关角色的 capability 发放结果
  预期观察: 只有声明 DB-backed B1-B5 的角色看到 `TEST_DATABASE_URL` capability；judge 与无关角色拿不到；payload/prompt/log 不出现 capability
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts -t 'DB capability 只发给声明 DB-backed B1-B5 的角色' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] bootstrap 只迁移 TEST_DATABASE_URL 白名单库
  动作: 运行 bootstrap contract test，只允许 `TEST_DATABASE_URL` 驱动 bootstrap/migration/seed
  预期观察: 命名业务断言要求 `current_database()` 命中 capability 指向的白名单库，且 `journey_step_links` 存在；禁止 `DB_NAME`/`DATABASE_URL` fallback
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t 'bootstrap 只迁移 TEST_DATABASE_URL 白名单库' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 旧 workflow 使用 DB_NAME=cecelia 在共享夹具上命名失败
  动作: 运行旧 workflow 负例 contract test，模拟 workflow 只靠 `DB_NAME=cecelia`
  预期观察: 测试以命名业务断言失败，指出 bootstrap 目标库错误；不以缺 env、缺 import、缺网络伪装失败
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t '旧 workflow 使用 DB_NAME=cecelia 在共享夹具上命名失败' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] import kernel-harness-f1-baseline 不改 env 不 spawn psql 不隐式迁移
  动作: 在 PATH 无 `psql` 且仅设置 `TEST_DATABASE_URL` 的条件下运行 import-purity contract test
  预期观察: import 前后 env 快照一致，无 child_process spawn，无 migration side effect；任何污染都失败
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts -t 'import kernel-harness-f1-baseline 不改 env 不 spawn psql 不隐式迁移' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 缺失过期跨 attempt loopback production capability 在 Brain import 前 fail closed
  动作: 运行 fail-closed contract test，逐项喂入缺失、过期、串 attempt、loopback/default socket、生产库或陈旧 receipt capability
  预期观察: 在 Brain import 前直接拒绝执行，不发生写库；错误类型可区分，且不会降级到 `DB_NAME` / `DATABASE_URL`
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts -t '缺失过期跨 attempt loopback production capability 在 Brain import 前 fail closed' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] kill recovery cleanup 后拒绝复用旧 capability
  动作: 运行 cleanup contract test，模拟 success/failure/cancel/kill/recovery 后复用旧 capability
  预期观察: cleanup outcome 进入 attested receipt；旧 capability 与旧 receipt 复用被拒绝
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t 'kill recovery cleanup 后拒绝复用旧 capability' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等
  动作: 运行 parity contract test，对比 local-docker 与 fleet-worker 的真实 dispatcher/transport/attempt-runner receipt
  预期观察: 两者都绑定 run_id/attempt_id/execution_surface/database_name/expiry/cleanup_outcome，且不含凭据；不接受 caller env forwarding 或 synthetic URL
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t 'local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等' --reporter=verbose"
  期望: exit 0

## Invariant 条目

- [ ] [BEHAVIOR] [L2] INV-1 禁止写死环境假设值与默认 socket
  动作: 对 capability 负例执行 loopback/default socket 检查
  预期观察: 任何 loopback/default socket capability 都在 import 前失败
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts -t '缺失过期跨 attempt loopback production capability 在 Brain import 前 fail closed' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-2 真环境 PostgreSQL 接缝必须真验
  动作: 对 bootstrap/cleanup/parity contract tests 执行真实 PostgreSQL 路径断言
  预期观察: `journey_step_links`、receipt、cleanup outcome 都来自真 PG/真 transport
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t 'bootstrap 只迁移 TEST_DATABASE_URL 白名单库|kill recovery cleanup 后拒绝复用旧 capability|local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-3 secrets 不进日志不进 result
  动作: 检查 capability/receipt contract test 的断言对象
  预期观察: receipt 只允许 `run_id/attempt_id/execution_surface/database_name/expiry/cleanup_outcome` 等白名单字段
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t 'local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-4 TEST_DATABASE_URL 是唯一测试连接串
  动作: 运行 capability 与旧 workflow 负例
  预期观察: `DB_NAME` / `DATABASE_URL` / alias 无法决定 bootstrap 目标库
  Test: manual:bash -c "npx vitest run sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-capability.contract.test.ts sprints/0727184802-harness-v5-test-db-bootstrap/tests/test-db-bootstrap.contract.test.ts -t 'TEST_DATABASE_URL|旧 workflow 使用 DB_NAME=cecelia 在共享夹具上命名失败' --reporter=verbose"
