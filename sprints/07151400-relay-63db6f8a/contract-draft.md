# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面/api_registry推导）

### Endpoint: GET /api/brain/tasks/:task_id
**Success (HTTP 200)**:
```json
{"id":"<uuid>","task_type":"harness_initiative","payload":{"mode":"headed","executor":"claude","orchestrator":"skill-relay"}}
```
- `id` (string, 必填): 来源--PRD 指定 task `63db6f8a-ea55-40fa-abd2-7dd63a2701e2`；api_registry 已登记 `/api/brain/*` 族端点风格，`/api/brain/tasks/:id` 已在 4bb31ef5/cd0b936c/049ebf93 三个先例中沿用同一 schema。
- `task_type` (string, 必填): 来源--实测当前 task `task_type=harness_initiative`（已 curl 核实）。
- `payload.mode` (string, 必填): 来源--实测当前 task `payload.mode=headed`。
- `payload.executor` (string, 必填): 来源--实测当前 task `payload.executor=claude`。
- `payload.orchestrator` (string, 必填): 来源--实测当前 task `payload.orchestrator=skill-relay`。
**禁用字段名**: [`token`, `github_token`, `anthropic_token`, `thin_prd`]
**Error (HTTP 4xx)**:
```json
{"error":"<string>"}
```

### DB: initiative_runs
**Success**:
```json
{"initiative_id":"<task_id>","orchestrator_host":"skill-relay-claude-headed | foreground","phase":"<非failed合法枚举>","started_at":"<timestamp>"}
```
- `initiative_id` (uuid, 必填): 来源--PRD 当前 task id `63db6f8a-ea55-40fa-abd2-7dd63a2701e2`，下方脚本以字面 TASK_ID=63db6f8a-ea55-40fa-abd2-7dd63a2701e2 为准。
- `orchestrator_host` (string, 必填): 来源--PRD Golden Path 第 2 点，`initiative_runs.orchestrator_host` 含 `skill-relay-claude-headed`（Brain 自动 spawn 真实 headed 容器路径）**或**字面等于 `foreground`（controller 前台点火经 `POST /api/brain/orchestrator/relay-runs/:initiative_id` — `packages/brain/src/routes/initiatives.js:373` — 补建档的合法路径）。R2 修订依据：controller 直接发现 task 63db6f8a 自动派发从未走通（一直 `queued`），实际经补建档端点创建，该端点固定写 `orchestrator_host='foreground'`，故两种 host 值均视为合法，见下方「未覆盖真实链路清单」。
- `phase` (string, 必填): 来源--PRD 边界情况「`phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL」。截至起草时 `initiative_runs` 尚无该 initiative_id 记录（本轮 GAN 尚在 propose 阶段，run 记录预期在后续 generate/evaluate 阶段写入，与先例 049ebf93 起草时点 `phase=gan` 时序位置一致——起草时 run 记录可能仍在写入中）。
- `started_at` (timestamp, 必填): 来源--`information_schema.columns` 确认 `initiative_runs` 真实列，与 4bb31ef5/049ebf93 先例一致。
**DB 列约束**: 只允许使用 `information_schema.columns` 中真实存在的列；本 sprint 不新增/修改 `initiative_runs` schema。

## 已知约束（来自回归测试）

- [scripts/smoke/e2e/relay-049ebf93.sh][累积FR] → e2e wrapper 必须调用 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 并验证其在 `packages/quality/smoke-allowlist.txt` 登记，本次不重复登记，只校验已登记。
- [tests/regression/relay-049ebf93/headed-smoke-contract.test.ts][累积FR] → 已回归覆盖 task payload 三元组校验、initiative_runs host/phase 校验、payload 敏感字段禁用校验，本次测试结构镜像该先例但仅锚定当前 task_id=63db6f8a。
- context-manifest: unavailable（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 未返回可解析内容，PRD 累积 FR 段已注明「本 line 暂无历史」，两者一致，不阻塞起草）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 为 task_id=63db6f8a 生成锚定该 task 的 `e2e-verify.sh`：复用（不重实现）`claude-headed-dispatch-smoke.sh`，校验其在 allowlist 登记；校验 Brain task 记录（payload 三元组 + 敏感字段脱敏）；校验 `initiative_runs`（host/phase 合法且非 failed）。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本机 `local_api` 同步一次性校验，无长耗时依赖；命令失败即 FAIL，不吞错；只读，不产生新写入。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见下方「Invariant 覆盖条目」映射，全部来自 PRD Invariant 段 7 条铁律。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本 sprint 的 e2e-verify.sh 锚定当前 task_id，是一次性回归证据；`claude-headed-dispatch-smoke.sh` 语义变更时由其维护者更新，不影响本文件；本文件过期判定：`initiative_runs`/`tasks` 表 schema 变更时需重写。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | evaluator 执行 DoD/E2E 任一命令非 0 即暴露失败；CI allowlist 中 `claude-headed-dispatch-smoke.sh` 失败会导致棘轮闸红。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | Brain API/DB 证据缺失或 phase=failed/unknown 时拦截，不得静默跳过；验证只读，重跑幂等；不允许无条件 `exit 0` 兜底。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 以当前 task 的 Brain API 响应与 `initiative_runs` 定点查询（`initiative_id = TASK_ID`）作为唯一外部真相；smoke 脚本 exit code + allowlist 登记作为复用证据。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| headed relay run 归属当前 task | A. 只看最近一条 run（不限 initiative_id）; B. 用 `initiative_id = TASK_ID` 定点查 DB | B. 用当前 task id 定点查 | PRD 边界情况明确要求「`initiative_runs` 无该 initiative_id 记录 → FAIL」 | 历史其他 task 的 run 冒充当前任务验收，导致假 done |
| headed relay host 判定 | A. Brain runs API 推断; B. DB `initiative_runs.orchestrator_host` 字面比对 | B. DB 字段精确比对含 `skill-relay-claude-headed` | PRD Golden Path 第 2 点显式指定 DB 字段核对 | 错把非 claude-headed relay 的 run 当作通过 |
| phase 合法性判定 | A. 只拒绝 `failed`，其余一律放行; B. 白名单枚举 `A_planning\|planning\|gan\|generate\|evaluate\|done`，`failed`/其余非法值一律拒绝 | B. 白名单枚举 + 显式拒绝 failed | PRD 边界情况「`phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL」 | 若只拒绝 failed，未来新增的中间态/损坏态字符串会被误判为通过 |

