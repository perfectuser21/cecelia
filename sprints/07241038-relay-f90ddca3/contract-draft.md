# Sprint Contract Draft (Round 1)

> **本轮说明（GAN 第 1 轮）**：结构镜像同名任务先例 7630f4fb（PR #4184 APPROVED round-3 版本），并按本次 PRD 两处关键差异调整：
> ① **落点铁律前置执行**——测试产物与 e2e wrapper 从第一次 commit 起即落永久池
> `tests/regression/relay-f90ddca3/headed-smoke-contract.test.ts` + `scripts/smoke/e2e/relay-f90ddca3.sh`，
> 禁止 `sprints/` 临时路径，从源头避开 test-pyramid-guard 孤儿棘轮，禁止触碰 `scripts/test-pyramid-baseline.json`；
> ② **phase 断言语义改造**——本 initiative 的 run 有历史 failed 前科后被 controller 复活（PRD 边界情况明确），
> Step 3 断言从先例的「最新一条 LIMIT 1」改为「**存在至少一条** phase 合法且非 failed/unknown 的记录」（定点读 EXISTS 语义），
> 容忍历史 failed 行存在，不因前科误判 FAIL。

## 已知约束（来自回归测试 + 累积 FR + 复用模板核对）

- [Invariant「复用模板需核对真实历史」] 已核对本 sprint 的真实先例与现网数据（非假设，全部本轮实测）：
  - 直接结构先例：`sprints/07212136-relay-7630f4fb/`（PR #4184，同名任务上一轮 APPROVED 版本）+ 其毕业产物
    `tests/regression/relay-7630f4fb/headed-smoke-contract.test.ts` 与 `scripts/smoke/e2e/relay-7630f4fb.sh`（已在 main，均已读取核对）。
  - 先例 Step 3 用 `ORDER BY started_at DESC LIMIT 1` 只看最新行；本次 PRD 边界情况明确要求容忍历史 failed 行，
    故**不照抄**，改为「存在至少一条合法记录」的定点读断言（见判定点登记表第 2 行）。
  - 已实测确认当前环境真实数据（2026-07-24 本轮执行，非引用先例数据）：
    - `GET /api/brain/tasks/f90ddca3-396d-45b2-ad13-2dfbd9e15080` 返回 200：`payload.mode=headed`、`payload.executor=claude`、
      `payload.orchestrator=skill-relay`、`payload.journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`，payload 另含
      `sprint_dir`/`orphan_requeue_count` 等无害字段，**未出现** `token`/`github_token`/`anthropic_token`/`thin_prd`。
    - `initiative_runs` 表 `initiative_id='f90ddca3-…'` 现存 2 条记录，`orchestrator_host` 均为 `skill-relay-claude-headed`，
      `phase` 均为 `gan`（合法枚举、非 failed/unknown）。PRD 假设段描述的「历史 failed 前科行」在当前快照已被 controller
      复活改写为合法 phase——证明该表数据会随 controller 动作变化，断言不得写死条数或写死具体 phase 值。
    - `packages/quality/smoke-allowlist.txt` 第 24 行精确登记 `claude-headed-dispatch-smoke.sh`（`grep -Fxq` 精确命中，无需重复登记）。
    - `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 本轮真跑一次：5 项自检全绿（headed/codex-headed/headless 放行、
      invalid mode 400 拒绝、`initiative_runs.tmux_killed_at` 字段存在），exit 0。本合同不改脚本内容，仅复用。
- [累积FR] `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 404：`context-manifest: unavailable`，
  与 PRD「累积 FR」段"本 line 暂无历史"一致，不作为阻塞项。
- [packages/brain/src/__tests__/harness-skill-relay*.test.js] → 已有回归测试覆盖 headed relay 派发/spawn 场景单测，本次不重复造轮子，只读校验现网状态。
- [tests/regression/relay-7630f4fb/headed-smoke-contract.test.ts] → 先例 contract 测试的 5 个 it()：文件存在且调用 smoke 与 allowlist 校验 /
  锚定 task_id / payload 字段与脱敏 / initiative_runs host+phase / 不写入共享 CI 文件。本次镜像该结构并按 phase 新语义调整第 4 项。
