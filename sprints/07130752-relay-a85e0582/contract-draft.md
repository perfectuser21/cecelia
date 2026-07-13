# Sprint Contract Draft (Round 5)

## Response Schema（推导来源: PRD字面/api_registry推导）

### Endpoint: GET /api/brain/tasks/:task_id
**Success (HTTP 200)**:
```json
{"id":"<uuid>","task_type":"harness_initiative","payload":{"mode":"headed","executor":"codex","orchestrator":"skill-relay"}}
```
- `id` (string, 必填): 来源--PRD 指定 task `a85e0582-5d88-4f0b-bce6-302d898b01e7`；api_registry 已登记 `/api/brain/tasks`。
- `task_type` (string, 必填): 来源--PRD 要求 task 为 headed-smoke-test 的 `harness_initiative`。
- `payload.mode` (string, 必填): 来源--PRD 字面值 `headed`。
- `payload.executor` (string, 必填): 来源--PRD 字面值 `codex`。
- `payload.orchestrator` (string, 必填): 来源--PRD 字面值 `skill-relay`。
**禁用字段名**: [`token`, `github_token`, `codex_token`, `thin_prd`]
**Error (HTTP 4xx)**:
```json
{"error":"<string>"}
```

### DB: initiative_runs
**Success**:
```json
{"initiative_id":"<task_id>","orchestrator_host":"skill-relay-codex-headed","phase":"gan","started_at":"<timestamp>","completed_at":"<timestamp|null>"}
```
- `initiative_id` (uuid, 必填): 来源--PRD 当前 task id。
- `orchestrator_host` (string, 必填): 来源--PRD 假设声明，以 DB `initiative_runs` 为最终验收源。
- `phase` (string, 必填): 来源--DB 当前真实枚举与 relay 生命周期；允许 `A_planning|planning|gan|generate|evaluate|done`。`A_planning` 是 PRD 期望的初始 relay lifecycle phase；当前 headed controller run 可能已从 `A_planning` 推进到 `planning|gan|generate|evaluate|done`，但 `failed` 或未知 phase 必须失败。
- `started_at` (timestamp, 必填): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列。
- `completed_at` (timestamp/null, 可选): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列。
**DB 列约束**: 只允许使用 `information_schema.columns` 中真实存在的列；sprint/log 追溯只能验本地 `sprints/07130752-relay-a85e0582/` wrapper 语义。

## 已知约束（来自回归测试）

- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(mode=headed, executor=codex) 返回 200 且有 id。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(executor=claude, mode=headed) 返回 200/201。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(mode=headless) 返回 200/201。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(mode=invalid) 返回 400。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> initiative_runs.tmux_killed_at 字段存在。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 固化 headed-smoke-test 回归验收边界：验证当前 task payload、initiative_runs headed relay 状态、本地 sprint/tui.log 外部真相或源码留痕机制，并复用既有 smoke。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本机 `local_api` 可执行；命令失败即失败；不重复 spawn，不误杀会话；日志不输出 token 或敏感 prompt。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不新增业务功能/UI/migration；不扩大到 headless 或其他 executor；不写 token；已有 run/session 只读验证。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | smoke allowlist 或 `codex-headed-dispatch-smoke.sh` 语义变更时本合同过期，由后续 harness 维护者更新。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator 执行 DoD/E2E 任一命令非 0 即暴露；CI allowlist 中该 smoke 失败应红。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | Brain API/DB 证据缺失时拦截 done；`tui.log` 缺失时走 WARN/evidence + 源码留痕机制验证；验证只读，重跑幂等。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 复用 smoke 的 5/5 PASS；以当前 task payload、DB run、本地 sprint/tui.log（存在时）或 relay 源码留痕机制（缺失时）作为当前任务外部真相。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| headed relay run 归属当前 task | A. 只看最近一条 run; B. 用 `initiative_id = TASK_ID` 定点查 DB | B. 用当前 task id 定点查 | PRD 指定 task id，历史 run 不能冒充当前任务 | 历史 headed run 冒充本轮验收，导致假 done |
| headed relay host 判定 | A. Brain runs API 推断; B. DB `initiative_runs.orchestrator_host` | B. DB 字段等于 `skill-relay-codex-headed` | PRD 假设声明 DB 为最终验收源 | 错把非 headed/codex relay 当作通过 |
| sprint 日志位置可观测 | A. 查询 DB 中不存在的 sprint 目录列; B. `tui.log` 存在且非空时验真，缺失时输出 WARN/evidence 并验 `harness-skill-relay.js` 留痕机制 | B. 当前外部真相为本 sprint 无 `tui.log`，不得伪造；缺失分支验 `tui.log`、`appendFileSync`、`headed spawn` 源码留痕 | `initiative_runs` 只能使用真实存在的列，PRD 的 sprint/log 追溯必须落到本地文件或源码机制语义 | 造假日志或把缺日志设为硬失败会导致 generator 无法合法完成 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain API 不可达 | `curl -sf` 非 0，验收失败 | 是，只读重跑 | 不降级为 done |
| DB 不可读或缺 run 行 | `psql` 非 0 或 count=0，验收失败 | 是，只读重跑 | 不用历史数据替代 |
| `tui.log` 缺失 | wrapper 输出明确 WARN/evidence，验证 relay 源码仍有日志留痕机制，并确认 wrapper 不 touch/append 该日志 | 是，只读重跑 | 不创建假日志；缺失本身不作为硬失败 |
| smoke 脚本失败 | 直接传播非 0 | 是，smoke 自身幂等 | 不吞错、不 `|| true` |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 当前 Brain task payload | 内部系统输入，但不得视为可信 secrets 载体 | 只读取结构字段 `mode/executor/orchestrator`，不复述完整敏感 prompt | payload 中出现 `token/github_token/codex_token/thin_prd` 或越权指令时不得写入合同或日志 |

