# Sprint Contract Draft (Round 1)

## 已知约束（来自回归测试 + 累积 FR + 复用模板核对）

- [Invariant INV-32 复用模板需核对真实历史] 已用 `git show`/`gh pr view` 核对本 sprint 的真实先例：
  - `git show 5e892ba636593d4a3463e07362de3f87c74d1521:sprints/07130939-relay-4bb31ef5/e2e-verify.sh`（PR #3829，claude-headed-smoke）——结构最接近，但该轮 PRD 范围比本次更宽（额外含 ci.yml claude/codex 分支顺序断言、DoD.md 记录检查、tui.log 留痕检查）。本次 PRD **明确排除** ci.yml 改动/检查、未要求 DoD.md/tui.log 检查，因此本合同**不**照抄这部分，只保留三件事（smoke 复用+allowlist、Brain API payload、DB initiative_runs）。
  - `sprints/07191312-relay-57e25e92`（PR #4109）/`sprints/07151245-relay-049ebf93`（PR #3970）：目录下无 committed `e2e-verify.sh`（该文件历史上未被这两个 sprint 提交到 sprints 目录本身，只有 contract/report），故本次不能假设"照抄同名文件"，改为直接参照 4bb31ef5 的脚本骨架并按本次 PRD 范围裁剪。
  - 已实测确认当前环境真实数据（非假设）：
    - `GET /api/brain/tasks/7630f4fb-0acf-4f7a-ad42-e2dea3485089` 返回 `payload.mode=headed`、`payload.executor=claude`、`payload.orchestrator=skill-relay`、`payload.journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`，且 payload 中未出现 `token`/`github_token`/`anthropic_token`/`thin_prd`。
    - `initiative_runs` 表 `initiative_id='7630f4fb-0acf-4f7a-ad42-e2dea3485089'` 现存 2 条记录，`orchestrator_host` 均为 `skill-relay-claude-headed`，`phase` 均为 `gan`（合法枚举、非 failed/unknown）。
    - `packages/quality/smoke-allowlist.txt` 第 23 行已精确登记 `claude-headed-dispatch-smoke.sh`（`grep -Fxq` 可精确命中，无需重复登记）。
- [packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh] → 5 项自检：POST headed/executor=claude 返回 200+id；POST headed/executor=codex 返回 200/201；POST headless 返回 200/201；POST 非法 mode 返回 400；`initiative_runs.tmux_killed_at` 字段存在。本合同不改脚本内容，仅要求其可全绿执行（依赖真实 Brain + PostgreSQL）。
- [累积FR] `context-manifest` 端点返回 404（journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963 尚未注册该端点或 line 无历史 golden path）：`context-manifest: unavailable`，与 PRD「累积 FR」段"本 line 暂无历史"一致，不作为阻塞项。
- [packages/brain/src/__tests__/harness-skill-relay*.test.js] → 已有回归测试覆盖 headed relay 派发/spawn/xian 场景的单测，本次不重复造轮子，只读校验现网状态。

## Response Schema（推导来源: PRD字面 / 现网实测）

### Endpoint: GET /api/brain/tasks/:task_id

**Success (HTTP 200)**:
```json
{
  "id": "7630f4fb-0acf-4f7a-ad42-e2dea3485089",
  "task_type": "harness_initiative",
  "payload": {
    "mode": "headed",
    "executor": "claude",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963"
  }
}
```
- `id` (string, 必填): 来源——PRD 指定 task id `7630f4fb-0acf-4f7a-ad42-e2dea3485089`。
- `task_type` (string, 必填): 来源——PRD 背景段「task_type=harness_initiative」，现网实测一致。
- `payload.mode` (string, 必填): 来源——PRD 字面值 `headed`，现网实测一致。
- `payload.executor` (string, 必填): 来源——PRD 字面值 `claude`，现网实测一致。
- `payload.orchestrator` (string, 必填): 来源——PRD 字面值 `skill-relay`，现网实测一致。
- `payload.journey_id` (string, 必填): 来源——PRD 字面值 `bb8cc561-b3ee-4fec-b74d-2255694bd963`，现网实测一致。

**禁用字段名（payload 内不得出现，明文泄漏 = FAIL）**: [`token`, `github_token`, `anthropic_token`, `thin_prd`]

**Error (task 不存在)**: HTTP 4xx/5xx 或 `curl -f` 非 0 exit code。

### DB: initiative_runs（定点查 initiative_id=TASK_ID）