- contract-gate: present（packages/brain/src/lib/contract-gate.js 存在，cecelia 场景，走代码层 Contract Gate）。

## Response Schema（推导来源: PRD字面 / 现网实测）

### Endpoint: GET /api/brain/tasks/:task_id

**Success (HTTP 200)**:
```json
{
  "id": "f90ddca3-396d-45b2-ad13-2dfbd9e15080",
  "task_type": "harness_initiative",
  "payload": {
    "mode": "headed",
    "executor": "claude",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963"
  }
}
```
- `id` (string, 必填): 来源——PRD 指定 task id `f90ddca3-396d-45b2-ad13-2dfbd9e15080`。
- `task_type` (string, 必填): 来源——PRD 背景段「task_type=harness_initiative」，现网实测一致。
- `payload.mode` (string, 必填): 来源——PRD 字面值 `headed`，现网实测一致。
- `payload.executor` (string, 必填): 来源——PRD 字面值 `claude`，现网实测一致。
- `payload.orchestrator` (string, 必填): 来源——PRD 字面值 `skill-relay`，现网实测一致。
- `payload.journey_id` (string, 必填): 来源——PRD 字面值 `bb8cc561-b3ee-4fec-b74d-2255694bd963`，现网实测一致。
- payload 允许携带其他无害字段（现网实测含 `sprint_dir` 等），**不做** `keys == [...]` 完全匹配（PRD 只要求关键字段非空 + 敏感字段不存在）。

**禁用字段名（payload 内不得出现，明文泄漏 = FAIL）**: [`token`, `github_token`, `anthropic_token`, `thin_prd`]

**Error (task 不存在)**: HTTP 4xx → `curl -f` 非 0 exit code → e2e 脚本 FAIL（PRD 边界情况「task 记录不存在 → FAIL，不得静默跳过」）。

### DB: initiative_runs（定点查 initiative_id=TASK_ID，EXISTS 语义）

**Success**（存在至少一条满足以下全部条件的记录）:
```json
{
  "initiative_id": "f90ddca3-396d-45b2-ad13-2dfbd9e15080",
  "orchestrator_host": "skill-relay-claude-headed",
  "phase": "<合法枚举且非 failed/unknown，本轮实测 gan>"
}
```
- `initiative_id` (uuid, 必填): 来源——PRD 当前 task id，定点查询防历史其他 task 数据冒充。
- `orchestrator_host` (string, 必填): 来源——PRD E2E 验收第 2 点「含 `skill-relay-claude-headed`」；本合同收严为**精确等于**
  `skill-relay-claude-headed`（Invariant「host白名单核对headed」+ 现网实测精确值；精确匹配是"含"的子集，见判定点登记表第 3 行）。
- `phase` (string, 必填): 来源——PRD 边界情况「存在至少一条 phase 落在合法枚举且非 failed/unknown」。合法枚举集合沿用先例
  4bb31ef5/57e25e92/7630f4fb 已验证集合 `A_planning|planning|gan|generate|evaluate|done`，本轮实测值 `gan` 落在其中。
  历史 failed 行允许存在，不作为 FAIL 依据；**全部**记录 phase 为 failed/unknown/非法 → FAIL。
