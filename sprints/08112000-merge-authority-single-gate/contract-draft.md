# Sprint Contract Draft (Round 1) — 合并权收归单一裁决闸（harness-judge required check）

journey_type: autonomous ｜ target_environment: local_api
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），走代码层 Contract Gate + 本 skill 内置规则。
gp-anchor: skipped (product-map.json not found) — 本仓库为 cecelia，无 product-map/generated/product-map.json，GP-Anchor 段整体跳过，不阻塞。

---

## Response Schema（推导来源: api_registry 离线 → 现有 harness 路由约定推导；PRD 未字面给 schema）

> 说明: fleet-worker 离线，`/api/brain/registry` 不可达；字段命名按 `packages/brain/src/routes/harness.js`
> 现有端点约定（`pr_url` / `run_id` snake_case、错误统一 `{"error": "<string>"}`）推导，标 `[api_registry推导]`。

### Endpoint: GET /api/brain/harness/pr-ownership

**Query 参数**（`branch` 与 `pr_url` 至少给一个）:
- `pr_url` (string, 可选): PR 的 GitHub URL；优先判据（kernel 写入 `initiative_runs.pr_url`）。
- `branch` (string, 可选): PR head 分支名；作为 kernel 记录的精确查找键（匹配 `tasks.payload->>'pr_branch'` 或 `pr_url LIKE %branch%`），**非** `cp-*` 正则模式判定。

**Success (HTTP 200)**:
```json
{"owned": true, "run_id": "11111111-1111-1111-1111-111111111111", "pr_url": "https://github.com/o/r/pull/4759", "matched_by": "branch"}
```
- `owned` (boolean, 必填): 是否存在 `orchestrator_version='v2'` 的 initiative_run 认领此 PR。来源——PRD 核心（凭 `initiative_runs.pr_url`，非标题/分支模式）
- `run_id` (uuid|null, 必填): 命中的 run id；未命中为 `null`。来源——[api_registry推导: harness 路由 run_id 约定]
- `pr_url` (string|null, 必填): 命中 run 的 kernel 记录 pr_url；未命中 `null`。来源——[api_registry推导]
- `matched_by` ("pr_url"|"branch"|null, 必填): 命中判据来源；未命中 `null`。来源——[NEW_PATTERN: 审计透明]

**禁用字段名**（不得作为正向 owned 判据出现）: `title`, `pr_title`, `is_harness`（标题/自由文本类）；`owned` 不得由 `^cp-` / `^feat\(harness\):` 正则推出。

**Error (HTTP 400)**:
```json
{"error": "branch 或 pr_url 至少提供一个"}
```

---

## 已知约束（来自回归测试 + 累积 FR）

- [`.github/workflows/scripts/__tests__/should-auto-merge.test.sh`] → 现有断言: `feat(harness):` PR → SKIP；`fix(brain)`/`fix(ci)`/`feat(dashboard)` cp-* PR → MERGE；非 cp-* → SKIP；auto-merge job 用 `--auto --squash --delete-branch` + `always()` + `contents/pull-requests: write`。**本 sprint 判据由标题换 Brain 求证后，这些"由标题决定"的历史断言将被"由 Brain owned 决定"的等价断言替换（title→owned 语义迁移），但 auto-merge job 的机制断言（--auto/权限/always）必须原样保留不回退。**
- [`packages/brain/src/orchestrator/gates.js` mergeGate] → 不变量: merge 唯一权威 = evaluate PASS + judge PASS + verdict SHA==head + 人审。本 sprint **不改** mergeGate 判定，只在其放行后新增"置 harness-judge check success"副作用。
- [`packages/brain/src/pr-callback-handler.js`] → 既有 branch→task 解析约定: `payload->>'pr_branch' = $1 OR pr_url LIKE '%'||$1||'%'`；本 sprint 归属查询复用该已验证模式。
- [累积FR] context-manifest: unavailable（fleet-worker 离线，`/api/brain/line/e6f803f2/context-manifest` 未取；PRD「累积 FR」段声明本 line 暂无历史）。