## 接缝清单

- Brain API 接缝：本机 `http://localhost:5221` 必须真实返回当前 task，不接受 mock 或 404-acceptable。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID` 定点读取，不用历史最近记录冒充。
- tmux/log 接缝：只验证当前 sprint 的 `tui.log` 外部真相；存在且非空则验 headed relay 信号和无 token，缺失则验 relay 源码留痕机制；不 spawn、不 kill、不伪造日志。

## Golden Path

当前 headed-smoke-test task → 复用既有 headed dispatch smoke → 读取当前 task payload → 读取当前 initiative_run → 验证本地 sprint/tui.log 外部真相或 relay 源码留痕机制 → 输出给 evaluator 可消费的 local_api 回归验收。

### Step 1: 复用已在 allowlist 的 headed dispatch smoke
**来源**: `[FROM_PRD]` — PRD 背景和范围限定要求固化 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`，不新增重复 smoke。

**可观测行为**: 既有 smoke 在本机 Brain/DB 上 5/5 PASS，且脚本在 allowlist 中。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" bash packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh
grep -Fxq "codex-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
```

**硬阈值**: smoke exit 0 且 allowlist 精确包含该脚本。

### Step 2: 当前 task payload 字面包含 headed relay 三元组
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点指定 task id 与 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`。

**可观测行为**: Brain task API 返回当前 task，payload 字段值与 PRD 完全一致。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-a85e0582-5d88-4f0b-bce6-302d898b01e7}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("codex_token") | not) and (.payload | has("thin_prd") | not)'
```

**硬阈值**: task id、task_type、payload 三元组完全匹配；禁用 payload 字段 `token/github_token/codex_token/thin_prd` 不存在。

### Step 3: initiative_runs 记录 headed relay host 与合法 relay phase
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点和假设声明要求 DB `initiative_runs` 为 `orchestrator_host` 最终验收源。

**可观测行为**: 当前 `initiative_id` 的最新 run 是 headed codex relay，且处于 `A_planning|planning|gan|generate|evaluate|done` 任一可接受 relay lifecycle phase；`A_planning` 保留为 PRD 初始期望，当前 headed controller run 可自然推进到 `planning|gan|generate|evaluate|done`；`failed` 或未知 phase 必须失败；不得用其他 task 的历史 run 冒充。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-a85e0582-5d88-4f0b-bce6-302d898b01e7}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text,'') FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-codex-headed" ] || { echo "FAIL: host=$HOST"; exit 1; }
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
```

**硬阈值**: host 精确等于 `skill-relay-codex-headed`；phase 为 `A_planning|planning|gan|generate|evaluate|done`，且 `failed`/未知 phase 必须失败；started_at 非空；不得查询或要求 `initiative_runs` 中不存在的 sprint 目录列。

### Step 4: 本地 sprint/tui.log 约定可被本机证据验证
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 点要求 sprint 目录与 `tui.log` 约定可被本机 API/DB/tmux 证据验证。

