---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: codex-headed-smoke d355821f

**范围**: 为当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 固化 codex headed skill-relay smoke 验收；后续实现只允许新增 sprint-local `e2e-verify.sh`，不得修改 Brain runtime、dashboard/UI、migrations 或历史 sprint 证据。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] sprint-local red test 骨架存在，且默认绑定当前 task 与当前 sprint
  Test: node -e "const fs=require('fs');const p='sprints/07191314-relay-d355821f/tests/contract-red.test.sh';const c=fs.readFileSync(p,'utf8');for(const s of ['d355821f-4a37-4fa2-ad2f-99668bc91a3d','sprints/07191314-relay-d355821f','task-payload-shape','db-claim-oracle','runs-concern-or-verified','current-task-only','evidence-boundary-and-redaction']){if(!c.includes(s)){console.error('missing '+s);process.exit(1)}}"

- [ ] [ARTIFACT] generator 产出的 `sprints/07191314-relay-d355821f/e2e-verify.sh` 存在且 bash 语法正确
  Test: bash -n sprints/07191314-relay-d355821f/e2e-verify.sh

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] e2e-verify.sh 校验当前 task API payload shape
  动作: 执行 sprint-local wrapper 的 `--assert task-payload-shape`，真实 curl 当前 Brain task API。
  预期观察: 当前 task `id/task_type/status/payload` 与 PRD 字面字段匹配，payload 不含 secret 或历史 PRD 字段。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert task-payload-shape'
  期望: exit 0；404、字段漂移、历史 task id 或 payload secret 均 FAIL。

- [ ] [BEHAVIOR] [L2] e2e-verify.sh 校验当前 task DB claim oracle
  动作: 执行 `--assert db-claim-oracle`，真实 psql 读取 `tasks.id=d355821f-4a37-4fa2-ad2f-99668bc91a3d`。
  预期观察: DB 当前行显示 `status=in_progress`、`task_type=harness_initiative`、payload 三元组匹配、`claimed_by=session:engine-patch`、`claimed_at` 非空、`executor_kind=headed-session`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert db-claim-oracle'
  期望: exit 0；DB row 缺失、未认领、executor_kind 非 headed-session 均 FAIL。

- [ ] [BEHAVIOR] [L2] e2e-verify.sh 对 initiative_runs 缺失输出 concern 且不当作成功证据
  动作: 执行 `--assert runs-concern-or-verified`，真实读取 `/api/brain/harness/runs?limit=50`、journey golden-paths 与 DB `initiative_runs`。
  预期观察: run 存在时 host/phase 非 failed 且属于 codex headed；run 缺失时必须先通过当前 task API + DB claim oracle，再输出 `CONCERN`。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; OUT=$(TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert runs-concern-or-verified); printf "%s\n" "$OUT"; if printf "%s\n" "$OUT" | grep -q "CONCERN"; then printf "%s\n" "$OUT" | grep -q "foreground takeover oracle validated" || { echo "FAIL: concern without foreground oracle"; exit 1; }; fi'
  期望: exit 0；initiative_runs 缺失只能是 concern/foreground takeover 分支，不能被写成 run 成功。

- [ ] [BEHAVIOR] [L2] e2e-verify.sh 拒绝历史 task 作为当前证据
  动作: 执行 `--assert current-task-only`，验证默认 `TASK_ID` 与 `SPRINT_DIR` 均重绑定当前 sprint。
  预期观察: 当前 task id 与当前 sprint 目录通过；任何历史同名 task/sprint 作为当前证据时 FAIL。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert current-task-only'
  期望: exit 0；历史同名 task 不得作为当前成功证据。

- [ ] [BEHAVIOR] [L2] e2e-verify.sh 日志证据限于当前 sprint 且脱敏
  动作: 执行 `--assert evidence-boundary-and-redaction`，读取当前 task payload 并扫描当前 sprint 证据日志。
  预期观察: 证据路径只在 `sprints/07191314-relay-d355821f/`；若 `tui.log` 或 `harness-report.md` 存在，不含 token、私钥、Bearer credential 形态。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert evidence-boundary-and-redaction'
  期望: exit 0；日志含 secret-like 内容或证据路径偏离当前 sprint 均 FAIL。