> judgment-pending-user: N/A，本任务只读验证现有 headed relay 证据，无高风险不可逆外部动作，PrepPRD 已明确锚定验收点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain task API 不可达/404 | `curl -sf` 非 0，验收失败 | 是，只读重跑 | 不降级为 done |
| task payload 三元组不匹配或含禁用字段 | jq -e 断言失败，非 0 退出 | 是，只读重跑 | 不允许放行 |
| `initiative_runs` 无该 initiative_id 记录 | 显式 FAIL + exit 1 | 是，只读重跑 | 不用历史其他 task 的记录替代 |
| `initiative_runs.phase` = failed 或非法枚举 | 显式 FAIL + exit 1 | 是，只读重跑 | 不放行 |
| `claude-headed-dispatch-smoke.sh` 未登记 allowlist | 显式 FAIL + exit 1 | 是，只读重跑 | 不静默跳过登记校验 |
| smoke 脚本本体执行失败 | 直接传播非 0 exit code | 是，smoke 自身幂等（只读 POST 测试端点） | 不吞错、不 `|| true` |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

（本任务 e2e-verify.sh 不对外暴露 agent 接口，只读调用内部 Brain API 与本地 DB，N/A）

## 禁 mock 边清单

（本单纯新增只读验证脚本，不改调度/状态机/跨模块数据传递/生命周期钩子/DB写路径，无接缝边，N/A）

## 接缝清单

- Brain API 接缝：本机 `http://localhost:5221` 必须真实返回当前 task（已实测：`id=63db6f8a-ea55-40fa-abd2-7dd63a2701e2`、`task_type=harness_initiative`、`payload.mode=headed`/`payload.executor=claude`/`payload.orchestrator=skill-relay`且无禁用字段 token/github_token/anthropic_token/thin_prd），不接受 mock 或 404-acceptable。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID=63db6f8a-ea55-40fa-abd2-7dd63a2701e2` 定点读取。起草时点该 initiative_id 尚无 run 记录（本轮 GAN 处于 propose 阶段，run 记录预期随后续 generate/evaluate 阶段写入，最终 final-e2e 执行时点必须真实存在，未真验前不得标 done）。
- smoke/allowlist 接缝：`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 已存在且已在 `packages/quality/smoke-allowlist.txt` 登记（已实测 `grep -Fxq` 命中），本次只校验存在性与登记状态，不重新实现/不重复登记。

## 未覆盖真实链路清单