**DB 列约束**: 只使用 `initiative_runs` 表真实存在的列（本轮实测 `orchestrator_host`/`phase`/`started_at` 均可查），不臆造列名。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 新增锚定 task_id=f90ddca3 的 contract 回归测试 `tests/regression/relay-f90ddca3/headed-smoke-contract.test.ts` + e2e wrapper `scripts/smoke/e2e/relay-f90ddca3.sh`（两者第一次 commit 即落永久池，禁 sprints/ 临时路径），只读校验三件事：①复用（不重实现）`claude-headed-dispatch-smoke.sh` 全绿执行 + 确认已在 allowlist 精确登记；②`GET /api/brain/tasks/f90ddca3…` payload 关键字段齐全且不含敏感字段明文；③DB `initiative_runs` 定点查 initiative_id=f90ddca3…，存在至少一条 orchestrator_host 精确等于 `skill-relay-claude-headed` 且 phase 合法非 failed/unknown 的记录（容忍历史 failed 行）。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 见 PRD NFR 段：N/A（纯只读校验），同步一次性执行，无长耗时依赖；断言失败必须打印明确 FAIL 原因并 exit 非 0。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不新增业务功能/dashboard/UI/migration；不改 `claude-headed-dispatch-smoke.sh` 本体；不改 `.github/workflows/ci.yml`；不改 `scripts/test-pyramid-baseline.json`；不重复登记 `packages/quality/smoke-allowlist.txt`；测试产物不落 sprints/ 临时路径；不写入/篡改任何生产数据（纯只读）；不泄漏 token/github_token/anthropic_token/thin_prd 明文。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本 e2e wrapper 锚定单个 task_id=f90ddca3，是一次性回归证据脚本，不设计为长期复用；`claude-headed-dispatch-smoke.sh` 语义或 allowlist 治理规则变更时，本脚本的 allowlist 断言需维护者同步更新。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道 | `scripts/smoke/e2e/relay-f90ddca3.sh` 本身即"evaluator 执行 → 非 0 即失败"的探针；Brain API/DB 不可达时脚本立即 FAIL 并打印原因，不静默通过。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见下方失败语义声明表；所有失败路径一律拦截（exit 1），无降级，只读操作天然幂等可重跑。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？ | 本 sprint 无对外写入动作（复用调用的 `claude-headed-dispatch-smoke.sh` 内部自带 POST smoke 探针，其本体行为不属本次改动范围）；本脚本自身只做 GET/SELECT 读取，以现网 API 响应与 DB 查询结果作为唯一真相源。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 当前 task 的 initiative_runs 记录归属判定 | A. 只取最近一条 run；B. 用 `initiative_id = TASK_ID` 定点查全部记录 | B. 定点查，不写死条数与具体 phase 值 | 本轮实测 2 条记录均 phase=gan，而 PRD 假设段描述"一条历史 failed 被复活为 planning"——同一张表两次观测结果不同，证明数据随 controller 动作变化，写死即错 | 写死"必须恰好 2 条"或"必须含一条 failed"会在数据变化后误报 FAIL |
| phase 断言口径：最新一条 vs 存在至少一条 | A. `ORDER BY started_at DESC LIMIT 1` 只看最新行（先例 7630f4fb 写法）；B. 存在至少一条 host 匹配且 phase 合法非 failed/unknown 的记录（EXISTS 定点读） | B. EXISTS 语义 | PRD 边界情况明确："断言必须设计为存在至少一条合法记录，容忍历史 failed 行"；若沿用先例 A 写法，controller 复跑产生新 failed 行时最新行恰为 failed 会误判 FAIL | A 写法在"历史前科 + 复跑"场景下误报 FAIL，把链路健康的回归证据打红 |
| orchestrator_host 判定用精确匹配还是关键字包含 | A. `LIKE '%skill-relay-claude-headed%'` 或 grep 宽松包含；B. SQL 等值 `= 'skill-relay-claude-headed'` | B. 精确等于 | PRD E2E 验收字面为"含"，但 Invariant「host白名单核对headed」要求核对 headed 变体；现网实测值精确等于该串，精确匹配是"含"的严格子集，不放行 `skill-relay-codex-headed` 等变体 | 宽松包含会让 codex-headed 等其他变体的 run 也通过校验，验收信号失真 |
| phase 合法枚举集合的取值来源 | A. 凭记忆猜测枚举值；B. 沿用已验证先例（4bb31ef5/57e25e92/7630f4fb）枚举集合并核对当前实测值落在其中 | B. 沿用先例集合 `A_planning\|planning\|gan\|generate\|evaluate\|done`，本轮实测 `gan` 落在其中 | 先例枚举经 3 轮 GAN 收敛验证；「判变基准用生产自报」精神：枚举不凭空猜 | 枚举猜错会把合法 phase 误判 FAIL 或放行非法 phase |
| allowlist 是否需要新登记 | A. 假设未登记，本次追加一行；B. 先 `grep -Fxq` 精确核对，已登记则只校验存在不追加 | B. 先核对——本轮实测第 24 行精确等于 `claude-headed-dispatch-smoke.sh` | PRD 范围限定明确"已登记过则只校验存在"，Invariant「共享CI文件默认禁区」禁止未经授权修改 | 重复登记造成 allowlist 冗余行/格式漂移，违反 PRD 范围限定与共享文件禁区铁律 |