---

## Golden Path

**锚定父路声明**: 覆盖父路 e6f803f2（F1 开发闭环）第 4 步「交付有回执」——合并权由裁判裁决、不被旁路。

[harness run 开出 cp-* PR] → [harness-judge required check 默认非 success] → [三通道均等 required check] → [归属求证兜底] → [mergeGate 全过 → kernel 置 check success] → [judge PASS 才可合并]

---

### Step 1: harness run 开出 PR，Brain 可凭 kernel 记录求证归属
**来源**: `[FROM_PRD]` — Golden Path 第 1 步 + 「必须实现」第 2 条（凭 `initiative_runs.pr_url` 求证）

**可观测行为**: 存在 `orchestrator_version='v2'` 且 pr_url/pr_branch 认领该 PR 的 initiative_run 时，归属端点返回 `owned:true` + run_id；否则 `owned:false`。

**验证命令**:
```bash
# 已 seed 一条 harness run（pr_branch=$SEED_BR）后:
curl -sf "localhost:5221/api/brain/harness/pr-ownership?branch=$SEED_BR" | jq -e '.owned==true and (.run_id|type=="string")'
# 不存在的 /dev 分支:
curl -sf "localhost:5221/api/brain/harness/pr-ownership?branch=cp-dev-nonexistent-xyz" | jq -e '.owned==false'
```
**硬阈值**: seeded 分支 owned==true 且 run_id 非空；随机分支 owned==false。

---

### Step 2: 参数缺失与非 harness PR 的确定性应答
**来源**: `[FROM_PRD]` — 范围「fail-closed 是脚本侧职责，端点干净返回 owned:false」+ 边界（400）

