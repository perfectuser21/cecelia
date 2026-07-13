# Sprint Contract Draft (Round 2)

## Round 2 修订说明（按 Reviewer Round 1 feedback 修订，仅修 2 条，其余不动）

- 问题1（DoD.md 覆盖缺失）：Golden Path 新增 Step 6，contract-dod.md 新增 `[ARTIFACT]` 条目验证 `DoD.md` 已记录本 sprint。
- 问题2（CI seed 一致性弱 oracle）：Step 4 与 `## E2E 验收` 脚本改为顺序性静态断言（Plan A）——用 `grep -n` 取行号，断言 `skill-relay-claude-headed` 精确判定行号必须早于 codex 通用/兜底 `"executor":"codex"` seed 行号，防止 claude-headed 任务被误 seed 成 codex 身份；原有 4 条 grep 存在性检查保留不删。

## Response Schema（推导来源: PRD字面/api_registry推导）

### Endpoint: GET /api/brain/tasks/:task_id
**Success (HTTP 200)**:
```json
{"id":"<uuid>","task_type":"harness_initiative","payload":{"mode":"headed","executor":"claude","orchestrator":"skill-relay"}}
```
- `id` (string, 必填): 来源--PRD 指定 task `4bb31ef5-e140-41f4-9daf-9ca4a9e51216`；api_registry 已登记 `/api/brain/tasks`。
- `task_type` (string, 必填): 来源--PRD 要求 task 为 claude-headed-smoke 的 `harness_initiative`。
- `payload.mode` (string, 必填): 来源--PRD 字面值 `headed`。
- `payload.executor` (string, 必填): 来源--PRD 字面值 `claude`。
- `payload.orchestrator` (string, 必填): 来源--PRD 字面值 `skill-relay`。
**禁用字段名**: [`token`, `github_token`, `anthropic_token`, `thin_prd`]
**Error (HTTP 4xx)**:
```json
{"error":"<string>"}
```

### DB: initiative_runs
**Success**:
```json
{"initiative_id":"<task_id>","orchestrator_host":"skill-relay-claude-headed","phase":"gan","started_at":"<timestamp>","completed_at":"<timestamp|null>"}
```
- `initiative_id` (uuid, 必填): 来源--PRD 当前 task id。
- `orchestrator_host` (string, 必填): 来源--PRD Golden Path 第 2 点，以 DB `initiative_runs` 为最终验收源。
- `phase` (string, 必填): 来源--DB 当前真实枚举与 relay 生命周期；允许 `A_planning|planning|gan|generate|evaluate|done`。当前实测值为 `gan`（controller 已核实）；`failed` 或未知 phase 必须失败。
- `started_at` (timestamp, 必填): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列；当前实测非空。
- `completed_at` (timestamp/null, 可选): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列。
**DB 列约束**: 只允许使用 `information_schema.columns` 中真实存在的列；sprint/log 追溯只能验本地 `sprints/07130939-relay-4bb31ef5/` wrapper 语义。

### CI: .github/workflows/ci.yml「Seed smoke task for DoD dynamic behavior」步骤
**Success（claude-headed 分支存在且不破坏 codex-headed 分支）**:
- 该步骤能识别 task-card 内 `skill-relay-claude-headed` 标记，并 seed `orchestrator_host='skill-relay-claude-headed'` + `payload.executor='claude'` 的 task/run；
- 原有 `skill-relay-codex-headed` 检测分支与 seed（`payload.executor='codex'`）保持不变，两分支互斥、不冲突。
- 来源--PRD「CI seed 一致性」NFR 与「不在范围内」条款（不得回归破坏 codex-headed 既有分支）。

## 已知约束（来自回归测试）

- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(mode=headed, executor=codex) 返回 200 且有 id。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(executor=claude, mode=headed) 返回 200/201。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(mode=headless) 返回 200/201。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> POST tasks(mode=invalid) 返回 400。
- [packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh] -> initiative_runs.tmux_killed_at 字段存在。
- [.github/workflows/ci.yml「Seed smoke task for DoD dynamic behavior」] -> 当前仅识别 `skill-relay-codex-headed` / 通用 `mode=headed`+`orchestrator=skill-relay` 模式，无条件 seed `orchestrator_host='skill-relay-codex-headed'` + `executor='codex'`（即：claude-headed 的 DoD 若只含通用 headed 关键字会被错误 seed 成 codex 身份，必须在本 sprint 修正为按 `skill-relay-claude-headed` 精确路由到 claude 分支）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 把 codex-headed（#3827）已验证的 headed relay 回归链路同构镜像到 claude-headed：验证当前 task payload、initiative_runs headed relay 状态、新增对称 smoke 并登记 allowlist、修补 CI DoD 动态 seed 步骤使其为 claude-headed 分支 seed 出匹配数据。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本机 `local_api` 可执行；命令失败即失败；不重复 spawn，不误杀会话；日志不输出 token 或敏感 prompt；CI seed 步骤 claude-headed 分支与 codex-headed 既有分支互不回归。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不新增业务功能/UI/migration；不扩大到 headless 或其他 executor；不写 token；已有 run/session 只读验证；codex-headed 既有 seed/断言不得被破坏。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | smoke allowlist 或 `claude-headed-dispatch-smoke.sh`/`codex-headed-dispatch-smoke.sh` 语义变更时本合同过期，由后续 harness 维护者更新。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator 执行 DoD/E2E 任一命令非 0 即暴露；CI allowlist 中该 smoke 失败应红；ci.yml seed 分支回归会导致 codex-headed 或 claude-headed 任一方的 DoD 动态验证在下一次 PR 中失败。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | Brain API/DB 证据缺失时拦截 done；`tui.log` 缺失时走 WARN/evidence + 源码留痕机制验证；验证只读，重跑幂等；CI seed 步骤两分支互斥判定失败时拦截（不得两个分支都不匹配导致回退到旧通用逻辑误 seed）。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 复用 smoke 的 5/5 PASS；以当前 task payload、DB run、本地 sprint/tui.log（存在时）或 relay 源码留痕机制（缺失时）作为当前任务外部真相；ci.yml 分支正确性以 grep 静态断言 + 已有 codex-headed 分支保持不变为准。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| headed relay run 归属当前 task | A. 只看最近一条 run; B. 用 `initiative_id = TASK_ID` 定点查 DB | B. 用当前 task id 定点查 | PRD 指定 task id，历史 run 不能冒充当前任务 | 历史 headed run 冒充本轮验收，导致假 done |
| headed relay host 判定 | A. Brain runs API 推断; B. DB `initiative_runs.orchestrator_host` | B. DB 字段等于 `skill-relay-claude-headed` | PRD 假设声明 DB 为最终验收源 | 错把非 headed/claude relay 当作通过 |
| sprint 日志位置可观测 | A. 查询 DB 中不存在的 sprint 目录列; B. `tui.log` 存在且非空时验真，缺失时输出 WARN/evidence 并验 `harness-skill-relay.js` 留痕机制 | B. 当前外部真相为本 sprint 无 `tui.log`，不得伪造；缺失分支验 `tui.log`、`appendFileSync`、`headed spawn` 源码留痕 | `initiative_runs` 只能使用真实存在的列，PRD 的 sprint/log 追溯必须落到本地文件或源码机制语义 | 造假日志或把缺日志设为硬失败会导致 generator 无法合法完成 |
| ⚠️ CI seed 步骤是否正确区分 codex/claude headed 分支 | A. 复用通用 `mode=headed`+`orchestrator=skill-relay` 关键字判定，硬编码 seed codex 身份; B. 优先精确匹配 `skill-relay-claude-headed` 走 claude 分支，其余走既有 codex 分支 | B. 精确匹配优先，两分支互斥 | PRD「CI seed 一致性」明确要求 claude-headed 分支 seed executor=claude 且不得回归破坏 codex-headed | 若沿用旧通用判定，claude-headed 的 DoD 动态验证会被错误 seed 成 codex 身份，evaluator BEHAVIOR 全部假绿/假红 |