> judgment-pending-user: N/A，本任务为只读回归校验脚本，无高风险不可逆外部动作，PRD 范围与断言口径已充分锚定。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `claude-headed-dispatch-smoke.sh` 执行非 0 | `scripts/smoke/e2e/relay-f90ddca3.sh` 立即传播非 0，打印 FAIL 原因 | 是，只读 smoke 天然幂等 | 不允许吞错（无 `\|\| true`） |
| `claude-headed-dispatch-smoke.sh` 未在 allowlist 精确登记 | exit 1，打印 `FAIL: allowlist 未精确登记` | 是 | 不允许自动追加登记（违反 PRD 范围限定） |
| Brain API 不可达 / task 不存在 | `curl -f` 非 0 → exit 1，打印 `FAIL: Brain task 不可达或不存在` | 是，只读重跑幂等 | 不降级为 PASS，不用历史缓存代替 |
| payload 缺字段或字段值不匹配 | `jq -e` 非 0 → exit 1，打印具体缺失/不匹配字段 | 是 | 不降级 |
| payload 含敏感字段明文（token/github_token/anthropic_token/thin_prd） | `jq -e` 反向断言失败 → exit 1，打印 `FAIL: payload 含敏感字段明文` | 是 | 不降级，不脱敏后放行（发现即 FAIL） |
| `initiative_runs` 无该 initiative_id 任何记录 | 定点读为空 → exit 1，打印 `FAIL: initiative_runs 无当前 task run` | 是 | 不降级 |
| 有记录但**全部** phase 为 failed/unknown/非法或 host 不匹配 | 合法记录定点读为空 → exit 1，打印 FAIL 原因 | 是 | 不降级；历史 failed 行存在但另有合法行 → 不算失败（PRD 边界情况） |

### 输入对抗面（对外暴露 agent 必填）

（本任务为 Brain 内部只读回归校验脚本，不对外暴露 agent/用户输入面，无 Prompt Injection 风险面，N/A）

## 接缝清单

