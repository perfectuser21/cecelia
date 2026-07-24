# Sprint Contract Draft (Round 1)

**Sprint**: [FIRE DRILL 07241955] Kernel v1 mixed provider 最终主链验收（R5）
**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）— PRD `journey_id: none`，本 sprint 为一次性 fire drill 验收，无父 Golden Path。

notes:
- contract-gate: packages/brain/src/lib/contract-gate.js 存在（cecelia 本仓），代码层 Contract Gate 正常生效，无跳过。
- 本合同全部 manual oracle 已于 round 1 真跑并记录真实 exit code（见文末「Manual oracle 实跑记录」），红断言的 FAIL 即 TDD Red 证据。

---

## Response Schema（推导来源: N/A — 任务无新增 HTTP 端点）

本 sprint 为 docs-only 交付（仅新增 `docs/fire-drills/kernel-v1-mixed-20260724-r5.md`），**不新增/不修改任何 HTTP 端点**，故无新 Response Schema 需定义。

验收所消费的**既有**端点 shape（来源: 源码摘录 + 本轮实测，非记忆）：

### Endpoint: GET /api/brain/tasks/:id（既有）
- `payload.harness_runtime` (string): 本 task 实测值 `"kernel-v1"`
- `payload.role_assignments.<role>` (object): `{"provider": string, "account": string}`，五角色 key 为 `planner/proposer/reviewer/generator/evaluator`；本 task 实测 planner/proposer=`claude/account1`，reviewer/evaluator=`grok/grok`，generator=`codex/team3`

### Endpoint: GET /api/brain/orchestrator/relay-runs?task_id=<uuid>（既有）
- 返回 JSON 数组，行字段含 `id`、`initiative_id`、`phase`、`current_task_id`（来源: packages/brain/src/routes/initiatives.js L216-L322）
- 本 task 实测：1 行，`id=150fcf54-4e9a-454c-abc9-6b58f63ac77f`，`current_task_id=e321ac5e-98ad-483c-b7ff-d8a6ac7c3687`

**禁用字段名**: N/A（无新增端点，无字段命名决策）

---

## 已知约束（来自回归测试 + 累积 FR + 铁律）