> judgment-pending-user: N/A，本任务只读验证现有 headed smoke 证据 + CI seed 分支补齐，无高风险不可逆外部动作，PrepPRD 已锚定 CI seed 一致性为硬 DoD。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain API 不可达 | `curl -sf` 非 0，验收失败 | 是，只读重跑 | 不降级为 done |
| DB 不可读或缺 run 行 | `psql` 非 0 或 count=0，验收失败 | 是，只读重跑 | 不用历史数据替代 |
| `tui.log` 缺失 | wrapper 输出明确 WARN/evidence，验证 relay 源码仍有日志留痕机制，并确认 wrapper 不 touch/append 该日志 | 是，只读重跑 | 不创建假日志；缺失本身不作为硬失败 |
| smoke 脚本失败 | 直接传播非 0 | 是，smoke 自身幂等 | 不吞错、不 `|| true` |
| ci.yml claude-headed 分支未命中或命中 codex 分支 | grep 静态断言失败，contract-dod 拦截 done | 是，静态检查幂等 | 不允许两分支共用同一 seed 逻辑蒙混过关 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 当前 Brain task payload | 内部系统输入，但不得视为可信 secrets 载体 | 只读取结构字段 `mode/executor/orchestrator`，不复述完整敏感 prompt | payload 中出现 `token/github_token/anthropic_token/thin_prd` 或越权指令时不得写入合同或日志 |

## 接缝清单

- Brain API 接缝：本机 `http://localhost:5221` 必须真实返回当前 task，不接受 mock 或 404-acceptable。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID` 定点读取，不用历史最近记录冒充。
- tmux/log 接缝：只验证当前 sprint 的 `tui.log` 外部真相；存在且非空则验 headed relay 信号和无 token，缺失则验 relay 源码留痕机制；不 spawn、不 kill、不伪造日志。
- CI YAML 接缝：`.github/workflows/ci.yml` 的 seed 步骤是真实 YAML 文本，本合同的验证是静态 grep 断言（非跑一次真实 GHA），generator 必须在文件中落地可 grep 到的 claude-headed 分支逻辑，且原 codex-headed 分支文本保持存在。

## Golden Path

当前 claude-headed-smoke task → 新增与 codex 版对称的 headed dispatch smoke 并登记 allowlist → 读取当前 task payload → 读取当前 initiative_run → CI DoD 动态 seed 步骤补齐 claude-headed 分支且不回归 codex-headed → 验证本地 sprint/tui.log 外部真相或 relay 源码留痕机制 → DoD.md 记录本 sprint claude-headed relay DoD → 输出给 evaluator 可消费的 local_api 回归验收。

### Step 1: 新增与 codex 版对称的 claude headed dispatch smoke 并登记 allowlist
**来源**: `[FROM_PRD]` — PRD 范围限定要求新增 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 并登记 `packages/quality/smoke-allowlist.txt`。

**可观测行为**: 新 smoke 在本机 Brain/DB 上 5/5 PASS，且脚本在 allowlist 中；与 `codex-headed-dispatch-smoke.sh` 语义对称（POST headed/executor=claude、headless、invalid mode、tmux_killed_at 字段）。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
```

**硬阈值**: smoke exit 0 且 allowlist 精确包含该脚本。

### Step 2: 当前 task payload 字面包含 headed relay 三元组
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点指定 task id 与 `mode=headed`、`executor=claude`、`orchestrator=skill-relay`。

