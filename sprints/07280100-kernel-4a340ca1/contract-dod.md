---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel Test Environment Controller Recovery 4

**范围**: frozen-contract authority、attempt-scoped PG provisioning、signed CredentialEnvelope/receipt、八终态 cleanup、exact Draft PR head host evaluator gate、真实 PG 红测。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] contract files 与红测文件齐全
  Test: node -e "const fs=require('fs');for(const p of ['sprints/07280100-kernel-4a340ca1/contract-draft.md','sprints/07280100-kernel-4a340ca1/contract-dod.md','sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts','sprints/07280100-kernel-4a340ca1/tests/credential-envelope-receipt.contract.test.ts','sprints/07280100-kernel-4a340ca1/tests/remote-bridge-receipt.contract.test.ts','sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts'])fs.accessSync(p)"

- [ ] [ARTIFACT] contract 明确锚定 authority base SHA 与 host fixture
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07280100-kernel-4a340ca1/contract-draft.md','utf8');for(const s of ['274fff5a4a22f3bb3ec5d2d304f3e14bd9aeba71','postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap'])if(!c.includes(s))throw new Error('missing '+s)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] frozen-contract authority 只从 `initiative_contracts` 与 `initiative_runs` 派生
  动作: 在真实 `harness_controller_bootstrap` fixture 上读取 production schema，并用不可信 payload/env 覆盖值干扰 `collectGroundTruth`。
  预期观察: 返回的 authority 仍绑定真实 `contract_id/contract_sha/run_id`，且 `database_backed=true`；payload/env 覆盖值无效。
  Test: manual:bash -c 'TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}" npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts -t "collectGroundTruth 只从 initiative_contracts 与 initiative_runs 派生 authority"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] attempt 持久化后才允许 provisioning real PG capability
  动作: 先用真实 PG fixture 校验 schema 存在，再要求 controller 只在真实 attempt 落库后 provisioning DB/role/ACL。
  预期观察: 未持久化 attempt 明确拒绝；成功路径返回与 task/run/attempt/contract/SHA 绑定的 capability 元数据。
  Test: manual:bash -c 'TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}" npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts -t "attempt 持久化后才允许 provisioning real PG capability"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] CredentialEnvelope 必须带 signed_payload 外层签名与全绑定字段
  动作: 调用真实 `createCredentialBroker.issue(...)` 生成 envelope。
  预期观察: envelope 含 `signed_payload/signature/key_id/algorithm/payload_digest/nonce/issued_at/expires_at/task_id/run_id/attempt_id/contract_id/contract_sha/pr_head_sha/db_name`；缺任一字段即失败。
  Test: manual:bash -c 'npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/credential-envelope-receipt.contract.test.ts -t "CredentialEnvelope 必须带 signed_payload 外层签名与全绑定字段"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] remote bridge launch body 必须携带 exact signed receipt 绑定字段
  动作: 调用真实 `createRemoteBridgeTransport.launch(...)`，抓取 fetch 请求体。
  预期观察: 请求体含 `credential_envelope.signed_payload` 与 `payload_digest/nonce/contract_id/contract_sha/pr_head_sha/db_name`；字段错位或缺失即失败。
  Test: manual:bash -c 'npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/remote-bridge-receipt.contract.test.ts -t "remote bridge launch body 必须携带 exact signed receipt 绑定字段"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] cleanup 覆盖八条终态并要求无残留 capability
  动作: 在真实 PG fixture 上读取 production schema，并要求 cleanup controller 公布八终态 contract 与无残留审计入口。
  预期观察: 八条终态集合完整，且 cleanup 审计要求无 surviving login/DB/ACL/envelope/secret file/replay capability。
  Test: manual:bash -c 'TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}" npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts -t "cleanup 覆盖八条终态并要求无残留 capability"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] report 在 exact Draft PR head host receipt 与 owner review 缺失时必须阻断
  动作: 调用真实 `createKernelHandlers().report(ctx)`，构造 `review_required=true` 且缺 exact host receipt/owner review 的上下文。
  预期观察: handler 返回 `BLOCKED`，而不是继续 promote/staging/done。
  Test: manual:bash -c 'npx vitest run --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts -t "report 在 exact Draft PR head host receipt 与 owner review 缺失时必须阻断"'
  期望: exit 0

## 禁 mock 边清单

- `ground-truth.js` ↔ `initiative_runs` / `initiative_contracts`（authority 真相链）
- `credential-broker.js` ↔ `remote-bridge-transport.js` ↔ `packages/brain/scripts/fleet-worker/credential-envelope.cjs`（signed envelope/receipt）
- cleanup controller ↔ real PostgreSQL capability 残留审计（login/DB/ACL/envelope/secret file）
- `kernel-handlers.js` ↔ `review_required` / exact `pr.head_sha` host receipt gate

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap}"

psql "$TEST_DATABASE_URL" -c "select current_database() as db" | grep -q "harness_controller_bootstrap"

npx vitest run \
  --config sprints/07280100-kernel-4a340ca1/vitest.contract.mjs \
  sprints/07280100-kernel-4a340ca1/tests/frozen-authority-real-pg.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/credential-envelope-receipt.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/remote-bridge-receipt.contract.test.ts \
  sprints/07280100-kernel-4a340ca1/tests/cleanup-host-gate.contract.test.ts
```