- [relay-runs.test.js] → 「正常返回 v2 runs — HTTP 200 + JSON 数组含必填字段」「?limit=abc 非法值返回 400 + error 字段」「DB 查询失败 → HTTP 500 + JSON error 字段，进程不崩」— relay-runs 端点行为已有回归契约，本合同只读不改
- [relay-runs.test.js] → 「SQL 查询必须含 orchestrator_version=v2 过滤条件」— 断言 relay-runs 归属时使用 `?task_id=` 服务端过滤即可，无需客户端再过滤 orchestrator_version
- 累积 FR: （本 line 暂无历史，PRD 已声明）
- context-manifest: N/A（PRD `journey_id: none`，无 line 级 context-manifest 可拉）
- 铁律清单: 已逐条映射，见 contract-dod.md `## Invariant 铁律映射` 段
- `[AI_ADDED]` 本轮实跑发现（round 1 manual oracle 真跑抓到的假绿洞）: **jq 1.6 对空输入 `-e` 返回 exit 0**（上游 curl -sf / gh 失败时管道尾 jq -e 假绿）。本合同全部管道断言已改为「捕获变量 → 非空守卫 → 再 jq -e」惯用法；Reviewer/Generator/Evaluator 沿用断言时禁止回退为裸 `cmd | jq -e` 单管道

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 仅新增 `docs/fire-drills/kernel-v1-mixed-20260724-r5.md`，含标记 `KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5`、生产版本 `1.267.67`、merge commit `19887912bbb581597f12c714a9ed187f051e2850`、五角色 provider/account 实际运行证据摘要；PR diff 相对 origin/main 恰此一行文件 |
| **NFR（做得多好）** | 非功能需求 | 任务总超时 28800s；全部验收命令以结构化 checks 记录 command/exit_code/log_tail（落 `e2e-checks.jsonl`）；CI 全绿等待预算 1800s |
| **Invariant（永不违反）** | 不变量 | ① human review 批准前 PR 不得 merge（含 generator 自行 merge、CI auto-merge 兜底）；② PR diff 禁带 sprints/**、.harness/**、packages/brain/**；③ HARNESS_TASK_ID/CECELIA_TASK_ID 与服务端 task id 不等则 generator 禁止开工；④ 严禁复用 cp-harness-propose/contract 分支 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效与退役 | 证据文档为一次性 fire drill 落档，merge 后永久留档不退役；本合同产物（sprints/**）不进 PR、随 harness 分支生命周期结束 |
| **死亡告警（停了谁知道）** | 告警手段 | 本 sprint 无常驻功能。链路层面：kernel-v1 运行失败由 Brain relay watchdog / initiative_runs.failure_reason 记录，controller 上报 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | evaluator PASS 仅为 pre-human 证据完整；最终生效 = authenticated human review 经认证端点批准后 merge，report 阶段以 main 上可查到该 merge commit 为回执 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| CI 是否全绿 | A. `gh pr checks`; B. `gh pr view --json statusCheckRollup` 全量 rollup | B. statusCheckRollup，全部 conclusion/state ∈ {SUCCESS,NEUTRAL,SKIPPED} 且非空 | rollup 同时覆盖 CheckRun 与 StatusContext 两类，空集不算绿 | 红 CI 被判绿，不合格 PR 进入 human review |
| ⚠️ PR 是否未被提前 merge | A. `gh pr view --json state`; B. `--json mergedAt` 判 null | A+B 双断言：state==OPEN 且 mergedAt==null | 单看 state 有 MERGED/CLOSED 歧义，mergedAt 是 merge 事实的直接字段 | 违规提前 merge（不可逆）漏抓，human review 门形同虚设（PRD 边界情况已拍板此语义，非待确认） |
| run 是否归属当前 task | A. 客户端拉全量后过滤; B. `?task_id=` 服务端过滤 + jq 复核 current_task_id | B | 服务端参数走 UUID 校验与索引（源码 L253-L257），jq 复核防参数被忽略 | 他人 run 冒充本 run，跨 provider 证据失真 |
| 五角色分配是否属实 | A. 信文档自述; B. task API payload.role_assignments 为 SSOT，文档逐角色与 API 实时交叉核对 | B | payload 是 Brain 派发时写入的分配事实源，文档手抄可造假 | 假证据摘要落档，fire drill 结论不可信 |
| writer/reviewer/evaluator 是否独立 session | A. evaluator 层直接验 session id; B. evaluator 层验 provider/account 分配 + 证据摘要一致，session 独立性由 judge 依 kernel 运行记录裁决 | B | session 归属是 orchestrator 侧运行时事实，evaluator 无独立 oracle，强行断言即造假 | 同 session 冒充独立复审，复审失效（由 judge 层兜底裁决） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain API（5221）不可达/超时 | 该 check FAIL（exit≠0），拦截，不放行 | 是（全部为只读 GET） | 无降级，环境未就绪即 FAIL，禁止 exit 0 兜底 |
| gh / GitHub API 不可达或限流 | 该 check FAIL，拦截 | 是（只读查询） | 无降级；evaluator 可整体重跑 |
| CI 在 1800s 预算内未全绿 | check FAIL，超时即 FAIL | 是 | 禁止把 pending 当 PASS |
| PR diff 出现越界文件 | check FAIL（负向断言命中即 exit 1） | 是 | 无降级，generator 必须重做分支 |
| relay-runs 查无本 run | check FAIL | 是 | 无降级（PRD ASSUMPTION: kernel 运行时应已写入） |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent、无外部用户可写入口；全部输入为 Brain 内部派发 payload 与只读验收命令。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路：不新增端点，验收调用方就是 evaluator 本身的只读 curl/gh/git，与生产调用方同构（Brain API 走 localhost:5221 无鉴权 header，与 dashboard/controller 现行调用一致）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 全部断言打真实 Brain（localhost:5221）、真实 GitHub（gh 带真凭据）、真实 git 仓库；无 force_*/stub/假数据。第三方真调（规则 B）：`gh pr view`/`gh pr view --json statusCheckRollup` 即对 GitHub API 的真 token 真请求真响应校验。