**可观测行为**: `branch`/`pr_url` 均缺 → HTTP 400 `{error}`；命中 /dev（无 run）→ 200 `owned:false`（脚本据此放行，不回归）。

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pr-ownership"); [ "$CODE" = "400" ] || { echo "FAIL: 缺参未 400 ($CODE)"; exit 1; }
```
**硬阈值**: 无参 HTTP 400。

---

### Step 3: 通道 1 should-auto-merge.sh 归属换 Brain 求证 + fail-closed
**来源**: `[FROM_PRD]` — 「必须实现」第 3 条 + 边界（Brain 不可达/5xx/非法JSON → SKIP）

**可观测行为**: 脚本以 `$BRAIN_URL` + `branch` 求证：owned → `SKIP:...`；not-owned + cp-* → `MERGE`；非 cp-* → `SKIP`；Brain 任意故障（连接拒绝/超时/5xx/非法JSON）→ `SKIP`（fail-closed），**绝不 MERGE**。标题不再参与判据（保留为日志参数）。

**验证命令**:
```bash
BRAIN_URL="http://127.0.0.1:1" bash .github/workflows/scripts/should-auto-merge.sh "cp-x-abc" "fix(brain): x" | grep -q '^SKIP' || { echo "FAIL: Brain 不可达未 fail-closed"; exit 1; }
```
**硬阈值**: Brain 不可达时脚本输出以 `SKIP` 开头，退出后不产生 MERGE。

---

### Step 4: 通道 2/3 收敛闸——kernel 在 mergeGate 放行后才置 harness-judge=success
**来源**: `[AI_ADDED]` — 理由: PRD「必须实现」第 1 条要求 required check 默认 pending、仅 kernel 全门过才 success；这是"物理不可合并"的执行点。放到 `merge_pr` 内、真实 `gh pr merge` 之前，保证只有走完 mergeGate（loop.js F6 双保险已校验 allow）才置 success。

**可观测行为**: `merge_pr` handler 在执行 `gh pr merge` 前，先对 PR head SHA 用版本无关 REST 置 `harness-judge` commit status = `success`（`gh api repos/{o}/{r}/statuses/{sha} -f state=success -f context=harness-judge`）；置 check 命令在 merge 命令之前发出。

**验证命令**:
```bash
# node 驱动真实 handler，spy execCmd，断言先置 check 后 merge（不 mock 被改的 mergeGate→merge_pr 状态机边）
node --input-type=module -e '
import { createKernelHandlers } from "./packages/brain/src/orchestrator/kernel-handlers.js";
const calls=[]; const h=createKernelHandlers({execCmd:c=>{calls.push(String(c));return {status:0};}});
await h.merge_pr({observed:{pr:{url:"https://github.com/o/r/pull/9",head_sha:"deadbeef",mergeStateStatus:"CLEAN"}}});
const si=calls.findIndex(c=>c.includes("statuses/deadbeef")&&c.includes("harness-judge")&&c.includes("state=success"));
const mi=calls.findIndex(c=>c.includes("pr merge"));
if(si<0){console.error("FAIL: 未置 harness-judge=success",calls);process.exit(1);}
if(mi>=0&&si>mi){console.error("FAIL: 置 check 晚于 merge");process.exit(1);}
console.log("OK");'
```
**硬阈值**: 输出 OK（存在 `statuses/<sha>` + `harness-judge` + `state=success` 命令，且其序号 < merge 命令序号）。

---

### Step 5: /dev 非 harness cp-* PR 不回归
**来源**: `[FROM_PRD]` — 「必须实现」第 5 条 + Invariant [不回归/dev]（红线）

**可观测行为**: Brain 明确 `owned:false` 的 cp-* PR → 脚本 `MERGE`（照旧被通用 auto-merge）；且该 PR 不被施加 harness-judge 阻断（CI 兜底 job 见 owned:false → 置 harness-judge=success，required check 满足）。

**验证命令**:
```bash
# stub Brain 返回 owned:false（见 E2E 段用真实 stub server 驱动）
bash .github/workflows/scripts/should-auto-merge.sh "cp-x-devpr" "fix(brain): 手动 dev" | grep -q '^MERGE'
```
**硬阈值**: not-owned + cp-* → MERGE（红线，误拦即卡死所有 /dev）。

---

## 真实调用方请求 shape（本单涉及跨进程/外部调用）

**调用方 1: `.github/workflows/scripts/should-auto-merge.sh` → Brain 归属端点**（本仓库内，认证无——localhost 内网 GET）
- 方法/路径: `GET ${BRAIN_URL}/api/brain/harness/pr-ownership?branch=<head_ref>`（分支来自 `github.head_ref`，已在 auto-merge job 走 env，无注入面）
- 关键字段: query `branch`（必），可选 `pr_url`；响应按上文 Response Schema 逐字段 `jq -e`。
- 生产调用方即 ci.yml auto-merge job（已注入 `BRAIN_URL` env，见 ci.yml:1943）——本 sprint 复用同一 env，不新增双路径。

**调用方 2: kernel `merge_pr` → GitHub statuses REST**（外部第三方 GitHub API）
- 命令: `gh api repos/{owner}/{repo}/statuses/{head_sha} -X POST -f state=success -f context=harness-judge -f description=...`
- owner/repo 从 `pr.url` 正则解析（沿用同文件 update-branch 的 `/github\.com\/([^/]+)\/([^/]+)\/pull\//` 解析法，版本无关 REST，对齐 gh 2.45 教训）。
- head_sha 取 `ctx.observed.pr.head_sha`（kernel 观测所得，非 LLM）。

---