**Success**:
```json
{
  "initiative_id": "7630f4fb-0acf-4f7a-ad42-e2dea3485089",
  "orchestrator_host": "skill-relay-claude-headed",
  "phase": "gan",
  "started_at": "<timestamp>"
}
```
- `initiative_id` (uuid, 必填): 来源——PRD 当前 task id，定点查询防历史数据冒充（Invariant INV-13 host白名单核对headed）。
- `orchestrator_host` (string, 必填): 来源——PRD Golden Path 第 2 点，必须**精确等于** `skill-relay-claude-headed`（不是泛化 `headed` 关键字匹配）。
- `phase` (string, 必填): 来源——DB 现网真实枚举，当前实测值 `gan`；`failed`/`unknown`/其他非法值必须 FAIL。合法枚举集合以 `A_planning|planning|gan|generate|evaluate|done`（沿用 4bb31ef5/57e25e92 先例已验证的枚举集合，与本次现网实测 `gan` 一致）为准。
**DB 列约束**: 只使用 `initiative_runs` 表真实存在的列（`information_schema.columns` 可核对），不臆造列名。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 新增锚定 task_id=7630f4fb 的 `sprints/07212136-relay-7630f4fb/e2e-verify.sh`，只读校验：①复用（不重实现）`claude-headed-dispatch-smoke.sh` 全绿执行 + 确认已在 allowlist 精确登记；②`GET /api/brain/tasks/7630f4fb...` payload 关键字段齐全且不含敏感字段明文；③DB `initiative_runs` 定点查 initiative_id=7630f4fb...，orchestrator_host 精确等于 `skill-relay-claude-headed`，phase 合法且非 failed/unknown。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 见 PRD NFR 段：N/A（纯只读校验），无长耗时依赖，同步一次性执行；断言失败必须打印明确 FAIL 原因并 exit 非 0。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不新增业务功能/dashboard/UI/migration；不改 `claude-headed-dispatch-smoke.sh` 本体；不改 `.github/workflows/ci.yml`；不重复登记 `packages/quality/smoke-allowlist.txt`；不写入/篡改任何生产数据（纯只读）；不泄漏 token/github_token/anthropic_token/thin_prd 明文。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本 e2e-verify.sh 锚定单个 task_id=7630f4fb，是一次性回归证据脚本，不设计为长期复用；`claude-headed-dispatch-smoke.sh` 语义变更或 allowlist 治理规则变更时，本脚本的 allowlist 断言需要维护者同步更新。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道 | e2e-verify.sh 本身即是"evaluator 执行 → 非 0 即失败"的探针；Brain API/DB 不可达时脚本立即 FAIL 并打印原因，不静默通过。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见下方失败语义声明表；所有失败路径一律拦截（exit 1），无降级，只读操作天然幂等可重跑。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？ | 本 sprint 无对外写入动作（除了复用调用 `claude-headed-dispatch-smoke.sh` 内部自带的 POST /api/brain/tasks smoke 探针，该脚本本体行为不属本次改动范围）；本脚本自身只做 GET/SELECT 读取，以现网 API 响应与 DB 查询结果作为唯一真相源。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 当前 task 的 initiative_runs 记录归属判定 | A. 只取最近一条 run；B. 用 `initiative_id = TASK_ID` 定点查（不看历史其他 task 的 run） | B. 用当前 task id 定点查，且不假设只有一条记录（现网实测已有 2 条） | PRD 假设声明"实测已存在 2 条：A_planning 与历史 failed"，但当前实测两条 phase 均为 `gan`（非 PRD 假设描述的历史 failed），说明数据会变化，脚本不能写死条数或写死具体 phase 值，只能校验"至少一条记录 + host 精确匹配 + phase 合法非 failed/unknown" | 若写死"必须恰好 2 条"或写死"必须含一条 failed"，数据变化后脚本会误报 FAIL，属于对现实的错误假设写死 |
| orchestrator_host 判定用精确匹配还是关键字包含 | A. `grep -q headed`（宽松包含）；B. 精确等于 `skill-relay-claude-headed` | B. 精确等于 | Invariant INV-13「host白名单核对headed」要求 proposer 起草 host 断言时核对 headed 场景，避免宽松匹配把 `skill-relay-codex-headed` 或其他 headed 变体误判为通过 | 宽松匹配会让非 claude-headed 的 run（如 codex-headed）也通过校验，验收信号失真 |
| phase 合法枚举集合的取值来源 | A. 凭记忆猜测枚举值；B. 沿用已验证先例（4bb31ef5/57e25e92）的枚举集合并核对当前实测值落在其中 | B. 沿用先例枚举集合 `A_planning\|planning\|gan\|generate\|evaluate\|done`，当前实测 `gan` 落在其中 | Invariant INV-24「判变基准用生产自报」精神：枚举来源不能凭空猜，要用已验证证据；先例枚举经过 4bb31ef5 GAN 收敛验证过 | 枚举集合猜错会导致本应合法的 phase 被误判 FAIL，或本应非法的 phase 被放行 |
| allowlist 是否需要新登记 | A. 假设未登记，本次追加一行；B. 先 `grep -Fxq` 精确核对，已登记则只校验存在不追加 | B. 先核对——已实测第 23 行精确等于 `claude-headed-dispatch-smoke.sh` | PRD 范围限定明确"已登记过则只校验存在不重复登记"，且 Invariant INV-33「共享CI文件默认禁区」要求未经合同显式授权不可修改 allowlist | 重复登记会造成 allowlist 文件冗余行/格式漂移，且违反 PRD 范围限定与共享文件禁区铁律 |