## 禁 mock 边清单

（本单为纯文档新增：generator 交付物仅 `docs/fire-drills/kernel-v1-mixed-20260724-r5.md` 一个 markdown 文件，不触及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A。）
验收侧只读消费 Brain API 与 GitHub API，均为真调无 mock；tests/ 内测试用真实 fs 读文件，无 vi.mock/stub。

## 接缝清单（接缝断言 vs 逻辑断言）

| # | 接缝点（碰真实世界处） | 真目标验证方式 | 状态 |
|---|---|---|---|
| 1 | Brain 生产进程 + Postgres（task payload / relay-runs 运行时状态） | evaluator 真 curl localhost:5221（B3/B4/B8），非 mock | 本轮已真验（见实跑记录，exit 0） |
| 2 | GitHub 真实 PR 状态与 CI（gh 真凭据调 GitHub API） | evaluator 真跑 `gh pr view`（B5/B6） | 待 generator 开 PR 后由 evaluator 真验（当前无 PR，属预期红） |
| 3 | human review 认证端点批准（judge PASS 后由系统创建 request） | evaluator 阶段只验其**前置**成立（PR 未 merge，B5）；批准动作本身属 judge 之后的 human 阶段职责，不在本合同断言范围 | 前置断言进合同；批准本体后段执行 |

逻辑断言（环境无关）：文档内容三要素（marker/版本/commit）、分支命名格式 — CI/单测验绿即 done。

---

## Golden Path

[Brain 派发 harness task（kernel-v1）] → [GAN 合同 + 独立 reviewer] → [generator 身份核对] → [generator 建合规分支新增证据文档] → [PR OPEN + diff 恰一行 + CI 绿] → [evaluator 结构化 checks PASS] → [judge pre-human gate → human review 批准 → merge/report]

### Step 1: Brain 派发本 task，五角色 provider/account 分配写入 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 1」：五角色 provider/account 分配已写入 task payload（可经 Brain task API 观察）

**可观测行为**: `GET /api/brain/tasks/<task_id>` 返回 `payload.harness_runtime=kernel-v1`，且 planner/proposer=claude/account1、reviewer/evaluator=grok/grok、generator=codex/team3；relay-runs API 有归属本 task 的 run 记录。

**验证命令**:
```bash
TASK_ID="e321ac5e-98ad-483c-b7ff-d8a6ac7c3687"
# jq 1.6 对空输入 -e 返回 exit 0（本轮实跑发现的假绿洞），故必须先捕获并做非空守卫，再进 jq
RESP=$(curl -sf "http://localhost:5221/api/brain/tasks/$TASK_ID") || { echo "FAIL: Brain API 不可达"; exit 1; }
echo "$RESP" | jq -e '.payload.harness_runtime == "kernel-v1" and (.payload.role_assignments | .planner == {"provider":"claude","account":"account1"} and .proposer == {"provider":"claude","account":"account1"} and .reviewer == {"provider":"grok","account":"grok"} and .evaluator == {"provider":"grok","account":"grok"} and .generator == {"provider":"codex","account":"team3"})'
RUNS=$(curl -sf "http://localhost:5221/api/brain/orchestrator/relay-runs?task_id=$TASK_ID") || { echo "FAIL: relay-runs 不可达"; exit 1; }
echo "$RUNS" | jq -e --arg t "$TASK_ID" 'type == "array" and length >= 1 and all(.[]; .current_task_id == $t)'
```

**硬阈值**: 两条 jq -e 均 exit 0；relay-runs 行数 ≥ 1 且全部 `current_task_id` 等于本 task id。

---