**可观测行为**: Brain task API 返回当前 task，payload 字段值与 PRD 完全一致，且不含 `token/github_token/anthropic_token/thin_prd`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)'
```

**硬阈值**: task id、task_type、payload 三元组完全匹配；禁用 payload 字段 `token/github_token/anthropic_token/thin_prd` 不存在。

### Step 3: initiative_runs 记录 headed relay host 与合法 relay phase
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点和假设声明要求 DB `initiative_runs` 为 `orchestrator_host` 最终验收源。

**可观测行为**: 当前 `initiative_id` 的最新 run 是 headed claude relay，且处于 `A_planning|planning|gan|generate|evaluate|done` 任一可接受 relay lifecycle phase（controller 已核实当前实测值为 `gan`）；`failed` 或未知 phase 必须失败；不得用其他 task 的历史 run 冒充。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text,'') FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: host=$HOST"; exit 1; }
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
```

**硬阈值**: host 精确等于 `skill-relay-claude-headed`；phase 为 `A_planning|planning|gan|generate|evaluate|done`，且 `failed`/未知 phase 必须失败；started_at 非空；不得查询或要求 `initiative_runs` 中不存在的 sprint 目录列。

### Step 4: CI 的 DoD 动态 seed 步骤补齐 claude-headed 分支，且不回归 codex-headed
**来源**: `[FROM_PRD]` — PRD 关键不可漏第 2 条与「CI seed 一致性」NFR：`.github/workflows/ci.yml` 的 DoD 动态 seed 步骤须为 claude-headed 分支 seed `orchestrator_host=skill-relay-claude-headed` + `executor=claude`，且不回归 codex-headed 既有分支。

**可观测行为**: `.github/workflows/ci.yml` 的「Seed smoke task for DoD dynamic behavior」步骤文本同时含：(a) 精确匹配 `skill-relay-claude-headed` 的检测分支，seed 时 `payload` 含 `"executor":"claude"` 且 `orchestrator_host` 插入值为 `'skill-relay-claude-headed'`；(b) 原 `skill-relay-codex-headed` 检测分支与 `"executor":"codex"` seed 逻辑原样保留；(c) claude-headed 精确判定在文本顺序上先于 codex 通用/兜底 `"executor":"codex"` seed（顺序性静态断言，Plan A），防止 claude-headed task-card 落入旧通用 OR 分支被误 seed 成 codex 身份。

**验证命令**:
```bash
CI_YML=".github/workflows/ci.yml"
grep -F "skill-relay-claude-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 缺 claude-headed 分支标记"; exit 1; }
grep -F "skill-relay-codex-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 回归破坏 codex-headed 分支"; exit 1; }
grep -F '"executor":"claude"' "$CI_YML" >/dev/null || { echo "FAIL: ci.yml claude-headed 分支未 seed executor=claude"; exit 1; }
grep -F '"executor":"codex"' "$CI_YML" >/dev/null || { echo "FAIL: ci.yml codex-headed 分支 executor=codex 被移除"; exit 1; }
# 顺序性静态断言（Plan A）：claude-headed 精确判定必须优先于 codex 通用/兜底 seed 判定，
# 否则 generator 只需在文件任意处堆 4 个目标字符串（含死分支/注释）即可让上面 4 条 grep 全过，
# 而"claude-headed 被误 seed 成 codex"的真实回归可能原封不动。
CLAUDE_LINE=$(grep -n "skill-relay-claude-headed" "$CI_YML" | head -1 | cut -d: -f1)
CODEX_SEED_LINE=$(grep -n '"executor":"codex"' "$CI_YML" | head -1 | cut -d: -f1)
[ -n "$CLAUDE_LINE" ] && [ -n "$CODEX_SEED_LINE" ] || { echo "FAIL: 缺 claude/codex 行号，无法判定优先级"; exit 1; }
[ "$CLAUDE_LINE" -lt "$CODEX_SEED_LINE" ] || { echo "FAIL: claude-headed 精确判定(行$CLAUDE_LINE)未先于 codex 通用/兜底 seed(行$CODEX_SEED_LINE)，claude-headed 任务可能被误 seed 成 codex 身份"; exit 1; }
```