- Brain API 接缝：`http://localhost:5221/api/brain/tasks/$TASK_ID` 必须真实返回当前 task，不接受 mock/stub/404-acceptable 兜底。已真验（本轮实测 200 + 字段齐全）。
- PostgreSQL 接缝：`initiative_runs` 必须按当前 `TASK_ID` 定点查询真实数据，不得用历史其他 task 的记录冒充。已真验（本轮实测定点读返回 `gan`，exit 0）。
- 复用 smoke 脚本接缝：`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 必须真实执行（打真实 Brain + PostgreSQL），不 mock 其内部 POST 请求。已真验（本轮真跑 5 项全绿 exit 0）。
- allowlist 文件接缝：`packages/quality/smoke-allowlist.txt` 只读校验存在性，不修改。已真验（第 24 行精确命中）。

## 禁 mock 边清单

（本单为纯只读回归校验脚本，不改调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无被改的"边"。`scripts/smoke/e2e/relay-f90ddca3.sh` 自身对 Brain API 与 PostgreSQL 的调用禁止 mock——见「接缝清单」与 Golden Path 验证命令，均为真实 curl/psql 调用，不使用 stub/mock/fake。N/A：本单无被改的调度/状态机/数据传递/生命周期钩子/DB写路径边）

## 未覆盖真实链路清单

（本合同无 mock 豁免。三项验证均对真实系统执行：①真实执行既有 `claude-headed-dispatch-smoke.sh`（该脚本自身对 Brain API 发起真实 POST）；②真实 `curl` Brain API；③真实 `psql` 查询 PostgreSQL。无 force_*/stub/假数据，N/A）

## 真实调用方请求 shape

（本任务不涉及"设备/agent 调服务端"的新增或修改路径，`scripts/smoke/e2e/relay-f90ddca3.sh` 是 evaluator/开发者/CI 触发的只读校验脚本，本身不是被外部真实调用方（Android/Windows agent 等）调用的服务端点，N/A）

## manual oracle 真跑记录（Invariant「manual oracle真实exit code」「node -e表达式须真跑」）

GAN 批准前本轮已逐条真跑的 oracle（目标解释器确认启动，真实 exit code 如下）：

| oracle | 真实 exit code | 说明 |
|---|---|---|
| `bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` | 0 | 5 项自检全绿（bash 解释器真启动） |
| `grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt` | 0 | 第 24 行精确命中 |
| `curl -sf …/api/brain/tasks/f90ddca3… \| jq -e` 6 条字段/脱敏断言 | 0 | curl+jq 真启动，全部通过 |
| `psql … SELECT phase … EXISTS 定点读` | 0 | 返回 `gan` 非空 |
| DoD 内环境侧 `node -e` ARTIFACT 断言（A1/A4）与 manual:bash 环境侧断言（B1/B2/B3/B7、INV-1/2/29/30/32/36/40） | 0 | node/bash/curl/psql/jq 解释器逐条真启动，全部通过（node -e 双引号内无 `${}` shell expansion，不受 d9e4f4c1 踩坑面影响） |
| wrapper 依赖断言：A2/A3 node -e 读 wrapper | 1（预期 Red） | wrapper 尚未创建；generator 交付后须 exit 0 |
| `bash scripts/smoke/e2e/relay-f90ddca3.sh`（wrapper 端到端） | 127（预期 Red，文件不存在） | TDD Red 证据；generator 交付后须 exit 0 |
| `vitest run tests/regression/relay-f90ddca3/` | 1（预期 Red） | 实测 5/5 it() FAIL（ENOENT: wrapper 不存在），generator Green 后须 5/5 通过 |

## Golden Path

Brain 已派发 headed relay 任务(task_id=f90ddca3) → `scripts/smoke/e2e/relay-f90ddca3.sh` 复用既有 smoke 校验 + 定点核对 Brain API payload + 定点核对 DB initiative_runs（EXISTS 语义，容忍历史 failed 行） → 全部通过则 exit 0 打印 PASS，任一失败则 exit 1 打印具体 FAIL 原因

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

**可观测行为**: `GET /api/brain/tasks/f90ddca3-396d-45b2-ad13-2dfbd9e15080` 返回 200，`payload.mode=headed`、`payload.executor=claude`、`payload.orchestrator=skill-relay`、`payload.journey_id` 非空，且 payload 不含 `token`/`github_token`/`anthropic_token`/`thin_prd` 键。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-f90ddca3-396d-45b2-ad13-2dfbd9e15080}"
export TASK_ID
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

### Step 3: DB initiative_runs 定点核对——存在至少一条 host 精确匹配且 phase 合法非 failed/unknown 的记录
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点第三子项 + 边界情况「本 initiative 的 run 有历史 failed 前科后被复活：断言必须设计为存在至少一条 phase 合法且非 failed/unknown 的记录，容忍历史 failed 行」「无记录 → FAIL」「全部记录 phase 为 failed/unknown/非法 → FAIL」。

**可观测行为**: `initiative_runs` 表中 `initiative_id=f90ddca3-396d-45b2-ad13-2dfbd9e15080` 至少一条记录；且存在至少一条 `orchestrator_host` 精确等于 `skill-relay-claude-headed`、`phase` 落在合法枚举 `A_planning|planning|gan|generate|evaluate|done` 且非 `failed`/`unknown` 的记录（EXISTS 定点读；historical failed 行允许共存）。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-f90ddca3-396d-45b2-ad13-2dfbd9e15080}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
# 定点读 1: 该 initiative 至少存在一条 run 记录（无记录 = 派发未成功 = FAIL）
ANYROW=$(psql "$DB" -XAt -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' LIMIT 1")
[ -n "$ANYROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
# 定点读 2: 存在至少一条 host 精确匹配 + phase 合法非 failed/unknown 的记录（容忍历史 failed 行共存）
GOODPHASE=$(psql "$DB" -XAt -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_host='skill-relay-claude-headed' AND phase IN ('A_planning','planning','gan','generate','evaluate','done') AND phase NOT IN ('failed','unknown') ORDER BY started_at DESC LIMIT 1")
[ -n "$GOODPHASE" ] || { echo "FAIL: initiative_runs 存在记录但无合法 phase 记录(host 精确匹配+phase 合法非 failed/unknown)"; exit 1; }
echo "legal phase found: $GOODPHASE"
```