### Step 2: proposer 产出合同，独立 session reviewer 审合同（本 GAN 阶段自身）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 2」

**可观测行为**: 本合同三产物（contract-draft.md / contract-dod.md / tests/）落在 `cp-harness-propose-r1-e321ac5e-a2` 分支；reviewer（grok，独立 session）对本合同给出 verdict。此步由 GAN 流程本身承载，不产出额外运行时断言。

**验证命令**:
```bash
git show --stat HEAD -- sprints/07241955-kernel-fire-drill-mixed-r5/ | head -20
# 期望：合同三产物 + task-plan.json 在 propose 分支的提交中可见
```

**硬阈值**: 三产物齐 + Step 2b-check 确定性自查全过（自查脚本输出「✅ 合同格式自查通过」）。

---

### Step 3: generator 身份核对 — HARNESS_TASK_ID / CECELIA_TASK_ID 机械核对
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 3」与「边界情况」：二者缺失或与服务端 task id 不等 → generator 禁止开工

**可观测行为**: generator 开工前执行核对；核对通过的下游可观测产物 = 合规分支存在且命名含本 task short id（见 Step 4 断言），且证据文档内记录二者核对结果。

**验证命令**:
```bash
# generator 侧开工前必跑（写进 task-plan dod，evaluator 复核其下游产物）：
[ -n "${HARNESS_TASK_ID:-}" ] && [ -n "${CECELIA_TASK_ID:-}" ] || { echo "FAIL: 注入变量缺失，禁止开工"; exit 1; }
[ "$HARNESS_TASK_ID" = "e321ac5e-98ad-483c-b7ff-d8a6ac7c3687" ] && [ "$CECELIA_TASK_ID" = "e321ac5e-98ad-483c-b7ff-d8a6ac7c3687" ] || { echo "FAIL: task id 不等，禁止开工"; exit 1; }
```

**硬阈值**: 二变量均非空且字面等于 `e321ac5e-98ad-483c-b7ff-d8a6ac7c3687`，否则 exit 1 停止。

---

### Step 4: generator 从 origin/main 建全新合规分支，新增唯一证据文档
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 4」+「预期受影响文件」

**可观测行为**: 当前分支命名匹配 `cp-MMDDHHMM-e321ac5e`（非 propose/contract 分支）；`docs/fire-drills/kernel-v1-mixed-20260724-r5.md` 存在且含标记、版本、merge commit、五角色证据摘要；文档证据行与 Brain API 实时分配逐角色一致。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r5.md"
BR=$(git rev-parse --abbrev-ref HEAD)
echo "$BR" | grep -Eq '^cp-[0-9]{8}-e321ac5e' || { echo "FAIL: 分支名不合规 [$BR]"; exit 1; }
echo "$BR" | grep -Eq '^cp-harness-(propose|contract)' && { echo "FAIL: 复用合同分支"; exit 1; } || true
grep -q 'KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5' "$DOC" && grep -q '1\.267\.67' "$DOC" && grep -q '19887912bbb581597f12c714a9ed187f051e2850' "$DOC" || { echo "FAIL: 文档三要素不全"; exit 1; }
```

**硬阈值**: 分支名匹配 `^cp-[0-9]{8}-e321ac5e` 且不匹配 `^cp-harness-(propose|contract)`；文档三要素 grep 全中。

---

### Step 5: PR 前 diff 机械确认恰一行 → 开 PR → PR OPEN、未 merge、CI 全绿
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 5」+「边界情况」（diff 越界 → FAIL；human review 前 merge → 违规）

**可观测行为**: `git diff --name-only origin/main...HEAD` 输出恰一行 = 目标文档；`gh pr view` 显示 state=OPEN、mergedAt=null、headRefOid=本地 HEAD；statusCheckRollup 全绿。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r5.md"
git fetch origin main --quiet
D=$(git diff --name-only origin/main...HEAD)
[ "$D" = "$DOC" ] || { echo "FAIL: diff 非恰一行目标文档，实际=[$D]"; exit 1; }
git diff --name-only origin/main...HEAD | grep -Eq '^(sprints/|\.harness/|packages/brain/)' && { echo "FAIL: 越界文件混入 PR"; exit 1; } || true
PR_JSON=$(gh pr view --json state,mergedAt,headRefOid) || { echo "FAIL: gh pr view 失败或无 PR"; exit 1; }
[ -n "$PR_JSON" ] || { echo "FAIL: 空响应"; exit 1; }
echo "$PR_JSON" | jq -e --arg h "$(git rev-parse HEAD)" '.state == "OPEN" and .mergedAt == null and .headRefOid == $h' || { echo "FAIL: PR 状态不符"; exit 1; }
```