**硬阈值**: 前四条 grep 全部命中（claude-headed 标记存在、codex-headed 标记存在、claude executor seed 存在、codex executor seed 存在），任一缺失即 FAIL；且 `skill-relay-claude-headed` 首次出现行号必须严格小于 `"executor":"codex"` 首次出现行号（顺序性静态断言），否则 FAIL——这是静态文本断言，验证的是"两分支并存不冲突 + claude-headed 精确判定优先于 codex 兜底"这一 PRD 硬约束。

### Step 5: 本地 sprint/tui.log 约定可被本机证据验证
**来源**: `[FROM_PRD]` — PRD 边界情况要求 `tui.log` 缺失时输出 WARN/evidence，转而验 `packages/brain/src/harness-skill-relay.js` 的留痕机制。

**可观测行为**: 后续 generator 提供 `sprints/07130939-relay-4bb31ef5/e2e-verify.sh`，该 wrapper 调用新 smoke，并验证当前 task 的 payload、真实 DB run 列、CI seed 分支、本地 log 外部真相；`tui.log` 存在且非空时验 headed relay 信号和无 token，缺失时输出明确 WARN/evidence，验证 `packages/brain/src/harness-skill-relay.js` 仍包含 `tui.log`、`appendFileSync`、`headed spawn` 留痕机制，并确认 wrapper 不 touch/append 该日志。

**验证命令**:
```bash
bash sprints/07130939-relay-4bb31ef5/e2e-verify.sh
```

