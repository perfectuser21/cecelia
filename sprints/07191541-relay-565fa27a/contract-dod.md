---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: headless-smoke 565fa27a

**范围**: 为当前 task `565fa27a-4b5b-4eb7-905e-b6fb61eb8413` 固化 headless claude skill-relay smoke 验收；验收入口使用永久 wrapper `scripts/smoke/e2e/relay-565fa27a.sh` 与永久回归测试 `tests/regression/relay-565fa27a/contract-red.test.sh`，不得修改 Brain runtime、dashboard/UI、migrations 或历史 sprint 证据。
**大小**: S

---

## ARTIFACT 条目

- [ ] [ARTIFACT] 永久回归 red test 骨架存在，且默认绑定当前 task、当前 sprint 与永久 wrapper
  Test: node -e "const fs=require('fs');const p='tests/regression/relay-565fa27a/contract-red.test.sh';const c=fs.readFileSync(p,'utf8');for(const s of ['565fa27a-4b5b-4eb7-905e-b6fb61eb8413','sprints/07191541-relay-565fa27a','scripts/smoke/e2e/relay-565fa27a.sh','task-payload-shape','db-dispatch-oracle','runs-concern-or-verified','current-task-only','evidence-boundary-and-redaction']){if(!c.includes(s)){console.error('missing '+s);process.exit(1)}}"

- [ ] [ARTIFACT] 永久 e2e wrapper `scripts/smoke/e2e/relay-565fa27a.sh` 存在且 bash 语法正确
  Test: bash -n scripts/smoke/e2e/relay-565fa27a.sh

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [B1] e2e wrapper 验证当前 task API payload shape（mode=headless/executor=claude/orchestrator=skill-relay/smoke_test=true/dispatched_by_orchestrator=true）
  动作: 执行永久 wrapper 的 `--assert task-payload-shape`，真实 curl 当前 Brain task API。
  预期观察: 当前 task `id/task_type/status/payload` 与 PRD 字面字段匹配，payload 不含 secret 或历史 PRD 字段。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert task-payload-shape'
  期望: exit 0；404、字段漂移、历史 task id 或 payload secret 均 FAIL。

- [ ] [BEHAVIOR] [B2] e2e wrapper 验证当前 task status=in_progress（headless dispatch claim oracle）
  动作: 执行 `--assert db-dispatch-oracle`，真实 psql 读取 `tasks.id=565fa27a-4b5b-4eb7-905e-b6fb61eb8413`。
  预期观察: DB 当前行显示 `status=in_progress`、`task_type=harness_initiative`、payload 三元组匹配、`dispatched_by_orchestrator=true`。
  注意: headless 不检查 executor_kind/claimed_by/claimed_at/journey_id。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert db-dispatch-oracle'
  期望: exit 0；DB row 缺失、status 非 in_progress 或 dispatched_by_orchestrator 非 true 均 FAIL。

- [ ] [BEHAVIOR] [B3] initiative_runs 缺当前 task run 时只输出 concern，不判定成功（concern 路径）
  动作: 执行 `--assert runs-concern-or-verified`，真实读取 Brain harness runs API 与 DB `initiative_runs`。
  预期观察: run 缺失时输出 `CONCERN` 并先通过 task API + DB dispatch oracle；run 存在时验证 phase 合法且非 failed。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; OUT=$(TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert runs-concern-or-verified); printf "%s\n" "$OUT"; if printf "%s\n" "$OUT" | grep -q "CONCERN"; then printf "%s\n" "$OUT" | grep -q "headless dispatch oracle validated" || { echo "FAIL: concern without dispatch oracle"; exit 1; }; fi'
  期望: exit 0；run 缺失只能是 concern，不能被写成 run 成功；run 存在但 failed/unknown phase 均 FAIL。