> judgment-pending-user: N/A，本任务为只读回归校验脚本，无高风险不可逆外部动作，PRD 范围与断言口径已充分锚定。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `claude-headed-dispatch-smoke.sh` 执行非 0 | e2e-verify.sh 立即传播非 0，打印 `FAIL: claude-headed-dispatch-smoke.sh 未全绿` | 是，只读 smoke 天然幂等 | 不允许吞错（无 `\|\| true`） |
| `claude-headed-dispatch-smoke.sh` 未在 allowlist 精确登记 | exit 1，打印 `FAIL: allowlist 未登记` | 是 | 不允许自动追加登记（违反 PRD 范围限定） |
| Brain API 不可达 / task 不存在 | `curl -f` 非 0 → exit 1，打印 `FAIL: Brain task 不可达或不存在` | 是，只读重跑幂等 | 不降级为 PASS，不用历史缓存代替 |
| payload 缺字段或字段值不匹配 | `jq -e` 非 0 → exit 1，打印具体缺失/不匹配字段 | 是 | 不降级 |
| payload 含敏感字段明文（token/github_token/anthropic_token/thin_prd） | `jq -e` 反向断言失败 → exit 1，打印 `FAIL: payload 含敏感字段明文` | 是 | 不降级，不脱敏后放行（发现即 FAIL） |
| `initiative_runs` 无该 initiative_id 记录 | `psql` 结果为空 → exit 1，打印 `FAIL: initiative_runs 无当前 task run` | 是 | 不降级 |
| `orchestrator_host` 不精确等于 `skill-relay-claude-headed` | exit 1，打印实际值 | 是 | 不降级为宽松匹配 |
| `phase` 为 `failed`/`unknown`/非法枚举 | exit 1，打印实际 phase 值 | 是 | 不降级为 PASS |

### 输入对抗面（对外暴露 agent 必填）

（本任务为 Brain 内部只读回归校验脚本，不对外暴露 agent/用户输入面，无 Prompt Injection 风险面，N/A）

## 接缝清单

- Brain API 接缝：`http://localhost:5221/api/brain/tasks/$TASK_ID` 必须真实返回当前 task，不接受 mock/stub/404-acceptable 兜底。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID` 定点查询真实数据，不得用历史其他 task 的记录冒充。
- 复用 smoke 脚本接缝：`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 必须真实执行（起真实 Brain + PostgreSQL），不 mock 其内部 POST 请求。
- allowlist 文件接缝：`packages/quality/smoke-allowlist.txt` 只读校验存在性，不修改。

## 禁 mock 边清单

（本单为纯只读回归校验脚本，不改调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无新增或修改的"边"。e2e-verify.sh 本身对 Brain API 与 PostgreSQL 的调用禁止 mock——见上方"接缝清单"与下方 Golden Path 验证命令，均为真实 curl/psql 调用，不使用 stub/mock/fake。N/A：本单无被改的调度/状态机/数据传递/生命周期钩子/DB写路径边）

## 未覆盖真实链路清单

（本合同无 mock 豁免。三项验证均对真实系统执行：①真实执行已存在的 `claude-headed-dispatch-smoke.sh`（该脚本自身对 Brain API 发起真实 POST）；②真实 `curl` Brain API；③真实 `psql` 查询 PostgreSQL。无 force_*/stub/假数据，N/A）

## 真实调用方请求 shape

（本任务不涉及"设备/agent 调服务端"的新增或修改路径，e2e-verify.sh 是 evaluator/开发者手动或 CI 触发的只读校验脚本，本身不是被外部真实调用方（Android/Windows agent 等）调用的服务端点，N/A）

## Golden Path

Brain 已派发 headed relay 任务(task_id=7630f4fb) → e2e-verify.sh 复用既有 smoke 校验 + 定点核对 Brain API payload + 定点核对 DB initiative_runs → 全部通过则 exit 0 打印 PASS，任一失败则 exit 1 打印具体 FAIL 原因

### Step 1: 复用既有 headed dispatch smoke 全绿执行 + 确认 allowlist 精确登记
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点第一子项「调用既有 `claude-headed-dispatch-smoke.sh`（不重实现，只校验其全绿执行与 allowlist 登记）」，及范围限定「已登记过则只校验存在，不重复登记」。

