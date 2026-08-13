# Sprint Contract Draft (Round 1) — 修复 Coding 合并身份闸与 AI 验收闭环

**锚定父路声明**: 独立小路（无父路）——PrepPRD 未锚定 step（`step_id: none`），本 sprint 是修复合并权威漏洞的独立后端小路。

**journey_type**: autonomous
**target_environment**: local_api
**map_scope**: [MAP_NOT_CONFIGURED]（task.payload 未注入 map_scope/map_repo，跳过 Unified Map 半径，不回退领域硬编码）

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree，packages/brain/src/lib/contract-gate.js 存在 → 走代码层 Contract Gate（非跳过）

---

## Response Schema（推导来源: PRD 字面 + api_registry 不可达[NEW_PATTERN]）

> Brain/registry 在本 fleet-worker 不可达（postgres:false，Brain 未运行），下列 schema 按 PRD 字面 + 现有代码约定（`gates.mergeGate` / `validation-identity-policy.js`）推导，Brain 侧新读端点标 `[NEW_PATTERN]`，交 Reviewer 复核。

### 1. should-auto-merge.sh 输出契约（stdout 决定字面量）
- `MERGE`：整行严格等于 `MERGE`（无后缀）。仅受信 entitlement 精确绑定 repo+PR+head_sha 时输出。
- `SKIP: <原因>`：fail-closed。`<原因>` ∈ `{ 非 cp-* 分支, harness-owned(feat(harness):), entitlement_unverifiable, entitlement_missing, untrusted_entitlement, stale_head_sha, entitlement_binding_mismatch, brain_unreachable }`
- **禁用输出**：对通用 cp-*（无受信 entitlement）绝不输出 `MERGE`；label/标题不得单独产出 `MERGE`。

### 2. Endpoint: `GET /api/brain/harness/merge-entitlement?repo=<repo>&pr=<n>&head_sha=<sha>` [NEW_PATTERN]
**Success (HTTP 200)**:
```json
{"entitled": true, "trusted": true, "repo": "perfectuser21/cecelia", "pr_number": 4870, "head_sha": "0a6ed21c"}
```
- `entitled` (boolean, 必填): 受信 /dev 通道是否为此 (repo,pr,head_sha) 签发 entitlement — 来源 [NEW_PATTERN]（消费既有受信签发，不新建签发通道）
- `trusted` (boolean, 必填): 签发通道是否受信 — 来源 PRD Invariant[受信通道]
- `repo` / `pr_number` / `head_sha`: entitlement 绑定的三元组，须与查询参数逐字相等
**禁用字段名**: `label`、`title`（label/标题投影不得作为授权字段）
**不可达/超时**: curl 非 0 退出 → 视为 Brain 不可达 → fail-closed（不解析 body）

### 3. evaluateMergeAuthority(input) 返回契约（纯函数，validation-identity-policy.js）[NEW_PATTERN，与 gates.mergeGate 同构]
**输入**: `{ evaluateReceipt:{verdict,pr_head_sha}|null, judgeReceipt:{verdict,pr_head_sha}|null, prHeadSha:string, brainQueryOk:boolean }`
**输出**: `{ allow:boolean, reason:string }`，`reason` ∈ `{ all_roles_pass, brain_query_error, evaluate_receipt_missing, stale_evaluate_sha, evaluate_not_pass, judge_receipt_missing, stale_judge_sha, judge_not_pass }`
- 判定顺序（fail-closed）：`brainQueryOk===false` → `brain_query_error`；再 evaluate（缺→旧SHA→非PASS/FIXED）；再 judge（缺→旧SHA→非PASS）；全过 → `all_roles_pass`。

### 4. derive(observed) merged 分支 [FROM_PRD RED-B]
- `pr.merged===true` 且（同 `pr.head_sha` 的 evaluateVerdict PASS/FIXED **且** judgeVerdict PASS）→ `{phase:'done', action:'report', reason:'pr_merged'}`
- `pr.merged===true` 但缺任一同 head PASS receipt → `{phase:'failed', action:'mark_failed', reason:'premature_merge'}`

---

## 已知约束（来自回归测试 + 累积 FR）