**硬阈值**: 定点读 1 非空（记录存在）；定点读 2 非空（至少一条合法记录）；两者任一为空即 FAIL。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-f90ddca3-396d-45b2-ad13-2dfbd9e15080}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07241038-relay-f90ddca3}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

echo "── Step 0: 落点铁律核对(永久池产物存在, sprints/ 无测试产物) ──"
[ -f "scripts/smoke/e2e/relay-f90ddca3.sh" ] || { echo "FAIL: e2e wrapper 未落永久池 scripts/smoke/e2e/relay-f90ddca3.sh"; exit 1; }
[ -f "tests/regression/relay-f90ddca3/headed-smoke-contract.test.ts" ] || { echo "FAIL: contract 测试未落永久池 tests/regression/relay-f90ddca3/"; exit 1; }
ORPHAN=$(find "$SPRINT_DIR" -maxdepth 2 \( -name "*.test.ts" -o -name "e2e-verify.sh" \) | head -1)
[ -z "$ORPHAN" ] || { echo "FAIL: sprints/ 临时路径发现测试产物 $ORPHAN (落点铁律违规)"; exit 1; }
echo "OK Step 0"

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

echo "── Step 3: DB initiative_runs 定点核对(EXISTS 语义, 容忍历史 failed 行) ──"
ANYROW=$(psql "$DB" -XAt -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' LIMIT 1")
[ -n "$ANYROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
GOODPHASE=$(psql "$DB" -XAt -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_host='skill-relay-claude-headed' AND phase IN ('A_planning','planning','gan','generate','evaluate','done') AND phase NOT IN ('failed','unknown') ORDER BY started_at DESC LIMIT 1")
[ -n "$GOODPHASE" ] || { echo "FAIL: initiative_runs 存在记录但无合法 phase 记录(host 精确匹配+phase 合法非 failed/unknown)"; exit 1; }
echo "OK Step 3 (legal phase=$GOODPHASE)"

echo "── Step 4: wrapper 本体端到端执行(交付物即探针) ──"
TASK_ID="$TASK_ID" SPRINT_DIR="$SPRINT_DIR" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash scripts/smoke/e2e/relay-f90ddca3.sh
echo "OK Step 4"

echo "PASS: headed relay 回归证据全部验证通过 task_id=$TASK_ID"
```

**通过标准**: 脚本 exit 0，Step 0/1/2/3/4 均打印 OK，末尾打印 `PASS`。
**失败标准**: 任一断言失败 → exit 1 并打印具体 `FAIL: ...` 原因。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| e2e wrapper 三件事校验骨架 | `../../tests/regression/relay-f90ddca3/headed-smoke-contract.test.ts` | 文件存在且调用 smoke 与 allowlist 校验、payload 关键字段齐全且不含敏感字段明文、initiative_runs 存在至少一条 host 精确匹配且 phase 合法非 failed/unknown | → 5 failures（`scripts/smoke/e2e/relay-f90ddca3.sh` 未创建前测试全部 FAIL） |
