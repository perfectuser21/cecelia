# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面/api_registry推导）

### Endpoint: GET /api/brain/tasks/:task_id
**Success (HTTP 200)**:
```json
{"id":"<uuid>","task_type":"harness_initiative","payload":{"mode":"headed","executor":"claude","orchestrator":"skill-relay","journey_id":"<uuid>"}}
```
- `id` (string, 必填): 来源--PRD 指定 task `14a11fd8-0d2f-49e2-885b-9286fc1d76f7`；api_registry 已登记 `/api/brain/*` 族端点风格，`/api/brain/tasks/:id` 已在 049ebf93/4bb31ef5 先例中沿用同一 schema，本次实测（curl，见下方"已知约束"）字面一致。
- `task_type` (string, 必填): 来源--实测当前 task 记录 `task_type=harness_initiative`。
- `payload.mode` (string, 必填): 来源--PRD 字面值 `headed`，实测一致。
- `payload.executor` (string, 必填): 来源--PRD 字面值 `claude`，实测一致。
- `payload.orchestrator` (string, 必填): 来源--PRD 字面值 `skill-relay`，实测一致。
- `payload.journey_id` (string, 必填): 来源--PRD `journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`，实测一致。
**禁用字段名**: [`token`, `github_token`, `anthropic_token`, `thin_prd`]（实测当前 payload 不含，四字段均缺失）
**Error (HTTP 4xx)**:
```json
{"error":"<string>"}
```

### DB: initiative_runs
**Success**:
```json
{"initiative_id":"<task_id>","orchestrator_host":"skill-relay-claude-headed","phase":"gan","started_at":"<timestamp>"}
```
- `initiative_id` (uuid, 必填): 来源--PRD 当前 task id `14a11fd8-0d2f-49e2-885b-9286fc1d76f7`。
- `orchestrator_host` (string, 必填): 来源--PRD Golden Path 第 2 点，实测 psql 定点查询返回 `skill-relay-claude-headed`。
- `phase` (string, 必填): 来源--PRD 边界情况「`phase` 落在 `failed` → FAIL；不在合法枚举 → FAIL」，实测当前值 `gan`（合法枚举内，非 failed）。
- `started_at` (timestamp, 必填): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列，实测非空。
**DB 列约束**: 只允许使用 `information_schema.columns` 中真实存在的列；本 sprint 不新增/修改 `initiative_runs` schema。

## 已知约束（来自回归测试）