- context-manifest: unavailable（Brain 不可达，累积 FR 端点未取；PRD `## 累积 FR` 显式「本 line 暂无历史」）
- [回归] `gates.mergeGate`（gates.js）已是唯一 merge 权威：缺 evaluate/judge、stale sha、not-pass、review 未批 → deny。本刀新增 `evaluateMergeAuthority` **并入 Brain 查询错误 fail-closed**，不得削弱 mergeGate 现有判据。
- [回归] `derive.js` 既有「merged 短路」用例（derive.test.js 787-813）编码「merged 无条件 done」——这正是本刀要修的假成功 bug，Generator 须更新这些旧用例为「补齐两个同 head PASS receipt 才 done」，不属零回归保护范围。
- [回归] `materializeApprovedContract`（contract-store.js）既有：draft 换版、approved 同证据幂等（L112-113）、approved 不同证据报错（L108-109）。本刀仅**新增** superseded/未知附着状态守卫，不得破坏上述三态。
- [回归] `validation-identity-policy.js` 既有 `evaluateValidationIdentityPolicy`（premature identity binding 扫描）须保留导出，新增 `evaluateMergeAuthority` 为并列导出。
- [铁律映射] 见 contract-dod.md 的 INV-1..INV-5（法源 decision e4e37f10 + thin_prd）。

---

## Golden Path

系统从 [PR 就绪] → 经过 [身份闸判定 + AI 验收闭环] → 到达 [仅受权威授权才 merge，否则 fail-closed]

### Step 1: RED-A 通用 auto-merge 身份闸 fail-closed（should-auto-merge.sh）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（L22-25）+ 预期受影响文件 L56-57

**可观测行为**: 直接跑 `should-auto-merge.sh`：identity 缺失/写入延迟/陈旧 head/Brain 不可达四态 → 均输出 `SKIP`；受信 entitlement 精确绑定 repo+PR+head_sha → `MERGE`；通用 cp-* 无 entitlement → `SKIP`；仅 label/标题 → 不授权。

**验证命令**:
```bash
bash sprints/08131950-harness-merge-authority-r6/tests/red-a-should-auto-merge.test.sh
# 期望：Results: PASS=7 FAIL=0，exit 0
```
**硬阈值**: 7 条断言全过（4 条 fail-closed + 3 条 guard），exit 0
**验证命令（硬阈值→可执行）**:
```bash
bash sprints/08131950-harness-merge-authority-r6/tests/red-a-should-auto-merge.test.sh | grep -qE 'Results: PASS=7 FAIL=0' || { echo FAIL; exit 1; }
```

---

### Step 2: RED-B 提前合并终态 fail-closed（Kernel，derive.js + loop.js）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（L26-28）+ Invariant[不假成功]（L82）

**可观测行为**: `derive(observed)` 对 `pr.merged` 且缺同 head Evaluator/Judge PASS receipt → 返回 `{phase:'failed', action:'mark_failed', reason:'premature_merge'}`；loop.js 经 `markRunFailed` 落 run=failed（task 不 completed）并写可追责事件；两个同 head PASS receipt 齐备才 `done/pr_merged`。