## 未覆盖真实链路清单（mock 豁免 / 接缝未真验显式登记）

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|---|
| **GitHub required check 物理阻断合并**（harness-judge=pending 时 `gh pr merge --auto` 真不合并） | 单测/E2E 用 execCmd spy + stub 验"我方是否置对 status"，未在真 GitHub 上验"平台是否据此拦合并" | evaluator local_api 无法为 fixture 仓配置 branch protection（required check 是仓库级 GitHub 设置，非本 attempt 可 provision） | 主理人/后续单独 task：在一个 fixture 私仓开 PR + 将 `harness-judge` 登记为 main 分支保护 required check，跑本合同 `## E2E 验收` 的 `HARNESS_PR_FIXTURE=1` 分支（真置 pending→真 `gh pr merge --auto`→断言未合并→真置 success→断言可合并）。标 `logic-done-pending`。 |
| 通道 3 engine-pr-watchdog `gh pr merge --auto` 前先问归属 | 本 PR 不改该 skill（源在 zenithjoy-skills，不在 workspace）| 边界明确规定不改它 | 产出 `engine-pr-watchdog-改造说明.md` + Brain 端点契约供后续实施；在其改造前，第 1 条 required check 兜底（owned PR 的 harness-judge=pending 会让它的 --auto 一样排队不合并）。 |
| kernel 置 status 后 GitHub 状态传播延迟导致紧接的 `gh pr merge` 偶发仍 blocked | 未在真 GitHub 验证传播时序 | 同第 1 行（无 fixture）| 改造实施单里要求 kernel 置 success 后对 merge 做有限重试（≤3 次，间隔），补真 GitHub 传播时序验证。标 `logic-done-pending`。 |

---

## 禁 mock 边清单

本单涉及「跨模块数据传递」（脚本↔Brain HTTP）与「状态机」（mergeGate→merge_pr 置 check 副作用），按 v9.12 硬规则逐条列禁 mock 的边：

- **should-auto-merge.sh ↔ Brain 归属端点（跨进程 HTTP 边）**: 测试必须用**真实 HTTP stub server**（真 socket、真 curl）驱动，禁止 mock curl / 桩掉 HTTP 传输层。见 `tests/should-auto-merge-brain.test.ts`（`node:http` 起真服务）。
- **mergeGate → merge_pr 状态机边**: 单测必须调用**真实** `createKernelHandlers().merge_pr` handler（不桩 handler、不桩 mergeGate 判定），只允许 spy **最外层** `deps.execCmd`（gh CLI 外部边界）。见 `tests/`/Step 4 node 断言。
- **归属端点 ↔ initiative_runs 表（DB 读边）**: 端点为**只读 SELECT，非 DB 写路径**；其真实 DB 读边由 `contract-dod.md` 的 [L2] BEHAVIOR（真 Brain + 真 psql seed/查）覆盖。`tests/pr-ownership-endpoint.test.ts` 允许 mock `db.js` 仅验 handler 存在性与响应 shape（read-shape 单测），不替代 L2 真读。
- 本单**无 DB 写路径**（端点只读；kernel 只发 GitHub 外部 status），故无「代码↔DB 表 写路径」条目。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 引入 harness-judge required check + Brain 归属求证端点；通道 1 判据换 Brain；kernel mergeGate 放行后置 check success；产出通道 3 改造说明。 |
| **NFR（做得多好）** | | 归属求证有限超时（脚本侧 `curl -m` 有限秒，超时=SKIP）；置 check/合并走版本无关 GitHub REST；归属判定与 auto-merge 失败可追溯（脚本 `SKIP:<原因>`、失败回写 Brain task）。 |
| **Invariant（永不违反）** | | [裁决唯一闸] owned PR judge PASS 前物理不可合并；[fail-closed] Brain 异常一律 SKIP 绝不 MERGE；[不回归/dev] Brain 明确 not-owned 的 cp-* 必 MERGE；[归属凭 Brain 非标题] 只凭 initiative_runs 记录，禁标题/分支正则。 |
| **判定点（怎么知道）** | | 见下方登记表。 |
| **保质期（何时过期）** | | required check 名 `harness-judge` 与分支保护登记同生命周期；归属记录随 initiative_run 生命周期，run done/failed 后 pr_url 仍可查（回归历史分支需要）。 |
| **死亡告警（停了谁知道）** | | 归属端点 500 / 脚本 SKIP 原因进 CI 日志；auto-merge 排队失败 PATCH 回写 Brain task=failed（沿用现有 ci.yml:1968 逻辑）。 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明（一律拦截优先，fail-closed）。 |
| **效果确认（已发≠已生效）** | | 端点回执 `owned` 布尔可 `jq -e` 机检；kernel 置 check 由 execCmd 命令序可断言；真 GitHub 阻断效果登记进未覆盖清单（fixture 补位）。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 某 PR 是否 harness-owned | A. PR 标题 `feat(harness):`；B. 分支 `^cp-` 正则；C. Brain 查 `initiative_runs.pr_url`/`pr_branch`（kernel 写入） | C. Brain 查 kernel 记录 | 标题/分支是 LLM/人自由撰写，#4755 已证漏判；kernel 记录是唯一可靠归属源 | 误判 not-owned → 裁判被旁路强合（#4755/#4759 重演，静默面客错误）；误判 owned → 卡死 /dev（红线） |
| ⚠️ Brain 求证异常时如何裁决 | A. 放行(MERGE)；B. 拦截(SKIP) | B. fail-closed=SKIP | 宁可暂缓 /dev，绝不放行未裁决的 harness PR | 选 A → Brain 抖动期 harness PR 被旁路合并（不可逆面客风险） |
| harness-judge 何时置 success | A. CI 绿即置；B. kernel mergeGate 全过才置 | B. kernel mergeGate 全过 | CI 绿 ≠ judge PASS（#4759 CI 绿但 judge FAIL） | 选 A → check 形同虚设，退回旁路 |