**硬阈值**: diff 字面等于单行 `docs/fire-drills/kernel-v1-mixed-20260724-r5.md`；state==OPEN 且 mergedAt==null 且 headRefOid==本地 HEAD。

---

### Step 6: CI 全绿（等待预算 1800s until-loop）
**来源**: `[AI_ADDED]` — PRD 只写「CI 全绿」；等待预算与轮询范式为 proposer 加入，理由：CI 为异步事件，无预算的等待要么假绿（把 pending 当过）要么无限挂起

**可观测行为**: within 1800s 内 statusCheckRollup 非空且全部 conclusion/state ∈ {SUCCESS,NEUTRAL,SKIPPED}。

**验证命令**:
```bash
DEADLINE=$((SECONDS + 1800))
until PRJ=$(gh pr view --json statusCheckRollup 2>/dev/null) && [ -n "$PRJ" ] && echo "$PRJ" | jq -e '[.statusCheckRollup[] | (.conclusion // .state)] | length > 0 and all(.[]; . == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED")' >/dev/null 2>&1; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: CI 未在 1800s 内全绿"; exit 1; }
  sleep 30
done
echo "OK: CI 全绿"
```

**硬阈值**: 1800s 内收敛，rollup 非空全绿；空 rollup 不算绿。

---

### Step 7: evaluator 结构化 checks 全 PASS（模式 B final-e2e）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 6」+ NFR「全部验收命令必须以结构化 checks 记录 command、exit_code、log_tail」

**可观测行为**: evaluator 执行本合同 `## E2E 验收` 脚本，产出 `e2e-checks.jsonl`（每行含 check/command/exit_code/log_tail），全部 exit_code=0，脚本整体 exit 0。

**验证命令**: 即下方 `## E2E 验收` 脚本本体（evaluator 独立 task 执行，proposer 不执行）。

**硬阈值**: 脚本 exit 0；checks 文件每行 4 键齐全。

---

### Step 8: 文档证据行与 Brain API 实时分配交叉核对
**来源**: `[AI_ADDED]` — 理由：防 generator 手抄一份看起来正确的假证据摘要；文档五角色行必须与 task API payload（分配事实源）逐角色 provider/account 匹配，方能证明「实际运行证据」非编造

**可观测行为**: 对五角色逐个：API 的 provider/account 值能在文档同一行按 `role.*provider.*account` 顺序 grep 命中。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r5.md"
TASK_ID="e321ac5e-98ad-483c-b7ff-d8a6ac7c3687"
RESP=$(curl -sf "http://localhost:5221/api/brain/tasks/$TASK_ID") || { echo "FAIL: Brain API 不可达"; exit 1; }
echo "$RESP" | jq -r '.payload.role_assignments | to_entries[] | "\(.key) \(.value.provider) \(.value.account)"' > /tmp/ra.txt
[ $(wc -l < /tmp/ra.txt) -eq 5 ] || { echo "FAIL: 角色行数非 5"; exit 1; }
FAIL_ROLE=0
while read -r role prov acct; do
  grep -Eq "$role.*$prov.*$acct" "$DOC" || { echo "FAIL: 文档缺 $role 证据行（$prov/$acct）"; FAIL_ROLE=1; }