- 未覆盖链路：Brain 自动 headed spawn 落 `initiative_runs`（`orchestrator_host=skill-relay-claude-headed`）。
  为什么：task_id=63db6f8a 的真实派发历史显示 `dispatched_by_orchestrator=true`、`orchestrator_dispatched_at=2026-07-15T05:52:09Z`，但 status 一直停留 `queued`，Brain 的 `_spawnHeadedSession` 从未真正 spawn 成功，未落 `initiative_runs` 行；controller session 是通过 harness-controller skill Step 0.3「前台点火防护」手动认领（`HARNESS_TASK_ID` 外部注入、无 `HARNESS_INITIATIVE_ID`，符合前台点火特征）。
  实际覆盖的路径：controller 改调官方补建档端点 `POST /api/brain/orchestrator/relay-runs/:initiative_id`（`packages/brain/src/routes/initiatives.js:373`，专为「前台接管无 spawnSkillRelaySession INSERT」场景设计）创建了 `initiative_runs` 行，该端点固定写 `orchestrator_host='foreground'`。
  与先例的区别：本次覆盖的是 `orchestrator_host=foreground` 前台补建档路径，与 049ebf93 等先例覆盖的 `orchestrator_host=skill-relay-claude-headed` Brain 自动 spawn 真实 headed 容器路径不同，两条链路不得混同呈现。
  真验证补位计划：待 Brain 自动 headed spawn（`_spawnHeadedSession`）本身跑通排队问题后，由下一个走通自动派发的 task/sprint 补验 `orchestrator_host=skill-relay-claude-headed` 这条真实链路；本 sprint 不承担该修复范围。

## Golden Path

Brain 派发 headed relay 任务（task_id=63db6f8a-ea55-40fa-abd2-7dd63a2701e2）→ e2e-verify.sh 复用调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记 → 查 Brain task API 核对 payload 三元组与敏感字段脱敏 → 查 DB initiative_runs 核对 host/phase → 全部通过则 exit 0 打印 PASS，任一失败则 exit 1 打印 FAIL 原因。

### Step 1: 复用调用 claude-headed-dispatch-smoke.sh 并校验其在 allowlist 登记
**来源**: `[FROM_PRD]` — PRD「E2E 验收」第 3 点与「范围限定」明确要求复用既有脚本、校验其在 `packages/quality/smoke-allowlist.txt` 登记，且「不新增/修改 `claude-headed-dispatch-smoke.sh` 本体」「仅校验存在，不重复登记」。

**可观测行为**: `claude-headed-dispatch-smoke.sh` 在本机 Brain 上全绿（exit 0），且该脚本文件名精确出现在 allowlist 文件中。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
```

**硬阈值**: smoke 脚本 exit 0；allowlist 精确逐行匹配包含该脚本名（`grep -Fxq`，全行匹配防子串误报）。

### Step 2: 当前 task 记录 payload 三元组齐全且不含敏感字段
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 「E2E 验收」第 1 点，要求 `GET /api/brain/tasks/63db6f8a...` 返回 task，payload 三元组齐全，且不含 `token`/`github_token`/`anthropic_token`/`thin_prd` 明文字段。

**可观测行为**: Brain task API 返回当前 task，`id` 等于 TASK_ID，`payload.mode/executor/orchestrator` 三值精确匹配，且四个禁用字段均不存在于 payload。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-63db6f8a-ea55-40fa-abd2-7dd63a2701e2}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)'
```

**硬阈值**: task id 完全匹配；payload 三元组完全匹配；四个禁用字段全部不存在，任一存在即 FAIL。

### Step 3: initiative_runs 记录当前 task 的 headed relay host 与合法 phase
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 「边界情况」段：`initiative_runs` 无该 initiative_id 记录 → FAIL；`phase` 落在 `failed` → FAIL；`unknown`/非法枚举值 → FAIL。R2 修订（`[AI_ADDED]` 部分）：host 判定放宽为同时接受 `*skill-relay-claude-headed*` 或字面 `foreground` 两种合法值——理由：controller 直接发现本次 task 63db6f8a 自动派发从未走通（一直 `queued`），实际经官方补建档端点 `POST /api/brain/orchestrator/relay-runs/:initiative_id`（`packages/brain/src/routes/initiatives.js:373`）创建 `initiative_runs` 行，该端点固定写 `orchestrator_host='foreground'`；若仍严格要求 `*skill-relay-claude-headed*`，本合同将对当前真实执行路径必然 FAIL，属于合同与现实不符，而非实现缺陷。