- [ ] [BEHAVIOR] [L2] e2e-verify.sh local_api 全链路基于当前 task API 和 DB claim oracle
  动作: 不带 `--assert` 执行 sprint-local wrapper，跑完整 local_api Golden Path。
  预期观察: 当前 task API、DB claim oracle、run concern/verified 分支、证据边界全部通过；缺 run 时输出 concern 但不将 run 缺失写成成功。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY"'
  期望: exit 0；任一真实 API/DB 断言失败则整体 FAIL。

## Invariant 覆盖登记

- [ ] [BEHAVIOR] [L2] INV-1 单slot串行：验收只读当前 task，不重复 spawn、dispatch 或抢占已有 headed session
  动作: 执行 full wrapper，并要求 wrapper 只使用 GET/SELECT 读路径。
  预期观察: 当前 task claim 仍由现有 headed session 表达，验收过程不创建新 task、不 PATCH 当前 task、不 kill session。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; bash "$VERIFY" --assert current-task-only; if grep -E "curl .* -X (POST|PATCH|DELETE)|/dispatch|kill|pkill" "$VERIFY" >/dev/null; then echo "FAIL: wrapper mutates or kills"; exit 1; fi'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-2 禁写死环境：端口、DB 与 sprint 路径可由 env 覆盖，默认仅作为 local_api fallback
  动作: 读取 wrapper 并执行 current-task-only 断言。
  预期观察: wrapper 使用 `BRAIN_URL`、`DATABASE_URL`/`DB_URL`、`SPRINT_DIR`、`TASK_ID`；未写死凭据路径或历史 sprint 路径。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; for s in BRAIN_URL DATABASE_URL SPRINT_DIR TASK_ID; do grep -q "$s" "$VERIFY" || { echo "FAIL: missing env $s"; exit 1; }; done; OLD_SHORT="$(printf "%s%s" 537 10094)"; if grep -q "$OLD_SHORT" "$VERIFY"; then echo "FAIL: historical sprint leaked"; exit 1; fi'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-3 真验才done：done/pass 只能来自当前 task API + DB claim oracle
  动作: 执行 full wrapper。
  预期观察: wrapper 必须真实 curl Brain API 并真实 psql 当前 DB；`initiative_runs` 缺失时只输出 concern。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; grep -q "curl -sf.*api/brain/tasks" "$VERIFY" || { echo "FAIL: missing task API curl"; exit 1; }; grep -q "psql.*tasks" "$VERIFY" || { echo "FAIL: missing DB tasks oracle"; exit 1; }; bash "$VERIFY"'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-4 凭据安全：payload 与证据不含 token/secret 字段
  动作: 执行 evidence-boundary-and-redaction 断言。
  预期观察: task payload 与当前 sprint 证据日志均不含 secret-like 内容。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; VERIFY="${VERIFY:-$SPRINT_DIR/e2e-verify.sh}"; TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert evidence-boundary-and-redaction'
  期望: exit 0。

- [ ] [BEHAVIOR] [L2] INV-5 日志脱敏：报告和日志不得明文输出 token、客户隐私、完整敏感 prompt 或凭据路径细节
  动作: 扫描当前 sprint 证据文件。
  预期观察: `tui.log`、`harness-report.md` 存在时无 token-like 内容。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"; for p in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do if [ -f "$p" ]; then if grep -E "ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer" "$p" >/dev/null; then echo "FAIL: secret-like content in $p"; exit 1; fi; fi; done'
  期望: exit 0。

- N/A: INV-6 端点鉴权：本 sprint 不新增或修改 API endpoint；只读现有本机 Brain API。
- N/A: INV-7 租户隔离：本 smoke 不查询或写入租户数据；所有 DB 查询定点绑定 task id。

## FR 覆盖登记

- FR-001: 覆盖于 BEHAVIOR `e2e-verify.sh 校验当前 task API payload shape`。
- FR-002: 覆盖于 BEHAVIOR `e2e-verify.sh 校验当前 task DB claim oracle`。
- FR-003: 覆盖于 BEHAVIOR `e2e-verify.sh 对 initiative_runs 缺失输出 concern 且不当作成功证据`。
- FR-004: 覆盖于 BEHAVIOR `e2e-verify.sh 拒绝历史 task 作为当前证据`。
- FR-005: 覆盖于 BEHAVIOR `e2e-verify.sh 日志证据限于当前 sprint 且脱敏` 与 INV-4/INV-5。