- [tests/regression/relay-049ebf93/headed-smoke-contract.test.ts][累积FR] → 已回归覆盖 task payload 三元组校验、initiative_runs host/phase 校验、payload 敏感字段禁用校验；本次 headed-smoke-contract.test.ts 结构镜像该先例，仅锚定当前 task_id=14a11fd8，不复制其 task_id 字面值。
- [tests/regression/relay-4bb31ef5/headed-smoke-contract.test.ts][累积FR] → 已回归覆盖 ci.yml claude-headed/codex-headed 双分支不互相破坏；本次范围明确不改 ci.yml（见范围限定），不重复该层校验。
- context-manifest: unavailable（`GET /api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 未返回可解析内容；PRD 累积 FR 段已注明"本 line 暂无历史"，两者一致，不阻塞起草）。
- [Proposer核实历史][INV-11 实测记录] → 本轮起草前已用 `curl localhost:5221/api/brain/tasks/14a11fd8-0d2f-49e2-885b-9286fc1d76f7` 与 `psql ... initiative_runs WHERE initiative_id='14a11fd8-0d2f-49e2-885b-9286fc1d76f7'` 核实真实派发历史（非假设复用先例路径）：实测 `payload={mode:headed, executor:claude, orchestrator:skill-relay, journey_id:bb8cc561-..., sprint_dir:sprints/07172014-relay-14a11fd8, ...}`，无 token/github_token/anthropic_token/thin_prd；`initiative_runs` 实测 `orchestrator_host=skill-relay-claude-headed`、`phase=gan`、`started_at` 非空；`claude-headed-dispatch-smoke.sh` 已在 `packages/quality/smoke-allowlist.txt` 登记（实测 grep 命中）；该脚本当前 sha256 基线 `7a3a76b32bc683942d09efe6447ea5ce66a318939d1be9908c2fc4cf5d0a69fb`（55 行）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 为 task_id=14a11fd8 生成锚定该 task 的 `sprints/07172014-relay-14a11fd8/e2e-verify.sh`：复用（不重实现）`claude-headed-dispatch-smoke.sh`，校验其在 allowlist 登记且脚本本体 sha256 未变；校验 Brain task 记录（payload 三元组 + journey_id + 敏感字段脱敏）；校验 `initiative_runs`（host/phase 合法且非 failed）；校验本 sprint 未触碰 CI workflow/allowlist 范围。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本机 `local_api` 同步一次性校验，无长耗时依赖；命令失败即 FAIL，不吞错；只读，不产生新写入；单 slot 串行执行，不并发 spawn。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见 contract-dod.md「Invariant 覆盖条目」，PRD 27 条铁律逐条映射（INV-1~INV-27），3 条 PrepPRD 来源铁律（复用不重写/CI范围锁定/禁止吞错）均为真实可执行断言。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本 sprint 的 e2e-verify.sh 锚定当前 task_id=14a11fd8，是一次性回归证据（该 journey 第 6 次同结构冒烟）；`claude-headed-dispatch-smoke.sh` 语义变更时由其维护者更新；本文件 schema 变更判定：`tasks`/`initiative_runs` 表结构变更时需重写。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator 执行 DoD/E2E 任一命令非 0 即暴露失败；CI allowlist 中 `claude-headed-dispatch-smoke.sh` 失败会导致棘轮闸红；本 sprint 不新增告警面。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见下方「失败语义声明」表；故障一律拦截，不放行，只读重跑幂等。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 以当前 task 的 Brain API 响应与 `initiative_runs` 定点查询（`initiative_id = TASK_ID`）作为唯一外部真相；smoke 脚本 exit code + allowlist 登记 + sha256 基线比对作为"未重实现"证据；`git diff origin/main` 空结果作为"未越权改 CI"证据。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| headed relay run 归属当前 task | A. 只看最近一条 run（不限 initiative_id）; B. 用 `initiative_id = TASK_ID` 定点查 DB | B. 用当前 task id 定点查 | PRD 边界情况明确要求「`initiative_runs` 无该 initiative_id 记录 → FAIL」 | 历史其他 task（a85e0582/cd0b936c/049ebf93/63db6f8a/4bb31ef5）的 run 冒充当前任务验收，导致假 done |
| smoke 脚本"复用不重写"判定 | A. 只看是否调用同名脚本; B. 校验脚本内容 sha256 与起草时基线一致 | B. sha256 基线比对 | PRD Invariant「复用不重写」要求"只能复用调用"，仅调用不足以排除 generator 顺手改了脚本内容 | 若只查调用关系，generator 可悄悄改写 smoke 脚本内部逻辑而不被察觉 |
| CI 范围是否被越权修改 | A. 只 grep ci.yml 是否含特定字符串; B. `git diff origin/main -- .github/workflows/ packages/quality/smoke-allowlist.txt` 判空 | B. git diff 判空 | PRD 范围限定明确「不在范围内: 修改 .github/workflows/*.yml 或 smoke-allowlist.txt」，diff 判空是唯一不依赖具体内容假设的检测方式 | 若只做字符串 grep，遗漏新增/删除行等未预期改动 |
| phase 合法性判定 | A. 只拒绝 `failed`，其余一律放行; B. 白名单枚举 `A_planning\|planning\|gan\|generate\|evaluate\|done`，`failed`/其余非法值一律拒绝 | B. 白名单枚举 + 显式拒绝 failed | PRD 边界情况「`phase` 落在 `failed` 或不在合法枚举内 → FAIL」 | 若只拒绝 failed，未来新增的中间态/损坏态字符串会被误判为通过 |

> judgment-pending-user: N/A，本任务只读验证现有 headed relay 证据，无高风险不可逆外部动作，PrepPRD 已明确锚定验收点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain task API 不可达/404 | `curl -sf` 非 0，验收失败 | 是，只读重跑 | 不降级为 done |
| task payload 三元组/journey_id 不匹配或含禁用字段 | jq -e 断言失败，非 0 退出 | 是，只读重跑 | 不允许放行 |
| `initiative_runs` 无该 initiative_id 记录 | 显式 FAIL + exit 1 | 是，只读重跑 | 不用历史其他 task 的记录替代 |
| `initiative_runs.phase` = failed 或非法枚举 | 显式 FAIL + exit 1 | 是，只读重跑 | 不放行 |
| `claude-headed-dispatch-smoke.sh` 未登记 allowlist 或 sha256 与基线不符（疑似被改写） | 显式 FAIL + exit 1 | 是，只读重跑 | 不静默跳过登记/完整性校验 |
| 本 PR 触碰 `.github/workflows/` 或 `smoke-allowlist.txt` | `git diff origin/main` 非空 → 显式 FAIL + exit 1 | 是，只读重跑 | 不允许 CI 范围越权 |
| smoke 脚本本体执行失败 | 直接传播非 0 exit code | 是，smoke 自身幂等（只读 POST 测试端点） | 不吞错、不 `\|\| true`、不 `MOCK_` |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

（本任务 e2e-verify.sh 不对外暴露 agent 接口，只读调用内部 Brain API 与本地 DB，N/A）

## 禁 mock 边清单

（本单纯新增只读验证脚本，不改调度/状态机/跨模块数据传递/生命周期钩子/DB写路径，无接缝边，N/A）

## 接缝清单

- Brain API 接缝：本机 `http://localhost:5221` 必须真实返回当前 task（已实测：`payload.mode=headed`/`payload.executor=claude`/`payload.orchestrator=skill-relay`/`payload.journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`/`payload.sprint_dir=sprints/07172014-relay-14a11fd8` 且无禁用字段），不接受 mock 或 404-acceptable。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID=14a11fd8-0d2f-49e2-885b-9286fc1d76f7` 定点读取（已实测：`orchestrator_host=skill-relay-claude-headed`、`phase=gan`），不用历史最近记录冒充。
- smoke/allowlist 接缝：`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已存在且已在 `packages/quality/smoke-allowlist.txt` 登记（已实测），本次只校验存在性、登记状态与内容完整性（sha256），不重新实现/不重复登记。
- CI 基础设施接缝：`.github/workflows/*.yml` 与 `packages/quality/smoke-allowlist.txt` 本次不得有 diff（`git diff origin/main` 判空），已用当前 HEAD 实测两文件最近改动 commit 均早于本轮起草。

## Golden Path

Brain 派发 headed relay 任务（task_id=14a11fd8）→ e2e-verify.sh 复用调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记 + 脚本完整性 → 查 Brain task API 核对 payload 三元组/journey_id 与敏感字段脱敏 → 查 DB initiative_runs 核对 host/phase → 校验本 sprint 未越权修改 CI 基础设施 → 全部通过则 exit 0 打印 PASS，任一失败则 exit 1 打印 FAIL 原因。

### Step 1: 复用调用 claude-headed-dispatch-smoke.sh，校验其在 allowlist 登记且脚本本体未被改写
**来源**: `[FROM_PRD]` — PRD「E2E 验收」第 3 点、「范围限定」「Invariant 约束」[复用不重写] 明确要求复用既有脚本、校验其在 `packages/quality/smoke-allowlist.txt` 登记，且「不新增/修改 `claude-headed-dispatch-smoke.sh` 本体」。

**可观测行为**: `claude-headed-dispatch-smoke.sh` 在本机 Brain 上全绿（exit 0）；该脚本文件名精确出现在 allowlist 文件中；脚本内容 sha256 与起草时基线一致（未被 generator 顺手改写）。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
[ "$(shasum -a 256 packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh | awk '{print $1}')" = "7a3a76b32bc683942d09efe6447ea5ce66a318939d1be9908c2fc4cf5d0a69fb" ]
```

**硬阈值**: smoke 脚本 exit 0；allowlist 精确逐行匹配包含该脚本名（`grep -Fxq`）；sha256 完全等于基线值（不重写不是"看起来没改"，是字节级未变）。

### Step 2: 当前 task 记录 payload 三元组 + journey_id 齐全且不含敏感字段
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点 + 「E2E 验收」第 2 点，要求 `GET /api/brain/tasks/14a11fd8...` 返回 task，payload 三元组齐全，且不含 `token`/`github_token`/`anthropic_token`/`thin_prd` 明文字段。

**可观测行为**: Brain task API 返回当前 task，`id` 等于 TASK_ID，`payload.mode/executor/orchestrator/journey_id` 精确匹配，且四个禁用字段均不存在于 payload。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-14a11fd8-0d2f-49e2-885b-9286fc1d76f7}"
export TASK_ID
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '.payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)'
```

**硬阈值**: task id 完全匹配；payload 三元组 + journey_id 完全匹配；四个禁用字段全部不存在，任一存在即 FAIL。

### Step 3: initiative_runs 记录当前 task 的 headed relay host 与合法 phase
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 「边界情况」段：`initiative_runs` 无该 initiative_id 记录 → FAIL；`phase` 落在 `failed` → FAIL；不在合法枚举内 → FAIL。

**可观测行为**: 当前 `initiative_id=14a11fd8-0d2f-49e2-885b-9286fc1d76f7` 至少一条 run 记录，`orchestrator_host` 含 `skill-relay-claude-headed`，`phase` 处于合法 relay lifecycle 枚举且非 `failed`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-14a11fd8-0d2f-49e2-885b-9286fc1d76f7}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
case "$HOST" in *skill-relay-claude-headed*) ;; *) echo "FAIL: host=$HOST"; exit 1 ;; esac
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
```

**硬阈值**: `initiative_runs` 至少一行；`orchestrator_host` 含 `skill-relay-claude-headed`；`phase` 属于 `A_planning|planning|gan|generate|evaluate|done` 白名单且非 `failed`；`started_at` 非空。

### Step 4: 本 sprint 未越权修改 CI workflow / smoke-allowlist（CI 范围锁定）
**来源**: `[FROM_PRD]` — PRD「范围限定」明确「不在范围内: 修改 `.github/workflows/*.yml` 或 `packages/quality/smoke-allowlist.txt`（4bb31ef5 先例已锁定该范围）」+ Invariant [CI范围锁定]/[CI基础设施禁区]。

**可观测行为**: 本分支相对 `origin/main` 在 `.github/workflows/` 与 `packages/quality/smoke-allowlist.txt` 路径下无任何文件差异。

**验证命令**:
```bash
git fetch origin main --quiet 2>/dev/null || true
DIFF=$(git diff origin/main...HEAD --name-only -- .github/workflows/ packages/quality/smoke-allowlist.txt)
[ -z "$DIFF" ] || { echo "FAIL: CI 范围越权改动: $DIFF"; exit 1; }
```

**硬阈值**: diff 输出为空字符串，任何非空输出即 FAIL。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

后续 generator 必须补 `sprints/07172014-relay-14a11fd8/e2e-verify.sh`，内容等价于以下脚本；proposer 本阶段不创建该脚本，以保证 TDD Red。

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-14a11fd8-0d2f-49e2-885b-9286fc1d76f7}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07172014-relay-14a11fd8}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
SMOKE_SCRIPT="packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh"
ALLOWLIST="packages/quality/smoke-allowlist.txt"
BASELINE_SHA256="7a3a76b32bc683942d09efe6447ea5ce66a318939d1be9908c2fc4cf5d0a69fb"
export TASK_ID

# Step 1: 复用调用 smoke 脚本 + allowlist 登记 + 完整性（未被重实现）
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash "$SMOKE_SCRIPT"

if ! grep -Fxq "claude-headed-dispatch-smoke.sh" "$ALLOWLIST"; then
  echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 登记"
  exit 1
fi

CUR_SHA256=$(shasum -a 256 "$SMOKE_SCRIPT" | awk '{print $1}')
if [ "$CUR_SHA256" != "$BASELINE_SHA256" ]; then
  echo "FAIL: $SMOKE_SCRIPT 内容已变化（sha256=$CUR_SHA256 期望=$BASELINE_SHA256），疑似被重新实现"
  exit 1
fi

# Step 2: 当前 task payload 三元组 + journey_id + 敏感字段脱敏
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null
echo "$RESP" | jq -e '.payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null

# Step 3: initiative_runs host/phase
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无当前 task run"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)

case "$HOST" in
  *skill-relay-claude-headed*) ;;
  *) echo "FAIL: host=$HOST"; exit 1 ;;
esac
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in
  A_planning|planning|gan|generate|evaluate|done) ;;
  *)
    echo "FAIL: phase=$PHASE"
    exit 1
    ;;
esac
if [ -z "$STARTED_AT" ]; then
  echo "FAIL: started_at 为空"
  exit 1
fi

# Step 4: CI 范围锁定（不越权改 workflow/allowlist）
git fetch origin main --quiet 2>/dev/null || true
CI_DIFF=$(git diff origin/main...HEAD --name-only -- .github/workflows/ "$ALLOWLIST" 2>/dev/null || echo "")
if [ -n "$CI_DIFF" ]; then
  echo "FAIL: CI 范围越权改动: $CI_DIFF"
  exit 1
fi

echo "OK headed smoke regression verified for $TASK_ID"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| e2e-verify.sh 复用 smoke 脚本并校验 allowlist + 完整性 | `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts` | `e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记与脚本完整性` | `e2e-verify.sh` 尚未存在，测试失败 |
| task payload 三元组 + journey_id + 敏感字段脱敏 | `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts` | `payload 三元组与 journey_id 齐全且禁用 token/github_token/anthropic_token/thin_prd` | `e2e-verify.sh` 尚未存在，测试失败 |
| initiative_runs host/phase 校验 | `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts` | `initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/非法枚举` | `e2e-verify.sh` 尚未存在，测试失败 |
| CI 范围锁定不越权改 workflow/allowlist | `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts` | `不越权修改 CI workflow 或 smoke-allowlist` | `e2e-verify.sh` 尚未存在，测试失败 |
| local_api E2E wrapper 完整链路无 mock/吞错 | `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts` | `local_api E2E wrapper 完整验证当前 task 全链路无 mock 无吞错` | `e2e-verify.sh` 尚未存在，测试失败 |

## Notes

- contract-gate: applicable (cecelia worktree)。
- judgment-pending-user: N/A，本任务只读验证现有 headed relay 证据，无高风险不可逆外部动作。
- 27 条 PRD Invariant 全量映射见 `contract-dod.md` 「Invariant 覆盖条目」段（INV-1~INV-27），3 条 PrepPRD 来源铁律（复用不重写=INV-1/CI范围锁定=INV-2/禁止吞错=INV-3）均为真实可执行 manual:bash 断言，非 N/A。
- self-check 已知假阳性：Step 2b-check 第 6 项全角标点检测正则对本机 grep 下任意 `"$VAR` 结尾行均可能误报（已毕业先例 `scripts/smoke/e2e/relay-4bb31ef5.sh`/`relay-049ebf93.sh` 同正则同样出现误报且均已过 GAN/evaluator/merge），本合同 E2E 脚本审阅未发现真实全角标点紧贴 `$VAR` 的实例，判定为环境性假阳性，不阻塞交付。
- **Round 2 修复（Reviewer r1 阻塞项）**：Step 2 校验命令片段（`.id == env.TASK_ID`）在起草阶段被手工复制 3 处，其中 2 处（本文件 Step 2 文档块第 117 行前 / `contract-dod.md` 第 130-132 行 BEHAVIOR）缺 `export TASK_ID`，导致 `jq` 子进程读不到未导出的 shell 变量，`env.TASK_ID` 恒为 `null`——是坏掉的 oracle，与 Generator 实现是否正确无关。已在两处补 `export TASK_ID`（与本文件第 173-244 行最终 `e2e-verify.sh` 第 183 行的既有正确写法保持一致，三处现已一致）。修复后已真实执行验证：contract-dod.md 第 131 行提取出的命令单独真跑 4 条 jq -e 断言全部 `true` + `OK`，`REAL_EXIT=0`；contract-draft.md Step 2 文档块单独真跑同样 `REAL_EXIT=0`；最终 e2e-verify.sh 完整脚本重新真跑仍 `REAL_EXIT=0`（PASS: 5 FAIL: 0）。