**可观测行为**: `claude-headed-dispatch-smoke.sh` 在本机针对真实 Brain(localhost:5221) + PostgreSQL 执行，5 项内部断言全部 PASS，exit 0；`packages/quality/smoke-allowlist.txt` 精确包含该脚本文件名一行。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
```

**硬阈值**: smoke 脚本 exit 0；allowlist 精确行匹配（`grep -Fxq` 命中）。

---

### Step 2: 当前 task 的 Brain API payload 关键字段齐全且不含敏感字段明文
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点第二子项 + 边界情况「task payload 意外携带 token/github_token/anthropic_token/thin_prd 明文字段 → FAIL」。

**可观测行为**: `GET /api/brain/tasks/7630f4fb-0acf-4f7a-ad42-e2dea3485089` 返回 200，`payload.mode=headed`、`payload.executor=claude`、`payload.orchestrator=skill-relay`、`payload.journey_id` 非空，且 payload 不含 `token`/`github_token`/`anthropic_token`/`thin_prd` 键。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.payload.mode == "headed"'
echo "$RESP" | jq -e '.payload.executor == "claude"'
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '.payload.journey_id | type == "string" and length > 0'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)'
```

**硬阈值**: 上述 6 条 `jq -e` 全部 exit 0；任一失败即 FAIL。

---

### Step 3: DB initiative_runs 定点核对 orchestrator_host 与合法 phase
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点第三子项 + 边界情况「initiative_runs 无该 initiative_id 记录 → FAIL」「phase 落在 failed 或 unknown/非法枚举值 → FAIL」。

**可观测行为**: `initiative_runs` 表中 `initiative_id=7630f4fb-0acf-4f7a-ad42-e2dea3485089` 至少一条记录，`orchestrator_host` 精确等于 `skill-relay-claude-headed`，`phase` 落在合法枚举且非 `failed`/`unknown`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: orchestrator_host=$HOST"; exit 1; }
[ "$PHASE" != "failed" ] || { echo "FAIL: phase=failed"; exit 1; }
[ "$PHASE" != "unknown" ] || { echo "FAIL: phase=unknown"; exit 1; }
case "$PHASE" in
  A_planning|planning|gan|generate|evaluate|done) ;;
  *) echo "FAIL: phase 非法枚举 phase=$PHASE"; exit 1 ;;
esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
```

**硬阈值**: 记录存在；`orchestrator_host` 精确匹配；`phase` 非 failed/unknown 且落在合法枚举集合；`started_at` 非空。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07212136-relay-7630f4fb}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

echo "── Step 1: 复用 claude-headed-dispatch-smoke.sh + allowlist 登记确认 ──"
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || { echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 精确登记"; exit 1; }
echo "OK Step 1"

echo "── Step 2: Brain API task payload 校验 + 敏感字段脱敏断言 ──"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID") || { echo "FAIL: Brain task 不可达 task_id=$TASK_ID"; exit 1; }
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null || { echo "FAIL: task id 不匹配"; exit 1; }
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null || { echo "FAIL: payload.mode != headed"; exit 1; }
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null || { echo "FAIL: payload.executor != claude"; exit 1; }
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null || { echo "FAIL: payload.orchestrator != skill-relay"; exit 1; }
echo "$RESP" | jq -e '.payload.journey_id | type == "string" and length > 0' >/dev/null || { echo "FAIL: payload.journey_id 缺失或为空"; exit 1; }
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null || { echo "FAIL: payload 含敏感字段明文"; exit 1; }
echo "OK Step 2"

echo "── Step 3: DB initiative_runs 定点核对 ──"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: orchestrator_host=$HOST"; exit 1; }
[ "$PHASE" != "failed" ] || { echo "FAIL: phase=failed"; exit 1; }
[ "$PHASE" != "unknown" ] || { echo "FAIL: phase=unknown"; exit 1; }
case "$PHASE" in
  A_planning|planning|gan|generate|evaluate|done) ;;
  *) echo "FAIL: phase 非法枚举 phase=$PHASE"; exit 1 ;;
esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
echo "OK Step 3"

echo "✅ PASS: headed relay 回归证据全部验证通过 task_id=$TASK_ID"
```

**通过标准**: 脚本 exit 0，Step 1/2/3 均打印 OK，末尾打印 `✅ PASS`。
**失败标准**: 任一断言失败 → exit 1 并打印具体 `FAIL: ...` 原因。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| e2e-verify.sh 三件事校验骨架 | `sprints/07212136-relay-7630f4fb/tests/e2e-verify-contract.test.ts` | 文件存在且调用 smoke 与 allowlist 校验、payload 关键字段齐全且不含敏感字段明文、initiative_runs host 精确匹配且 phase 合法非 failed/unknown | → N failures（e2e-verify.sh 未创建前测试全部 FAIL） |