> ⚠️ 行属「升拍板点」级别：judgment-pending-user: 「归属判定源=Brain 而非标题」「Brain 异常 fail-closed=SKIP（含 Brain 宕机期 /dev 也暂缓）」——两者均为 PRD 红线明列，PrepPRD 已隐含拍板；如主理人对「Brain 宕机期 /dev 暂缓」有异议需复核。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 归属端点 DB 异常 | 端点 500（不返 owned:false） | 是（纯读） | 脚本侧 fail-closed → SKIP |
| Brain 不可达/超时/5xx/非法JSON | 脚本输出 `SKIP:<原因>` | 是 | 拦截优先，等 kernel/人工处理 |
| kernel 置 harness-judge status 失败 | merge_pr 报错、不发 merge 命令 | 是（status POST 幂等，同 sha 同 context 覆盖） | 保持 check 非 success = PR 不可合并（安全侧） |
| auto-merge 排队失败 | PATCH 回写 Brain task=failed（现有逻辑） | 是 | 人工介入 |

### 输入对抗面（对外暴露 agent 必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 本 sprint 无对外暴露 agent；归属端点为内网只读 GET，`branch`/`pr_url` 仅作参数化 SQL 值（禁字符串拼接），不进任何 LLM/prompt。CI 侧 `PR_TITLE`/`HEAD_BRANCH` 已走 env 防 shell 注入（现有 ci.yml 已实现，本 sprint 保持）。 | — | — | — |

---

## 接缝清单（碰真实世界的点，1-3 条）

1. **GitHub required check 阻断合并**（接缝）: 真目标 = 真 GitHub 仓 + branch protection。evaluator local_api 不能 provision → 标 `logic-done-pending`，真验方式见「未覆盖真实链路清单」第 1 行（fixture 仓 + `HARNESS_PR_FIXTURE=1`）。
2. **kernel `gh api statuses` 置 check**（接缝，可单测逻辑侧）: 逻辑断言（命令序、参数）由 Step 4 node 断言真验（环境无关，CI 绿=done）；真 GitHub 落 status 的接缝并入第 1 条 fixture 验证。
3. **脚本 ↔ Brain 归属 HTTP**（逻辑侧，环境无关）: 真 stub server 真验（`tests/should-auto-merge-brain.test.ts`），CI 绿=done。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api（真实 Brain @ localhost:5221 + `$DB`；非 playground）