done < /tmp/ra.txt
[ "$FAIL_ROLE" -eq 0 ] || exit 1
echo "OK: 五角色证据行与 API 实时分配一致"
```

**硬阈值**: 五角色全部命中，任一缺失 exit 1。

---

### Step 9: judge pre-human gate → human review → merge/report（阶段语义声明，非 evaluator 断言）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体 7」+「边界情况」

**可观测行为与阶段语义（写死，judge 必须遵守）**:
- independent judge 是 authenticated human review **之前**的 pre-human gate；judge 运行时「尚无人工批准且 PR 未 merge」是**正确的 PASS 前置条件**。
- judge 只裁决**截至 evaluator PASS 的结构化证据**（e2e-checks.jsonl + PR 状态 + 本合同）是否完整；**禁止**索要未来人审批准、禁止索要 judge 自己尚未产生的输出作为证据；把「人审已批准/PR 已 merge」当 PASS 条件 = 阶段语义违规，判 FAIL。
- judge PASS 后系统才允许创建 human review request；经认证端点批准后才 merge/report。human review 批准前任何环节 merge（含 CI auto-merge 兜底）= 违规。
- evaluator 层对此步的机器断言 = Step 5 的 `mergedAt == null`（前置成立）；批准动作本体属后段职责，不在本合同断言范围。

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

> evaluator 作为独立 task，在 generator 的 PR 分支 worktree（repo 根目录）执行本脚本。全部为只读验收命令（curl GET / git 查询 / gh 查询），可幂等重跑。每条 check 以结构化 JSON 行落 `sprints/07241955-kernel-fire-drill-mixed-r5/e2e-checks.jsonl`，含 command/exit_code/log_tail。

```bash
#!/bin/bash
set -uo pipefail
# 不用 set -e：失败由 run_check 逐条捕获记录，末尾统一判定，保证结构化 checks 完整落档

TASK_ID="${HARNESS_TASK_ID:-e321ac5e-98ad-483c-b7ff-d8a6ac7c3687}"
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r5.md"
BRAIN="http://localhost:5221"
SPRINT_DIR="${SPRINT_DIR:-sprints/07241955-kernel-fire-drill-mixed-r5}"
CHECKS_FILE="$SPRINT_DIR/e2e-checks.jsonl"
export TASK_ID DOC BRAIN
mkdir -p "$SPRINT_DIR"
: > "$CHECKS_FILE"
FAILED=0

run_check() {
  # $1=check 名  $2=命令字符串（bash -c 真执行并原样记录）
  local name="$1" cmd="$2" out ec
  out=$(bash -c "$cmd" 2>&1); ec=$?
  printf '%s' "$out" | tail -c 400 > /tmp/e2e-ck-tail.txt
  python3 - "$name" "$cmd" "$ec" /tmp/e2e-ck-tail.txt "$CHECKS_FILE" <<'PYEOF'
import json, sys
name, cmd, ec, tailf, path = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
tail = open(tailf, encoding='utf-8', errors='replace').read()
with open(path, 'a') as f:
    f.write(json.dumps({"check": name, "command": cmd, "exit_code": ec, "log_tail": tail}, ensure_ascii=False) + "\n")
PYEOF
  if [ "$ec" -ne 0 ]; then
    echo "CHECK FAIL [$name] exit=$ec"
    printf '%s\n' "$out" | tail -n 5
    FAILED=1
  else
    echo "CHECK OK [$name]"
  fi
}

# ---- check 1: 目标文档存在（PRD 验收点 1）----
read -r -d '' C1 <<'EOF' || true
test -f "$DOC"
EOF
run_check "doc-exists" "$C1"

# ---- check 2: 标记 + 版本 + merge commit 三要素（PRD 验收点 2）----
read -r -d '' C2 <<'EOF' || true
grep -q 'KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5' "$DOC" && grep -q '1\.267\.67' "$DOC" && grep -q '19887912bbb581597f12c714a9ed187f051e2850' "$DOC"
EOF
run_check "doc-three-elements" "$C2"