**可观测行为**: 当前 `initiative_id=63db6f8a-ea55-40fa-abd2-7dd63a2701e2` 至少一条 run 记录，`orchestrator_host` 含 `skill-relay-claude-headed` **或**字面等于 `foreground`，`phase` 处于合法 relay lifecycle 枚举且非 `failed`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-63db6f8a-ea55-40fa-abd2-7dd63a2701e2}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
case "$HOST" in *skill-relay-claude-headed*|foreground) ;; *) echo "FAIL: host=$HOST"; exit 1 ;; esac
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
```

**硬阈值**: `initiative_runs` 至少一行；`orchestrator_host` 含 `skill-relay-claude-headed` 或字面等于 `foreground`；`phase` 属于 `A_planning|planning|gan|generate|evaluate|done` 白名单且非 `failed`；`started_at` 非空。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

后续 generator 必须补 `sprints/07151400-relay-63db6f8a/e2e-verify.sh`，内容等价于以下脚本；proposer 本阶段不创建该脚本，以保证 TDD Red：

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-63db6f8a-ea55-40fa-abd2-7dd63a2701e2}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07151400-relay-63db6f8a}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh

if ! grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt; then
  echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 登记"
  exit 1
fi

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null

ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无当前 task run"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)

case "$HOST" in
  *skill-relay-claude-headed*|foreground) ;;
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

echo "OK headed smoke regression verified for $TASK_ID"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| e2e-verify.sh 复用 smoke 脚本并校验 allowlist | `../../tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts` | `e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记` | `e2e-verify.sh` 尚未存在，测试失败 |
| task payload 三元组 + 敏感字段脱敏 | `../../tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts` | `payload 三元组齐全且禁用 token/github_token/anthropic_token/thin_prd` | `e2e-verify.sh` 尚未存在，测试失败 |
| initiative_runs host/phase 校验 | `../../tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts` | `initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/unknown` | `e2e-verify.sh` 尚未存在，测试失败 |
| local_api E2E wrapper 完整链路 | `../../tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts` | `local_api E2E wrapper 完整验证当前` | `e2e-verify.sh` 尚未存在，测试失败 |

## Notes

- contract-gate: applicable (cecelia worktree)。
- judgment-pending-user: N/A，本任务只读验证现有 headed relay 证据，无高风险不可逆外部动作。
- 起草时点 `initiative_runs` 尚无 `initiative_id=63db6f8a-ea55-40fa-abd2-7dd63a2701e2` 的记录（本轮 GAN 处于 propose 阶段，run 记录预期在后续 generate/evaluate 阶段写入）；该点已计入接缝清单，Step 3/BEHAVIOR-3 在最终 evaluate/final-e2e 执行时点必须真实命中，未命中即按合同判 FAIL，不得静默放行。
- self-check 已知假阳性：Step 2b-check 第 6 项全角标点检测正则 `[（）：，""]\$` 在本机 grep -E 下，字符类里字面含有 ASCII 直引号 `"`，导致任意 `"$VAR` 结尾行均误报（本合同 E2E 脚本命中 20 处），已用已毕业先例 `scripts/smoke/e2e/relay-049ebf93.sh` 复测同一正则同样命中 20 处（该脚本已过 GAN/evaluator/merge），本合同 E2E 脚本不含真实全角标点紧贴 `$VAR`，此项判定为环境性假阳性，不阻塞交付；其余 Step 2b-check 全部通过（BEHAVIOR=8≥4，manual:命令=8/8，E2E bash 块=1，bash -n 通过，真执行断言 8/8、文本自证 0/8）。
- R2 修订记录：按 controller reviewer-feedback-r1.md 要求，E2E 验收断言2（`initiative_runs.orchestrator_host` 校验）从严格匹配 `*skill-relay-claude-headed*` 放宽为同时接受 `*skill-relay-claude-headed*` 或字面 `foreground`；contract-dod.md 对应 [BEHAVIOR] 条目与 `tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts` 对应断言同步更新；新增「未覆盖真实链路清单」段登记本次未覆盖 Brain 自动 headed spawn 真实链路。R2 复跑 Step 2b-check 全部通过（BEHAVIOR=8≥4，manual:命令=8/8，E2E bash 块=1，bash -n 通过，真执行断言 8/8）；未改动 task payload 三元组校验、敏感字段脱敏、smoke 脚本 allowlist 登记等既有断言。