```bash
#!/bin/bash
set -euo pipefail
DB="${DB_URL:-postgresql://localhost/cecelia}"
BASE="http://localhost:5221"
SEED_BR="cp-e2e-$(date +%s)-$RANDOM"
SEED_RUN=""
cleanup() {
  [ -z "$SEED_RUN" ] || psql "$DB" -q -c "DELETE FROM initiative_runs WHERE id='$SEED_RUN'" 2>/dev/null || true
  [ -z "$SEED_RUN" ] || psql "$DB" -q -c "DELETE FROM tasks WHERE id='$SEED_RUN'" 2>/dev/null || true
}
trap cleanup EXIT

# 0. Brain 健康
curl -sf "$BASE/api/brain/health" >/dev/null || { echo "FAIL: Brain 未就绪"; exit 1; }

# 1. seed 一条 harness-owned run（task.payload.pr_branch=$SEED_BR，v2）
SEED_RUN=$(psql "$DB" -tAc "
  WITH t AS (
    INSERT INTO tasks (id, title, task_type, status, payload)
    VALUES (gen_random_uuid(), 'e2e-merge-gate-seed', 'harness_generate', 'in_progress',
            jsonb_build_object('pr_branch','$SEED_BR'))
    RETURNING id)
  INSERT INTO initiative_runs (id, initiative_id, phase, orchestrator_version, current_task_id, pr_url, started_at)
  SELECT t.id, gen_random_uuid(), 'D_merge', 'v2', t.id,
         'https://github.com/perfectuser21/cecelia/pull/999999', NOW()
  FROM t RETURNING id" | tr -d ' ')
[ -n "$SEED_RUN" ] || { echo "FAIL: seed 失败"; exit 1; }

# 2. 归属求证：seeded harness run → owned:true + run_id
curl -sf "$BASE/api/brain/harness/pr-ownership?branch=$SEED_BR" \
  | jq -e '.owned==true and (.run_id|type=="string") and (.pr_url|test("pull/999999"))' \
  || { echo "FAIL: owned harness run 未判 owned:true"; exit 1; }

# 3. 不回归 /dev：随机不存在分支 → owned:false
curl -sf "$BASE/api/brain/harness/pr-ownership?branch=cp-dev-not-a-real-run-xyz" \
  | jq -e '.owned==false' || { echo "FAIL: /dev 分支被误判 owned"; exit 1; }

# 4. 缺参 → 400
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/brain/harness/pr-ownership"); [ "$C" = "400" ] || { echo "FAIL: 缺参未 400 ($C)"; exit 1; }

# 5. 通道 1 fail-closed（红线）：Brain 不可达 → 脚本 SKIP，绝不 MERGE
OUT=$(BRAIN_URL="http://127.0.0.1:1" bash .github/workflows/scripts/should-auto-merge.sh "cp-x-abc" "fix(brain): x" || true)
echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: Brain 不可达未 fail-closed: $OUT"; exit 1; }
echo "$OUT" | grep -q 'MERGE' && { echo "FAIL: fail-closed 竟输出 MERGE"; exit 1; } || true

# 6. 通道 2/3 收敛闸：kernel merge_pr 在 gh pr merge 前先置 harness-judge=success（真 handler，spy execCmd）
node --input-type=module -e '
import { createKernelHandlers } from "./packages/brain/src/orchestrator/kernel-handlers.js";
const calls=[]; const h=createKernelHandlers({execCmd:c=>{calls.push(String(c));return {status:0};}});
await h.merge_pr({observed:{pr:{url:"https://github.com/o/r/pull/9",head_sha:"deadbeef",mergeStateStatus:"CLEAN"}}});
const si=calls.findIndex(c=>c.includes("statuses/deadbeef")&&c.includes("harness-judge")&&c.includes("state=success"));
const mi=calls.findIndex(c=>c.includes("pr merge"));
if(si<0){console.error("FAIL: kernel 未置 harness-judge=success",calls);process.exit(1);}
if(mi>=0&&si>mi){console.error("FAIL: 置 check 晚于 merge");process.exit(1);}
console.log("kernel-check OK");' || exit 1

# 7. 可选 L3 接缝（fixture 仓 + branch protection 才跑）：真 GitHub required-check 阻断合并
if [ "${HARNESS_PR_FIXTURE:-0}" = "1" ]; then
  : "${FIXTURE_REPO:?}"; : "${FIXTURE_PR:?}"; : "${FIXTURE_SHA:?}"
  gh api "repos/$FIXTURE_REPO/statuses/$FIXTURE_SHA" -X POST -f state=pending -f context=harness-judge >/dev/null
  gh pr merge "$FIXTURE_PR" --repo "$FIXTURE_REPO" --auto --squash >/dev/null 2>&1 || true
  sleep 5
  gh pr view "$FIXTURE_PR" --repo "$FIXTURE_REPO" --json state -q '.state' | grep -q MERGED && { echo "FAIL: pending 下竟被合并"; exit 1; }
  gh api "repos/$FIXTURE_REPO/statuses/$FIXTURE_SHA" -X POST -f state=success -f context=harness-judge >/dev/null
  echo "L3 fixture: pending 阻断合并已验"
else
  echo "L3 fixture 跳过（HARNESS_PR_FIXTURE!=1）— 见未覆盖真实链路清单"
fi

echo "✅ Golden Path 验证通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `GET /api/brain/harness/pr-ownership?branch=` 空串 / `?pr_url=not-a-url` / `branch` 含 SQL 元字符（`'; DROP`）→ 须参数化、不 500、不 owned:true。
- 重复提交: kernel `merge_pr` 幂等——同 head_sha 二次置 harness-judge=success 不报错（status POST 覆盖语义）。
- 中途中断: 脚本 curl 求证途中 Brain 返回 200 但 body 截断（半个 JSON）→ 必 fail-closed=SKIP。
- 边界值: 归属命中多条 run（同分支复用）→ 取最新（started_at DESC）单条，不 500；owned PR 已 merged 时端点仍返 owned:true（回归历史分支需要）。
发现分级: P0/P1（fail-closed 漏成 MERGE / 归属误判 not-owned / /dev 被误拦）→ 阻塞 merge；P2/P3（错误文案、日志缺原因）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 通道1 归属换 Brain + fail-closed | `tests/should-auto-merge-brain.test.ts` | `owned=true` → 输出 SKIP；`owned=false` + cp-* → 输出 MERGE；`Brain 5xx → SKIP`；`非法 JSON → SKIP`；`Brain 不可达（连接被拒）→ SKIP`；`回归 #4755 分支`；`回归 #4759 分支` | 9 failed（当前脚本按标题判 → owned/fail-closed 全漏）|
| Brain 归属端点 | `tests/pr-ownership-endpoint.test.ts` | `端点已注册`；`命中 v2 initiative_run → owned=true`；`无匹配 run → owned=false`；`branch 与 pr_url 均缺失 → HTTP 400` | 4 failed（端点未实现）|

> BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串。

**Contract Gate 惯用法自查**: 所有断言走 `curl -sf ... | jq -e`（值断言）或 `CODE=$(curl -s -o /dev/null -w %{http_code})`（状态码 oracle，body 刻意丢弃）；DB seed 走定点 INSERT/DELETE（非计数，不需时间窗）；负向 fail-closed 用 `|| true` 捕获后紧跟 grep 断言（非裸吞错）。