# ---- check 3: diff 恰一行目标文档（PRD 验收点 3）----
read -r -d '' C3 <<'EOF' || true
git fetch origin main --quiet
D=$(git diff --name-only origin/main...HEAD)
[ "$D" = "$DOC" ] || { echo "diff 实际内容: [$D]"; exit 1; }
EOF
run_check "diff-exactly-one-doc" "$C3"

# ---- check 4: diff 禁带越界文件（PRD 边界情况，负向断言）----
read -r -d '' C4 <<'EOF' || true
if git diff --name-only origin/main...HEAD | grep -E '^(sprints/|[.]harness/|packages/brain/)'; then
  echo "越界文件混入 PR"
  exit 1
fi
EOF
run_check "diff-no-forbidden-paths" "$C4"

# ---- check 5: 分支命名合规，非合同分支（PRD Golden Path 4）----
read -r -d '' C5 <<'EOF' || true
BR=$(git rev-parse --abbrev-ref HEAD)
echo "当前分支: $BR"
echo "$BR" | grep -Eq '^cp-[0-9]{8}-e321ac5e' || { echo "分支名不合规"; exit 1; }
if echo "$BR" | grep -Eq '^cp-harness-(propose|contract)'; then echo "复用合同分支"; exit 1; fi
EOF
run_check "branch-naming-discipline" "$C5"

# ---- check 6: PR OPEN、未 merge、head SHA 一致（PRD 验收点 4 + human review 前禁 merge 前置）----
read -r -d '' C6 <<'EOF' || true
PR_JSON=$(gh pr view --json state,mergedAt,headRefOid) || { echo "gh pr view 失败或无 PR"; exit 1; }
[ -n "$PR_JSON" ] || { echo "空响应"; exit 1; }
echo "$PR_JSON" | jq -e --arg h "$(git rev-parse HEAD)" '.state == "OPEN" and .mergedAt == null and .headRefOid == $h'
EOF
run_check "pr-open-unmerged-headsha" "$C6"

# ---- check 7: CI 全绿，within 1800s until-loop（PRD 验收点 4）----
read -r -d '' C7 <<'EOF' || true
DEADLINE=$((SECONDS + 1800))
until PRJ=$(gh pr view --json statusCheckRollup 2>/dev/null) && [ -n "$PRJ" ] && echo "$PRJ" | jq -e '[.statusCheckRollup[] | (.conclusion // .state)] | length > 0 and all(.[]; . == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED")' >/dev/null 2>&1; do
  [ $SECONDS -lt $DEADLINE ] || { echo "CI 未在 1800s 内全绿"; exit 1; }
  sleep 30
done
echo "$PRJ" | jq -r '[.statusCheckRollup[] | (.conclusion // .state)] | join(",")'
EOF
run_check "ci-all-green-within-1800s" "$C7"

# ---- check 8: Brain task API — kernel-v1 + 五角色分配（PRD 验收点 5）----
read -r -d '' C8 <<'EOF' || true
RESP=$(curl -sf "$BRAIN/api/brain/tasks/$TASK_ID") || { echo "Brain API 不可达"; exit 1; }
[ -n "$RESP" ] || { echo "空响应"; exit 1; }
echo "$RESP" | jq -e '.payload.harness_runtime == "kernel-v1" and (.payload.role_assignments | .planner == {"provider":"claude","account":"account1"} and .proposer == {"provider":"claude","account":"account1"} and .reviewer == {"provider":"grok","account":"grok"} and .evaluator == {"provider":"grok","account":"grok"} and .generator == {"provider":"codex","account":"team3"})'
EOF
run_check "task-api-kernel-v1-role-assignments" "$C8"

# ---- check 9: relay-runs 本 run 存在且归属当前 task（PRD 验收点 6）----
read -r -d '' C9 <<'EOF' || true
RUNS=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs?task_id=$TASK_ID") || { echo "relay-runs 不可达"; exit 1; }
[ -n "$RUNS" ] || { echo "空响应"; exit 1; }
echo "$RUNS" | jq -e --arg t "$TASK_ID" 'type == "array" and length >= 1 and all(.[]; .current_task_id == $t)'
EOF
run_check "relay-run-belongs-to-task" "$C9"