**验证命令**:
```bash
DATABASE_URL="$DB_URL" npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-b-premature-merge.test.mjs
# 期望：5 tests passed（3 premature fail-closed + 2 合法合并 guard）
```
**硬阈值**: derive premature_merge 分支命中；合法双 PASS 仍 done
**验证命令（DB 侧接缝，local_api 真 psql）**:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM tasks t JOIN initiative_runs r ON r.initiative_id=t.id WHERE t.status='completed' AND r.failure_reason='premature_merge'" | tr -d ' ' | grep -qx 0 || { echo 'FAIL: premature_merge 竟回填 completed'; exit 1; }
```

---

### Step 3: RED-C 合并权威 fail-closed（validation-identity-policy.js evaluateMergeAuthority）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（L29-31）+ 预期受影响文件 L59

**可观测行为**: 仅同一 PR head_sha 的 Evaluator PASS/FIXED receipt + 独立 Judge PASS receipt → `allow:true`；缺角色/旧 SHA/被拒 callback(非 PASS)/Brain 查询错误 → `allow:false` 且 fail-closed reason。

**验证命令**:
```bash
npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-c-merge-authority.test.mjs
# 期望：10 tests passed
```
**硬阈值**: 双同 head PASS → allow；四类 fail-closed 输入 → deny 且 reason 精确
**AI_ADDED 说明**: `[AI_ADDED]` — `brainQueryOk` 入参 + `brain_query_error` reason 是本刀在 gates.mergeGate 之外新增的 fail-closed 输入（理由：mergeGate 只接 verdict 对象，无法表达「Brain 查询本身出错必须拒绝」，缺它则查询异常时会 fail-open）。

---

### Step 4: RED-D 合同状态机四态守卫（contract-store.js materializeApprovedContract）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（L32-33）+ 预期受影响文件 L60

**可观测行为**: 附着合同为 draft → 允许原子换版；approved 同证据 → 幂等；approved 不同证据 → 报错；**superseded/未知状态 → 报错，不得重激活**（新增守卫）。

**验证命令**:
```bash
DATABASE_URL="$DB_URL" npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-d-contract-store-statemachine.test.mjs
# 期望：3 tests passed（superseded 报错 + 未知状态报错 + draft 换版 guard）
```
**硬阈值**: superseded/未知附着状态 → 抛错（当前 fall-through 重激活 → RED）；draft 仍可换版
**验证命令（硬阈值→可执行）**:
```bash
DATABASE_URL="$DB_URL" npx vitest run sprints/08131950-harness-merge-authority-r6/tests/red-d-contract-store-statemachine.test.mjs 2>&1 | grep -qE '3 passed' || { echo FAIL; exit 1; }
```

---

## 真实调用方请求 shape

**适用**：Step 1 的通用 auto-merge job（GitHub Actions `ci.yml` 的 `auto-merge`）是 should-auto-merge.sh 的真实调用方。

- 真实调用方：`.github/workflows/ci.yml` 的 `auto-merge` job（受 `ci-passed` 成功后触发），以 `bash should-auto-merge.sh <head_branch> <pr_title> ...` 调用，读 stdout 决定是否 `gh pr merge --auto --squash`。
- 关键字段：head_branch（`github.head_ref`）、pr_title（`github.event.pull_request.title`）、repo（`github.repository`）、pr_number（`github.event.pull_request.number`）、head_sha（`github.event.pull_request.head.sha`）。Generator 须在 `ci.yml` 把后三个绑定参数补入调用点（否则脚本 fail-closed 输出 `SKIP: entitlement_unverifiable`，符合安全语义但会拦停所有 /dev auto-merge——因此 CI 调用点补参是本刀交付的一部分）。
- Brain 查询走 `curl -fsS -m ${BRAIN_TIMEOUT:-5}`，认证：只读 entitlement 端点，不向不受信 runner 下发通用 internal token（PRD NFR/Invariant[受信通道]）。

## 未覆盖真实链路清单

- **Brain merge-entitlement 端点 [NEW_PATTERN]**：本合同 RED-A shell 测试用 PATH curl 替身注入 Brain 返回（离线确定性），未在单测里打真实 Brain。真验证补位：`## E2E 验收` 段在 local_api 环境对真实 Brain 端点做一次 `curl` 存在性+schema 校验（谁/何时/环境：evaluator / final-e2e / local_api）。若 Brain 侧端点尚未落地，Generator 须在本刀同时实现该只读端点（消费既有受信 entitlement 存储），否则 CI auto-merge 全线 fail-closed。
- **loop.js premature_merge 端到端落库**：RED-B 单测覆盖 derive 纯函数分支；run/task 终态与可追责事件的真实落库由 `## E2E 验收` 的 psql 不变量查询 + 既有 loop.test.js（Generator 补 premature 用例）覆盖。

## 禁 mock 边清单