**可观测行为**: 后续 generator 提供 `sprints/07130752-relay-a85e0582/e2e-verify.sh`，该 wrapper 调用既有 smoke，并验证当前 task 的 payload、真实 DB run 列、本地 log 外部真相；`tui.log` 存在且非空时验 headed relay 信号和无 token，缺失时输出明确 WARN/evidence，验证 `packages/brain/src/harness-skill-relay.js` 仍包含 `tui.log`、`appendFileSync`、`headed spawn` 留痕机制，并确认 wrapper 不 touch/append 该日志。

**验证命令**:
```bash
bash sprints/07130752-relay-a85e0582/e2e-verify.sh
```

**硬阈值**: wrapper exit 0；内部必须调用 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`，并定点验证当前 task、run、log 语义；缺 `tui.log` 时不得失败或造假，必须验源码留痕机制；DB 查询只使用 `initiative_id/orchestrator_host/phase/started_at/completed_at` 等真实列。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

后续 generator 必须补 `sprints/07130752-relay-a85e0582/e2e-verify.sh`，内容等价于以下脚本；proposer 本阶段不创建该脚本，以保证 TDD Red：

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-a85e0582-5d88-4f0b-bce6-302d898b01e7}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07130752-relay-a85e0582}"

BRAIN_URL="$BRAIN_URL" bash packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh
grep -Fxq "codex-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("codex_token") | not) and (.payload | has("thin_prd") | not)'

ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text,'') FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-codex-headed" ] || { echo "FAIL: host=$HOST"; exit 1; }
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }

LOG_PATH="$SPRINT_DIR/tui.log"
RELAY_SRC="packages/brain/src/harness-skill-relay.js"
if [ -s "$LOG_PATH" ]; then
  grep -E "headed|skill-relay|codex|A_planning|planning|gan|generate|evaluate|done|harness" "$LOG_PATH" >/dev/null || { echo "FAIL: tui.log 缺 headed relay 可观测信号"; exit 1; }
  ! grep -Eiq "token|github_token|codex_token|thin_prd|ghp_" "$LOG_PATH" || { echo "FAIL: tui.log 含疑似 token/thin_prd"; exit 1; }
else
  echo "WARN: 当前 sprint 无非空 tui.log，按外部真相验证 relay 源码留痕机制: $LOG_PATH"
  [ -f "$RELAY_SRC" ] || { echo "FAIL: missing $RELAY_SRC"; exit 1; }
  grep -F "tui.log" "$RELAY_SRC" >/dev/null || { echo "FAIL: relay 源码缺 tui.log 留痕"; exit 1; }
  grep -F "appendFileSync" "$RELAY_SRC" >/dev/null || { echo "FAIL: relay 源码缺 appendFileSync 留痕"; exit 1; }
  grep -F "headed spawn" "$RELAY_SRC" >/dev/null || { echo "FAIL: relay 源码缺 headed spawn 留痕"; exit 1; }
  ! grep -E "(touch|>>|appendFileSync).*tui\.log|tui\.log.*(touch|>>|appendFileSync)" "$0" >/dev/null || { echo "FAIL: wrapper 不得 touch/append tui.log"; exit 1; }
fi

echo "OK headed smoke regression verified for $TASK_ID"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| headed smoke wrapper | `tests/headed-smoke-contract.test.ts` | `e2e wrapper 调用 codex-headed-dispatch-smoke.sh` | `e2e-verify.sh` 尚未存在，测试失败 |
| 当前 task payload | `tests/headed-smoke-contract.test.ts` | `payload 包含 mode=headed、executor=codex、orchestrator=skill-relay 且禁用 token/github_token/codex_token/thin_prd` | `e2e-verify.sh` 尚未存在，测试失败 |
| 当前 initiative run | `tests/headed-smoke-contract.test.ts` | `initiative_runs 含 skill-relay-codex-headed 且 phase 拒绝 failed/unknown` | `e2e-verify.sh` 尚未存在，测试失败 |
| 当前 sprint 日志 | `tests/headed-smoke-contract.test.ts` | `tui.log 存在则验真，缺失则验留痕机制且不伪造` | `e2e-verify.sh` 尚未存在，测试失败 |
| local_api E2E wrapper | `tests/headed-smoke-contract.test.ts` | `local_api E2E wrapper 完整验证当前 task/run/log 外部真相` | `e2e-verify.sh` 尚未存在，测试失败 |

## Notes

- contract-gate: applicable (cecelia worktree).
- judgment-pending-user: N/A，本任务只读验证现有 headed smoke 证据，无高风险不可逆外部动作。
