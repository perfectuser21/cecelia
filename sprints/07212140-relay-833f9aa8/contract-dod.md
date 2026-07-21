---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: codex-headed-smoke 833f9aa8

**范围**: 为当前 task `833f9aa8-7d17-4537-bff7-0ad4e16ca1be` 固化当前容器认领 headed relay smoke；交付物已毕业到 `scripts/smoke/e2e/relay-833f9aa8.sh` 与 `tests/regression/relay-833f9aa8/contract-red.test.sh`。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] `scripts/smoke/e2e/relay-833f9aa8.sh` 存在，默认绑定当前 `TASK_ID`、`SPRINT_DIR`、`BRAIN_URL`、`DATABASE_URL`
  Test: node -e "const fs=require('fs');const p='scripts/smoke/e2e/relay-833f9aa8.sh';const c=fs.readFileSync(p,'utf8');for(const s of ['833f9aa8-7d17-4537-bff7-0ad4e16ca1be','sprints/07212140-relay-833f9aa8','http://localhost:5221','postgresql://cecelia:cecelia@localhost:5432/cecelia']){if(!c.includes(s)){console.error('missing '+s);process.exit(1)}}"

- [x] [ARTIFACT] `tests/regression/relay-833f9aa8/contract-red.test.sh` 存在，覆盖 DoD 的断言名字与 assert 名
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('tests/regression/relay-833f9aa8/contract-red.test.sh','utf8');for(const s of ['task-payload-shape','db-claim-oracle','run-host-phase','current-task-only','evidence-boundary-and-redaction','verification_level: L3 真目标复核']){if(!c.includes(s)){console.error('missing '+s);process.exit(1)}}"

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] e2e-verify.sh 校验当前 task API payload shape
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash scripts/smoke/e2e/relay-833f9aa8.sh --assert task-payload-shape'

- [x] [BEHAVIOR] [L2] e2e-verify.sh 校验当前 task DB claim oracle
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash scripts/smoke/e2e/relay-833f9aa8.sh --assert db-claim-oracle'

- [x] [BEHAVIOR] [L2] e2e-verify.sh 校验当前 task run host 与 phase
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash scripts/smoke/e2e/relay-833f9aa8.sh --assert run-host-phase'

- [x] [BEHAVIOR] [L2] e2e-verify.sh 拒绝历史 task 作为当前证据
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash scripts/smoke/e2e/relay-833f9aa8.sh --assert current-task-only'

- [x] [BEHAVIOR] [L2] e2e-verify.sh 日志证据限于当前 sprint 且脱敏
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash scripts/smoke/e2e/relay-833f9aa8.sh --assert evidence-boundary-and-redaction'

- [x] [BEHAVIOR] [L2] e2e-verify.sh local_api 全链路基于当前 task API、DB 与 run 证据
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash scripts/smoke/e2e/relay-833f9aa8.sh'

- [x] [BEHAVIOR] [L3] verification_level: L3 真目标复核
  verification_level: L3
  Test: manual:bash -c 'set -euo pipefail; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-833f9aa8.sh}"; grep -F "curl -sf" "$VERIFY" >/dev/null; grep -F "psql" "$VERIFY" >/dev/null; ! grep -E "MOCK_|mock|stub|\\|\\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$VERIFY" >/dev/null; TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}" bash "$VERIFY"'

## Invariant 覆盖登记

- [x] [BEHAVIOR] INV-1 单slot串行：wrapper 只读，不 POST/PATCH/DELETE、不 kill session
  Test: manual:bash -c 'set -euo pipefail; ! grep -E "curl .* -X (POST|PATCH|DELETE)|kill|pkill" scripts/smoke/e2e/relay-833f9aa8.sh >/dev/null'

- [x] [BEHAVIOR] INV-2 禁写死环境：env 可覆盖
  Test: manual:bash -c 'set -euo pipefail; for s in TASK_ID SPRINT_DIR BRAIN_URL DATABASE_URL; do grep -q "$s" scripts/smoke/e2e/relay-833f9aa8.sh || exit 1; done'

- [x] [BEHAVIOR] INV-3 真验才done：必须真实 curl + psql 当前 task
  Test: manual:bash -c 'set -euo pipefail; grep -q "api/brain/tasks/\\$TASK_ID" scripts/smoke/e2e/relay-833f9aa8.sh; grep -q "FROM tasks" scripts/smoke/e2e/relay-833f9aa8.sh; grep -q "FROM initiative_runs" scripts/smoke/e2e/relay-833f9aa8.sh'

- [x] [BEHAVIOR] INV-4 凭据安全：payload 与日志不含 secret-like 内容
  Test: manual:bash -c 'set -euo pipefail; ! grep -RniE "ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer" sprints/07212140-relay-833f9aa8 >/dev/null'

- N/A: INV-5 日志脱敏已由 BEHAVIOR 覆盖
- N/A: INV-6 端点鉴权：本 sprint 不新增 API 端点
- N/A: INV-7 租户隔离：本 sprint 不触及租户数据