- `contract-store.js` ↔ DB 表 `initiative_contracts` / `initiative_runs`（本刀改状态机守卫，RED-D 必须真 Postgres 验附着状态判定与换版落库，禁 mock DB；用 TEMP 表 + 事务隔离）。
- `loop.js` premature_merge ↔ `finalizeKernelRun`→run/task 终态 DB 写（RED-B 的落库终态必须真 markRunFailed 落库验证，不 mock finalizeRun）。
- `should-auto-merge.sh` ↔ Brain entitlement HTTP 边界（判据逻辑不 mock；仅用 curl 替身注入 HTTP 对端返回，模拟真实 Brain 响应/不可达，属「更外层无关依赖的替身」而非 mock 被改的判据边）。
- `derive.js` premature_merge：纯函数，无 DB/网络边 → mock N/A（纯函数直接真调）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 合并授权 fail-closed：身份闸(RED-A)/提前合并终态(RED-B)/合并权威(RED-C)/合同状态机(RED-D) 四刀 |
| **NFR（做得多好）** | 非功能 | Brain 查询超时(默认 5s)视为不可达→SKIP；不向不受信 runner 下发通用 internal token |
| **Invariant（永不违反）** | 不变量 | 见 INV-1..INV-5（合并权威 fail-closed / 受信通道 / 同 head 验收 / 真实验收 / 不假成功）|
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | entitlement 精确绑定 head_sha，PR force-push 后旧 entitlement 立即失效(→stale_head_sha SKIP)；无长期凭据 |
| **死亡告警（停了谁知道）** | 告警 | premature_merge 与每次拒绝写可追责事件到 Brain（PRD NFR 可观测）；run→failed 触发既有失败上报 |
| **失败语义（挂了怎么办）** | 故障 | 一律 fail-closed：拒绝/SKIP，绝不 fail-open 放行 merge（见失败语义声明）|
| **效果确认（已发≠已生效）** | 回执 | should-auto-merge 输出 MERGE/SKIP 字面量即回执；merge 授权以 evaluateMergeAuthority allow + Harness merge handler 实际合并为准 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ entitlement 是否受信且精确绑定当前 head_sha | A. 只看 label/标题前缀; B. 查受信通道签发的 entitlement 三元组(repo+PR+head_sha)+trusted 标志 | B | 标题/label 可伪造且不随 head 变化(#4870 根因) | 误判 fail-open→裁判被架空、假成功(生产事故) |
| ⚠️ PR 被外部 merged 是否「合法」 | A. 见 merged 即成功; B. 要求同 head_sha 的 Evaluator PASS/FIXED + Judge PASS receipt 齐备 | B | 无条件 done 会把外部抢先合并记假成功(#4870) | 误判→run 假记 done/task completed，掩盖未验收代码 |
| Brain 查询不可达/超时是否放行 | A. 超时默认放行(fail-open); B. 超时视为不可达→拒绝(fail-closed) | B | PRD NFR/Invariant 明确 fail-closed | 误判 fail-open→不可达期任意 PR 被合并 |
| 附着合同状态是否可换版 | A. 非 approved 一律换版; B. 仅 draft 换版，superseded/未知报错 | B | superseded 重激活会复活已作废合同证据 | 误判→已废合同被重激活当权威证据 |

> ⚠️ 行属「升拍板点」级别；PrepPRD 已由法源 decision e4e37f10 拍定 fail-closed 总方针，判定点 B 方案与之一致，无新增待确认项。
> judgment-pending-user: 无（均由 decision e4e37f10 覆盖）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain merge-entitlement 查询超时/不可达 | should-auto-merge 输出 `SKIP: brain_unreachable`，不合并 | 是（无副作用，纯读判定） | 交 harness gate / 待 Brain 恢复重跑 CI |
| Evaluator/Judge receipt 缺失或旧 SHA | evaluateMergeAuthority `allow:false`，Harness 不合并 | 是（纯函数判定） | 等同 head_sha 双 PASS receipt 后重判 |
| 外部在验收前 merged | derive `premature_merge`→run failed，task 不 completed，写可追责事件 | 是（终态幂等） | 人工介入 / 事故追责，不回填成功 |
| 附着合同 superseded/未知 | materializeApprovedContract 抛错，事务 ROLLBACK | 是（抛错前不落库） | 修复附着关系后重跑，不重激活 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| PR 标题/label（外部可写） | 不受信 | N/A（非 LLM 输入） | 标题/label 不得单独授权 merge；只作展示投影，授权只认受信 entitlement |
| Brain merge-entitlement 响应 | 受信端点只读 | N/A | 仅接受 trusted:true 且三元组精确匹配；任何不匹配/不可达→fail-closed |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: should-auto-merge.sh 传畸形 entitlement JSON（缺 head_sha 字段 / entitled 为字符串 "true" / pr_number 类型不符）→ 必须 fail-closed SKIP，不得因解析异常 fail-open
- 重复提交: 同一 PR 连续两次调用 should-auto-merge（幂等，两次结论一致）；materializeApprovedContract 对同 run 重复 approved 同证据幂等
- 中途中断: entitlement 查询返回中途被截断 body（半个 JSON）→ SKIP
- 边界值: entitlement head_sha 与 PR head_sha 仅大小写/前缀长度不同（短 SHA vs 全 SHA）→ 必须精确匹配否则 SKIP
发现分级: P0/P1（fail-open 放行 merge / 假记 done）→ 阻塞 merge；P2/P3（错误信息不精确等）→ 记 findings 不阻塞

gate-allow: domain/db-no-time-window premature_merge 不变量断言（completed 却 premature_merge 的记录恒为 0，跨全表全时段），刻意不加时间窗——加窗会放过更早的历史假成功记录，与断言目的相反（Step 2 psql + E2E 步骤 4 同理）

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> evaluator 模式B 在 local_api 执行；`$DB_URL` 由 Fleet 注入（本 attempt 隔离空库/或既有 cecelia 库）。本段是四刀永久回归的机器可跑 oracle，另加 Brain 端点存在性与 DB 不变量的接缝校验。

```bash
#!/bin/bash
set -uo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SPRINT_DIR="sprints/08131950-harness-merge-authority-r6"
FAILED=0

# 0. DB 连接（local_api 必须显式传 DB_URL；缺失即环境未就绪 FAIL，不 fail-open）
DBU="${DB_URL:-${DATABASE_URL:-}}"
if [ -z "$DBU" ]; then echo "FAIL: DB_URL/DATABASE_URL 未注入，环境未就绪"; exit 1; fi
export DATABASE_URL="$DBU"

# 1. RED-A：直接跑 should-auto-merge 身份闸 shell 回归（四态 SKIP + 受信 MERGE + guard）
bash "$SPRINT_DIR/tests/red-a-should-auto-merge.test.sh" | tee /tmp/red-a.log
grep -qE 'Results: PASS=7 FAIL=0' /tmp/red-a.log || { echo "FAIL: RED-A 未全过"; FAILED=1; }

# 2. RED-B/C/D：orchestrator 永久回归（真 Postgres 跑 RED-D 状态机）
npx vitest run \
  "$SPRINT_DIR/tests/red-b-premature-merge.test.mjs" \
  "$SPRINT_DIR/tests/red-c-merge-authority.test.mjs" \
  "$SPRINT_DIR/tests/red-d-contract-store-statemachine.test.mjs" \
  --reporter=basic 2>&1 | tee /tmp/red-bcd.log
grep -qE 'FAIL|failed' /tmp/red-bcd.log && { echo "FAIL: RED-B/C/D 存在失败"; FAILED=1; }

# 3. 接缝 L2：Brain merge-entitlement 只读端点存在且返回 JSON（不可达即环境接缝断裂）
BRAIN_BASE="${BRAIN_BASE_URL:-http://localhost:5221}"
ENT_RESP="$(curl -fsS -m 5 "$BRAIN_BASE/api/brain/harness/merge-entitlement?repo=perfectuser21/cecelia&pr=0&head_sha=deadbeef" 2>/dev/null || true)"
if [ -n "$ENT_RESP" ]; then
  echo "$ENT_RESP" | jq -e 'has("entitled") and has("trusted")' >/dev/null || { echo "FAIL: entitlement 端点 schema 缺 entitled/trusted"; FAILED=1; }
else
  echo "WARN: merge-entitlement 端点未响应（若 Brain 侧端点已交付则视为接缝断裂 FAIL）"; FAILED=1
fi

# 4. 接缝 L2：DB 不变量——不存在「premature_merge 却回填 completed/done」的记录
BAD="$(psql "$DBU" -tAc "SELECT count(*) FROM tasks t JOIN initiative_runs r ON r.initiative_id=t.id WHERE t.status='completed' AND r.failure_reason='premature_merge'" 2>/dev/null | tr -d ' ')"
if [ -n "$BAD" ]; then
  [ "$BAD" = "0" ] || { echo "FAIL: 存在 premature_merge 却 completed 的假成功记录 count=$BAD"; FAILED=1; }
else
  echo "WARN: 不变量查询未执行（failure_reason 列缺失则 Generator 须补迁移）"
fi

[ "$FAILED" -eq 0 ] && echo "OK: Golden Path 四刀验证通过" || { echo "FAIL: E2E 未全过"; exit 1; }
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| RED-A 身份闸 fail-closed | `tests/red-a-should-auto-merge.test.sh` | 通用 cp-* 无 entitlement → 默认 SKIP / Brain 不可达 → fail-closed SKIP / 陈旧 head_sha 不匹配 → SKIP / 不受信通道签发 → SKIP | 当前 4 FAIL（fail-open 输出 MERGE） |
| RED-B 提前合并终态 | `tests/red-b-premature-merge.test.mjs` | 无同 head Evaluator/Judge + 外部 merged → premature_merge / Evaluator PASS 但 Judge 缺失 → premature_merge | 当前 3 FAIL（返回 done） |
| RED-C 合并权威 | `tests/red-c-merge-authority.test.mjs` | 缺 Evaluator receipt → 拒绝 / 缺 Judge receipt → 拒绝 / Evaluator receipt 锚定旧 SHA → 拒绝 stale_evaluate_sha | 当前 9 FAIL（函数未导出） |
| RED-D 合同状态机 | `tests/red-d-contract-store-statemachine.test.mjs` | superseded 附着 → 报错 / 未知状态附着 → 报错 / draft 附着 → 允许原子换版 | 当前 3 SKIP(无DB)；local_api 下 superseded/未知 2 FAIL（fall-through 重激活）|