- [ ] [BEHAVIOR] [B4] e2e wrapper 拒绝历史任务（d355821f）作为当前成功证据
  动作: 执行 `--assert current-task-only`，验证默认 `TASK_ID` 与 `SPRINT_DIR` 均绑定当前 sprint。
  预期观察: 当前 task id 与当前 sprint 目录通过；历史 task d355821f 或历史 sprint 目录作为当前证据时 FAIL。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert current-task-only'
  期望: exit 0；历史 task d355821f 不得作为当前成功证据。

- [ ] [BEHAVIOR] [B5] e2e wrapper 证据边界：日志和证据只在 sprints/07191541-relay-565fa27a/，脱敏
  动作: 执行 `--assert evidence-boundary-and-redaction`，读取当前 task payload 并扫描当前 sprint 证据日志。
  预期观察: 证据路径只在 `sprints/07191541-relay-565fa27a/`；若 `tui.log` 或 `harness-report.md` 存在，不含 token、私钥、Bearer credential 形态。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert evidence-boundary-and-redaction'
  期望: exit 0；日志含 secret-like 内容或证据路径偏离当前 sprint 均 FAIL。

- [ ] [BEHAVIOR] [B6] [L3] 真验才 done：wrapper 必须真实 curl Brain API + psql DB，禁止 mock/exit0
  verification_level: L3
  动作: 不带 `--assert` 执行永久 wrapper，跑完整 local_api Golden Path，并验证 wrapper 含真实 curl-sf 和 psql。
  预期观察: wrapper 必须真实 `curl -sf` 当前 Brain task API，并真实 `psql` 当前 `tasks`/`initiative_runs`；不接受 mock/stub/fixture、静态日志替代、吞错或无条件 exit 0。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; grep -F "curl -sf" "$VERIFY" >/dev/null || { echo "FAIL: missing real curl"; exit 1; }; grep -F "psql" "$VERIFY" >/dev/null || { echo "FAIL: missing real psql"; exit 1; }; ! grep -E "MOCK_|force_|\|\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$VERIFY" >/dev/null || { echo "FAIL: wrapper contains mock/stub/swallow/exit0"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY"'
  期望: exit 0；该条为 judge `meta_verification_gap` 的 L3 断言。

## E2E 验收

执行以下命令验证当前 task 565fa27a 的 payload shape 和 status（manual:bash）：

```bash
# 全链路验收（推荐）
TASK_ID=565fa27a-4b5b-4eb7-905e-b6fb61eb8413 \
BRAIN_URL=http://localhost:5221 \
DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia \
SPRINT_DIR=sprints/07191541-relay-565fa27a \
bash scripts/smoke/e2e/relay-565fa27a.sh
```

```bash
# 单断言验收：payload shape
bash scripts/smoke/e2e/relay-565fa27a.sh --assert task-payload-shape

# 单断言验收：DB dispatch oracle
bash scripts/smoke/e2e/relay-565fa27a.sh --assert db-dispatch-oracle

# 单断言验收：initiative_runs concern 路径
bash scripts/smoke/e2e/relay-565fa27a.sh --assert runs-concern-or-verified
```

```bash
# 回归测试（CI 常驻）
bash tests/regression/relay-565fa27a/contract-red.test.sh
```

---

## Invariant 覆盖登记

- [ ] [BEHAVIOR] [L2] INV-1 单 slot 串行：验收只读当前 task，不重复 spawn、dispatch 或抢占已有 session
  动作: 执行 full wrapper，并要求 wrapper 只使用 GET/SELECT 读路径。
  预期观察: 验收过程不创建新 task、不 PATCH 当前 task、不 kill session。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; bash "$VERIFY" --assert current-task-only; if grep -E "curl .* -X (POST|PATCH|DELETE)|/dispatch|kill|pkill" "$VERIFY" >/dev/null; then echo "FAIL: wrapper mutates or kills"; exit 1; fi'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-2 禁写死环境：BRAIN_URL/DATABASE_URL/SPRINT_DIR/TASK_ID 均可 env 覆盖
  动作: 读取 wrapper 并执行 current-task-only 断言。
  预期观察: wrapper 使用 `BRAIN_URL`、`DATABASE_URL`/`DB_URL`、`SPRINT_DIR`、`TASK_ID` env 变量；未写死凭据路径。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; for s in BRAIN_URL DATABASE_URL SPRINT_DIR TASK_ID; do grep -q "$s" "$VERIFY" || { echo "FAIL: missing env $s"; exit 1; }; done'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-3 真验才 done：done/pass 只能来自当前 task API + DB dispatch oracle
  动作: 执行 full wrapper。
  预期观察: wrapper 必须真实 curl Brain API 并真实 psql 当前 DB；`initiative_runs` 缺失时只输出 concern。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; grep -q "curl -sf.*api/brain/tasks" "$VERIFY" || { echo "FAIL: missing task API curl"; exit 1; }; grep -q "psql.*tasks" "$VERIFY" || { echo "FAIL: missing DB tasks oracle"; exit 1; }; bash "$VERIFY"'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-4 凭据安全：payload 与证据不含 token/secret 字段
  动作: 执行 evidence-boundary-and-redaction 断言。
  预期观察: task payload 与当前 sprint 证据日志均不含 secret-like 内容。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert evidence-boundary-and-redaction'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-5 日志脱敏：报告和日志不得明文输出 token、客户隐私、完整敏感 prompt 或凭据路径细节
  动作: 扫描当前 sprint 证据文件。
  预期观察: `tui.log`、`harness-report.md` 存在时无 token-like 内容。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; for p in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do if [ -f "$p" ]; then if grep -E "ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer" "$p" >/dev/null; then echo "FAIL: secret-like content in $p"; exit 1; fi; fi; done'
  期望: exit 0。

- N/A: INV-6 端点鉴权：本 sprint 不新增或修改 API endpoint；只读现有本机 Brain API。
- N/A: INV-7 租户隔离：本 smoke 不查询或写入租户数据；所有 DB 查询定点绑定 task id。

---

## FR 覆盖登记

- FR-001: 覆盖于 BEHAVIOR `[B1] e2e wrapper 验证当前 task API payload shape`。
- FR-002: 覆盖于 BEHAVIOR `[B2] e2e wrapper 验证当前 task status=in_progress（headless dispatch claim oracle）`。
- FR-003: 覆盖于 BEHAVIOR `[B3] initiative_runs 缺当前 task run 时只输出 concern，不判定成功`。
- FR-004: 覆盖于 BEHAVIOR `[B4] e2e wrapper 拒绝历史任务（d355821f）作为当前成功证据`。
- FR-005: 覆盖于 BEHAVIOR `[B5] e2e wrapper 证据边界：日志和证据只在当前 sprint，脱敏` 与 INV-4/INV-5。
- Judge meta_verification_gap: 覆盖于 BEHAVIOR `[B6] [L3] 真验才 done`。

---

## headless vs headed 差异说明

| 字段 | headed (d355821f) | headless (565fa27a) |
|------|------------------|---------------------|
| `mode` | `headed` | `headless` |
| `executor` | `codex` | `claude` |
| `journey_id` | 有（`bb8cc561...`）| 无（不检查） |
| `executor_kind` | `headed-session`（必检查）| 无（不检查） |
| `claimed_by` | `session:engine-patch`（必检查）| 无（不检查） |
| DB dispatch oracle | `claimed_by/claimed_at/executor_kind` | 仅 `status/payload/dispatched_by_orchestrator` |
| initiative_runs | 检查 `orchestrator_host=foreground` | 不检查 host；缺失即 concern |

---

## 通过标准

- [B1] [B2] [B3] [B4] [B5] [B6] 全部 exit 0 = **合同通过（PASS）**
- INV-1/INV-2/INV-3 通过 = Invariant 覆盖完整
- CONCERN 条目（initiative_runs 缺失）不阻断主链路，但不可声明 headless relay smoke 完成
- 任一 [B*] FAIL = **合同未通过（FAIL）**，不可声明 headless smoke 完成