# ---- check 10: 文档五角色证据行与 API 实时分配交叉核对（防手抄假证据）----
read -r -d '' C10 <<'EOF' || true
RESP=$(curl -sf "$BRAIN/api/brain/tasks/$TASK_ID") || { echo "Brain API 不可达"; exit 1; }
echo "$RESP" | jq -r '.payload.role_assignments | to_entries[] | "\(.key) \(.value.provider) \(.value.account)"' > /tmp/e2e-ra.txt
[ $(wc -l < /tmp/e2e-ra.txt) -eq 5 ] || { echo "角色行数非 5"; exit 1; }
FAIL_ROLE=0
while read -r role prov acct; do
  grep -Eq "$role.*$prov.*$acct" "$DOC" || { echo "文档缺 $role 证据行 ($prov/$acct)"; FAIL_ROLE=1; }
done < /tmp/e2e-ra.txt
[ "$FAIL_ROLE" -eq 0 ]
EOF
run_check "doc-roles-crosscheck-api" "$C10"

# ---- 汇总 ----
echo "---- checks 汇总: $CHECKS_FILE ----"
cat "$CHECKS_FILE"
if [ "$FAILED" -ne 0 ]; then
  echo "FAIL: 存在未通过 check"
  exit 1
fi
echo "✅ Golden Path 验证通过（全部 checks exit_code=0，结构化记录已落档）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `sprints/07241955-kernel-fire-drill-mixed-r5/tests/fire-drill-doc.test.ts` | 含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R5；生产版本 1.267.67；merge commit 19887912bbb581597f12c714a9ed187f051e2850；五角色 provider/account 证据摘要 | → 4 failures（目标文档尚不存在，readFile ENOENT） |

---

## Manual oracle 实跑记录（round 1 — 铁律「合同批准前必须记录 manual oracle 真实 exit code」）

在 propose 分支（无 PR、目标文档未创建）真跑全部 DoD manual 命令，解释器均确认启动：

**第一遍真跑抓到真 bug**：初版 B5/B6 写成裸 `gh ... | jq -e` 单管道，在「无 PR」时实测 exit=0 假绿——根因是 jq 1.6 空输入 `-e` 返回 0。已全量改为「捕获 → 非空守卫 → jq」后重跑，第二遍真实 exit code 如下：

| DoD 条目 | 修复后真实 exit code | 判读 |
|---|---|---|
| A1/A2 node -e 三要素 | 1 | 红（ENOENT，目标文档未建；解释器确认启动）— 预期 |
| B1 diff 恰一行 | 1 | 红（propose 分支 diff 为合同产物，非目标文档）— 预期 |
| B2 禁带越界文件 | 1 | 红（propose 分支 diff 含 sprints/**，负向断言命中）— 预期，证明断言真的会咬 |
| B3 task API 五角色 | 0 | 绿（验证 GP Step 1 派发事实，派发后任意时点 PASS 属预期，非 generator 产物断言） |
| B4 relay-runs 归属 | 0 | 绿（同上，run 150fcf54 已在库且归属本 task） |
| B5 PR 状态 | 1 | 红（尚无 PR，gh pr view 失败被守卫正确拦截）— 预期（初版此处假绿 exit 0，已修） |
| B6 CI 全绿 | 1 | 红（无 PR，用 DEADLINE=0 变体确认失败路径正确触发）— 预期（初版此处假绿 exit 0，已修） |
| B7 分支命名 | 1 | 红（当前为 cp-harness-propose-r1-* 合同分支，断言正确拒绝）— 预期 |
| B8 文档角色交叉核对 | 1 | 红（目标文档不存在，角色行 grep 全 miss）— 预期 |

vitest 红证据：4/4 failures（见 tests/，ENOENT 读不到目标文档）。