**硬阈值**: wrapper exit 0；内部必须调用 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`，并定点验证当前 task、run、log、ci.yml seed 分支语义；缺 `tui.log` 时不得失败或造假，必须验源码留痕机制；DB 查询只使用 `initiative_id/orchestrator_host/phase/started_at/completed_at` 等真实列。

### Step 6: DoD.md 记录本 sprint claude-headed relay DoD
**来源**: `[FROM_PRD]` — PRD「范围限定」第 4 点与「预期受影响文件」明确要求"更新 DoD.md 记录本 sprint的 claude-headed relay DoD"。

**可观测行为**: 仓库根目录 `DoD.md` 的内容已更新，含本 sprint 的 claude-headed relay DoD 记录，可通过关键字 `skill-relay-claude-headed` 或本 sprint dir `07130939-relay-4bb31ef5` 命中，与本 sprint 的 `contract-dod.md` 对应（参照 codex-headed 版 `DoD.md` 现状：整份文件记录最近一次 headed relay sprint 的 DoD）。

**验证命令**:
```bash
grep -E "skill-relay-claude-headed|07130939-relay-4bb31ef5" DoD.md >/dev/null || { echo "FAIL: DoD.md 未记录本 sprint claude-headed relay DoD"; exit 1; }
```

**硬阈值**: `DoD.md` 命中 `skill-relay-claude-headed` 或 `07130939-relay-4bb31ef5` 任一关键字，否则 FAIL。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

后续 generator 必须补 `sprints/07130939-relay-4bb31ef5/e2e-verify.sh`，内容等价于以下脚本；proposer 本阶段不创建该脚本，以保证 TDD Red：

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07130939-relay-4bb31ef5}"
CI_YML=".github/workflows/ci.yml"

BRAIN_URL="$BRAIN_URL" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)'

ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text,'') FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: host=$HOST"; exit 1; }
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }

grep -F "skill-relay-claude-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 缺 claude-headed 分支标记"; exit 1; }
grep -F "skill-relay-codex-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 回归破坏 codex-headed 分支"; exit 1; }
grep -F '"executor":"claude"' "$CI_YML" >/dev/null || { echo "FAIL: ci.yml claude-headed 分支未 seed executor=claude"; exit 1; }
grep -F '"executor":"codex"' "$CI_YML" >/dev/null || { echo "FAIL: ci.yml codex-headed 分支 executor=codex 被移除"; exit 1; }
CLAUDE_LINE=$(grep -n "skill-relay-claude-headed" "$CI_YML" | head -1 | cut -d: -f1)
CODEX_SEED_LINE=$(grep -n '"executor":"codex"' "$CI_YML" | head -1 | cut -d: -f1)
[ -n "$CLAUDE_LINE" ] && [ -n "$CODEX_SEED_LINE" ] || { echo "FAIL: 缺 claude/codex 行号，无法判定优先级"; exit 1; }
[ "$CLAUDE_LINE" -lt "$CODEX_SEED_LINE" ] || { echo "FAIL: claude-headed 精确判定(行$CLAUDE_LINE)未先于 codex 通用/兜底 seed(行$CODEX_SEED_LINE)，claude-headed 任务可能被误 seed 成 codex 身份"; exit 1; }

grep -E "skill-relay-claude-headed|07130939-relay-4bb31ef5" DoD.md >/dev/null || { echo "FAIL: DoD.md 未记录本 sprint claude-headed relay DoD"; exit 1; }

LOG_PATH="$SPRINT_DIR/tui.log"
RELAY_SRC="packages/brain/src/harness-skill-relay.js"
if [ -s "$LOG_PATH" ]; then
  grep -E "headed|skill-relay|claude|A_planning|planning|gan|generate|evaluate|done|harness" "$LOG_PATH" >/dev/null || { echo "FAIL: tui.log 缺 headed relay 可观测信号"; exit 1; }
  ! grep -Eiq "token|github_token|anthropic_token|thin_prd|ghp_" "$LOG_PATH" || { echo "FAIL: tui.log 含疑似 token/thin_prd"; exit 1; }
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
| headed smoke wrapper | `tests/headed-smoke-contract.test.ts` | `e2e wrapper 调用 claude-headed-dispatch-smoke.sh` | `e2e-verify.sh` 尚未存在，测试失败 |
| 当前 task payload | `tests/headed-smoke-contract.test.ts` | `payload 包含 mode=headed、executor=claude、orchestrator=skill-relay 且禁用 token/github_token/anthropic_token/thin_prd` | `e2e-verify.sh` 尚未存在，测试失败 |
| 当前 initiative run | `tests/headed-smoke-contract.test.ts` | `initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/unknown` | `e2e-verify.sh` 尚未存在，测试失败 |
| CI seed 分支一致性（顺序性静态断言）| `tests/headed-smoke-contract.test.ts` | `ci.yml claude-headed 分支 seed executor=claude 且不回归 codex-headed 既有分支`；`ci.yml claude-headed 精确分支优先于 codex 通用/兜底分支` | `e2e-verify.sh` 尚未存在，测试失败；ci.yml 当前无 `skill-relay-claude-headed`，行号比较断言同样失败 |
| 当前 sprint 日志 | `tests/headed-smoke-contract.test.ts` | `tui.log 存在则验真，缺失则验留痕机制且不伪造` | `e2e-verify.sh` 尚未存在，测试失败 |
| DoD.md 记录本 sprint DoD | `tests/headed-smoke-contract.test.ts` | `DoD.md 已记录本 sprint claude-headed relay DoD` | `e2e-verify.sh` 尚未存在，测试失败 |
| local_api E2E wrapper | `tests/headed-smoke-contract.test.ts` | `local_api E2E wrapper 完整验证当前 task/run/log/ci-seed 外部真相` | `e2e-verify.sh` 尚未存在，测试失败 |

## Notes

- contract-gate: applicable (cecelia worktree).
- judgment-pending-user: N/A，本任务只读验证现有 headed smoke 证据 + CI seed 分支补齐，无高风险不可逆外部动作。
