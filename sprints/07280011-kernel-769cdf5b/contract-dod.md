---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel Test Environment Controller Recovery 2

**范围**: attempt-scoped PostgreSQL capability 发放、local/fleet runner 环境注入、pre-import oracle、cleanup/reconcile、attested receipt。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Sprint 红测文件存在且直接 import 当前生产模块
  Test: node -e "const fs=require('fs');const p='sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts';const c=fs.readFileSync(p,'utf8');if(!c.includes('createDispatcher')||!c.includes('createRemoteBridgeTransport')||!c.includes('createFleetWorkerServer'))process.exit(1)"

- [ ] [ARTIFACT] contract-draft.md 含 `## 真实调用方请求 shape`、`## 禁 mock 边清单`、`## E2E 验收`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07280011-kernel-769cdf5b/contract-draft.md','utf8');for(const token of ['## 真实调用方请求 shape','## 禁 mock 边清单','## E2E 验收']){if(!c.includes(token))process.exit(1)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] local dispatcher 只给 DB-backed proposer 注入 attempt-scoped TEST_DATABASE_URL 与无凭据 receipt
  动作: 运行真实 `createDispatcher` + `createDetachedLauncher` 路径，派发 DB-backed proposer attempt。
  预期观察: child env 含 `TEST_DATABASE_URL` 与 receipt/ref，且 receipt 不含 URL/password/token。
  Test: manual:bash npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts -t "dispatcher local path injects TEST_DATABASE_URL and credential-free receipt only for DB-backed proposer bundle"

- [ ] [BEHAVIOR] [L2] remote bridge -> fleet worker -> attempt runner 真路径把 capability 带进 docker create env
  动作: 运行真实 `createRemoteBridgeTransport` -> `fleet-worker.cjs` -> `attempt-runner.cjs` 路径。
  预期观察: docker create `--env` 含 `TEST_DATABASE_URL` 与 receipt/ref，且 `HARNESS_ATTEMPT_ID/HARNESS_RUN_ID/HARNESS_LEASE_OWNER/HARNESS_LEASE_GENERATION` 与 receipt 一致。
  Test: manual:bash npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts -t "remote bridge -> fleet worker -> attempt runner carries TEST_DATABASE_URL and receipt into docker create env"

- [ ] [BEHAVIOR] [L2] pre-import oracle 真 PG 角色对非 attempt 数据库零 CONNECT 权限
  动作: 用 bootstrap fixture 创建 attempt db + role + prod-like db，并以 role 连接 attempt db。
  预期观察: `current_database/current_user/inet_server_addr` 与 receipt 对齐，`has_database_privilege(current_user, prodLikeDb, 'CONNECT')` 为 false。
  Test: manual:bash npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts -t "pre-import oracle real PG role has zero CONNECT privilege on non-attempt databases"

- [ ] [BEHAVIOR] [L2] 全红测在当前实现下以命名业务断言失败，而不是依赖缺失或静态扫描
  动作: 运行整份红测。
  预期观察: Vitest 输出至少一条包含上述测试名的失败；不能是 import error、missing dependency、network unreachable、fake red。
  Test: manual:bash bash -lc 'set -euo pipefail; OUT=$(mktemp); if npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts >"$OUT" 2>&1; then cat "$OUT"; exit 1; fi; grep -q "dispatcher local path injects TEST_DATABASE_URL" "$OUT"; grep -q "remote bridge -> fleet worker -> attempt runner carries TEST_DATABASE_URL" "$OUT"; grep -q "pre-import oracle real PG role has zero CONNECT privilege on non-attempt databases" "$OUT"'

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}"

OUT="$(mktemp)"
if npx vitest run sprints/07280011-kernel-769cdf5b/tests/kernel-test-environment-controller.red.test.ts >"$OUT" 2>&1; then
  cat "$OUT"
  echo "FAIL: red suite unexpectedly passed"
  exit 1
fi
grep -q "dispatcher local path injects TEST_DATABASE_URL" "$OUT"
grep -q "remote bridge -> fleet worker -> attempt runner carries TEST_DATABASE_URL" "$OUT"
grep -q "pre-import oracle real PG role has zero CONNECT privilege on non-attempt databases" "$OUT"
cat "$OUT"
```
