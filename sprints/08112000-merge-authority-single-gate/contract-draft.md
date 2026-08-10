# Sprint Contract Draft (Round 2) — 合并权收归单一裁决闸（harness-judge required check）

> **Round 2 修订摘要（对 Round 1 reviewer 两条 blocker 的 closure）**：
> - **R1-1（fail-closed『超时』分支未覆盖）**：新增 fail-closed **超时** 独立用例——脚本求证 `curl` 显式带有限 `--max-time "${BRAIN_TIMEOUT:-8}"`；用「接受连接但永不响应」的真 stub server 逼出 curl exit28 超时路径（区别于 R1 的「连接被拒」exit7 快速失败）。落到 `tests/should-auto-merge-brain.test.ts` 新用例 + `contract-dod.md` 新 `B-07` [L2] BEHAVIOR + E2E 段第 5b 步。
> - **R1-2（not-owned→harness-judge=success 的 CI 兜底路径无 DoD 断言）**：新增 `[ARTIFACT]` 断言 `ci.yml` auto-merge job 在 `DECISION==MERGE`（not-owned）分支下发出 `gh api ... statuses/<sha> -f context=harness-judge -f state=success`，使 /dev PR 拿得到 required check 的 success，不被永久卡死；Golden Path Step 5 与 task-plan scope 同步显式化该 CI 代码路径。

journey_type: autonomous ｜ target_environment: local_api

> **实现期修订（generator，均为使 oracle 可运行的必要修复，不削弱断言、不改判定语义）**：
> 1. seed `phase` 原值 `'D_merge'` 不在 `initiative_runs_phase_check` 枚举内（migrations 238/312/367/382
>    均无该值，全库无 `D_merge` 引用），逐字执行会 CHECK 违反使 seed 失败 → 改为合法枚举 `'evaluate'`。
> 2. seed 缺 `created_source`：migration 375 的触发器 `enforce_v2_run_insert_identity()` 要求 v2 run
>    必须同时有 `current_task_id` 与 `created_source`，原 seed 只给前者 → INSERT 抛
>    `v2 initiative run requires current_task_id and created_source`（dod-behavior-dynamic 实证）。
>    补 `created_source='kernel_dispatch'`（`initiative_runs_created_source_check` 合法枚举之一）。
> 归属查询只按 `orchestrator_version='v2'` 过滤、与 phase/created_source 值无关，断言强度不变。

---

## Response Schema

### Endpoint: GET /api/brain/harness/pr-ownership

**Query 参数**（`branch` 与 `pr_url` 至少给一个）:
- `pr_url` (string, 可选): PR 的 GitHub URL；优先判据（kernel 写入 `initiative_runs.pr_url`）。
- `branch` (string, 可选): PR head 分支名；作为 kernel 记录的精确查找键（匹配 `tasks.payload->>'pr_branch'` 或 `pr_url LIKE %branch%`），**非** `cp-*` 正则模式判定。

**Success (HTTP 200)**:
```json
{"owned": true, "run_id": "11111111-1111-1111-1111-111111111111", "pr_url": "https://github.com/o/r/pull/4759", "matched_by": "branch"}
```
- `owned` (boolean, 必填): 是否存在 `orchestrator_version='v2'` 的 initiative_run 认领此 PR。
- `run_id` (uuid|null, 必填): 命中的 run id；未命中为 `null`。
- `pr_url` (string|null, 必填): 命中 run 的 kernel 记录 pr_url；未命中 `null`。
- `matched_by` ("pr_url"|"branch"|null, 必填): 命中判据来源；未命中 `null`。

**禁用字段名**（不得作为正向 owned 判据出现）: `title`, `pr_title`, `is_harness`；`owned` 不得由 `^cp-` / `^feat\(harness\):` 正则推出。

**Error (HTTP 400)**:
```json
{"error": "branch 或 pr_url 至少提供一个"}
```

---

## 已知约束（来自回归测试 + 累积 FR）

- [`.github/workflows/scripts/__tests__/should-auto-merge.test.sh`] → 判据由标题换 Brain 求证后，「由标题决定」的历史断言被「由 Brain owned 决定」的等价断言替换（title→owned 语义迁移），但 auto-merge job 的机制断言（--auto/权限/always）必须原样保留不回退。
- [`packages/brain/src/orchestrator/gates.js` mergeGate] → 不变量: merge 唯一权威 = evaluate PASS + judge PASS + verdict SHA==head + 人审。本 sprint **不改** mergeGate 判定，只在其放行后新增「置 harness-judge check success」副作用。
- [`packages/brain/src/pr-callback-handler.js`] → 既有 branch→task 解析约定: `payload->>'pr_branch' = $1 OR pr_url LIKE '%'||$1||'%'`；本 sprint 归属查询复用该已验证模式。

---

## Golden Path

**锚定父路声明**: 覆盖父路 e6f803f2（F1 开发闭环）第 4 步「交付有回执」——合并权由裁判裁决、不被旁路。

[harness run 开出 cp-* PR] → [harness-judge required check 默认非 success] → [三通道均等 required check] → [归属求证兜底] → [mergeGate 全过 → kernel 置 check success] → [judge PASS 才可合并]

### Step 1: harness run 开出 PR，Brain 可凭 kernel 记录求证归属
存在 `orchestrator_version='v2'` 且 pr_url/pr_branch 认领该 PR 的 initiative_run 时，归属端点返回 `owned:true` + run_id；否则 `owned:false`。

### Step 2: 参数缺失与非 harness PR 的确定性应答
`branch`/`pr_url` 均缺 → HTTP 400；命中 /dev（无 run）→ 200 `owned:false`。

### Step 3: 通道 1 should-auto-merge.sh 归属换 Brain 求证 + fail-closed
脚本以 `$BRAIN_URL` + `branch` 求证：owned → `SKIP:...`；not-owned + cp-* → `MERGE`；非 cp-* → `SKIP`；Brain 任意故障 → `SKIP`（fail-closed），**绝不 MERGE**。标题不再参与判据（保留为日志参数）。
- 连接被拒（`http://127.0.0.1:1`）：curl `exit 7` 快速失败 → SKIP。
- 超时（Brain 接受连接后挂起）：`curl` 求证显式带有限 `--max-time "${BRAIN_TIMEOUT:-8}"`，触发 `exit 28` → SKIP。
- 5xx / 非法 JSON：curl 拿到响应但状态非 2xx 或 body 非合法 JSON → SKIP。

### Step 4: kernel 在 mergeGate 放行后才置 harness-judge=success
`merge_pr` handler 在执行 `gh pr merge` 前，先对 PR head SHA 用版本无关 REST 置 `harness-judge` commit status = `success`（`gh api repos/{o}/{r}/statuses/{sha} -f state=success -f context=harness-judge`）；置 check 命令在 merge 命令之前发出。

### Step 5: /dev 非 harness cp-* PR 不回归
Brain 明确 `owned:false` 的 cp-* PR → 脚本 `MERGE`；且 `ci.yml` auto-merge job 在 `DECISION==MERGE`（not-owned）分支下先对该 PR head SHA 发出 `gh api repos/$GITHUB_REPOSITORY/statuses/<head_sha> -f state=success -f context=harness-judge`，令 required check 满足后再 `gh pr merge --auto`。

---

## 禁 mock 边清单

- **should-auto-merge.sh ↔ Brain 归属端点（跨进程 HTTP 边）**: 测试必须用**真实 HTTP stub server**（真 socket、真 curl）驱动，禁止 mock curl / 桩掉 HTTP 传输层。见 `tests/should-auto-merge-brain.test.ts`（`node:http` 起真服务）。
- **mergeGate → merge_pr 状态机边**: 单测必须调用**真实** `createKernelHandlers().merge_pr`（不桩 handler、不桩 mergeGate 判定），只允许 spy **最外层** `deps.execCmd`（gh CLI 外部边界）。
- **归属端点 ↔ initiative_runs 表（DB 读边）**: 端点为**只读 SELECT**；其真实 DB 读边由 `contract-dod.md` 的 [L2] BEHAVIOR（真 Brain + 真 psql seed/查）覆盖。`tests/pr-ownership-endpoint.test.ts` 允许 mock `db.js` 仅验 handler 存在性与响应 shape（read-shape 单测），不替代 L2 真读。

---

## E2E 验收（final-e2e — target_environment=local_api）

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
#    phase 用合法枚举 'evaluate'（'D_merge' 不在 initiative_runs_phase_check 内，seed 会 CHECK 违反）
SEED_RUN=$(psql "$DB" -tAc "
  WITH t AS (
    INSERT INTO tasks (id, title, task_type, status, payload)
    VALUES (gen_random_uuid(), 'e2e-merge-gate-seed', 'harness_generate', 'in_progress',
            jsonb_build_object('pr_branch','$SEED_BR'))
    RETURNING id)
  INSERT INTO initiative_runs (id, initiative_id, phase, orchestrator_version, current_task_id, created_source, pr_url, started_at)
  SELECT t.id, gen_random_uuid(), 'evaluate', 'v2', t.id, 'kernel_dispatch',
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

# 5. 通道 1 fail-closed（红线）：Brain 不可达（连接被拒 exit7）→ 脚本 SKIP，绝不 MERGE
OUT=$(BRAIN_URL="http://127.0.0.1:1" bash .github/workflows/scripts/should-auto-merge.sh "cp-x-abc" "fix(brain): x" || true)
echo "$OUT" | grep -q '^SKIP' || { echo "FAIL: Brain 不可达未 fail-closed: $OUT"; exit 1; }
echo "$OUT" | grep -q 'MERGE' && { echo "FAIL: fail-closed 竟输出 MERGE"; exit 1; } || true

# 5b. 通道 1 fail-closed（R1-1）：Brain 超时（接受连接后挂起 exit28）→ 脚本 SKIP，绝不 MERGE
node -e 'const s=require("http").createServer(()=>{});s.listen(0,"127.0.0.1",()=>{const p=s.address().port;let o="";try{o=require("child_process").execFileSync("bash",[".github/workflows/scripts/should-auto-merge.sh","cp-x-abc","fix(brain): x"],{env:{...process.env,BRAIN_URL:"http://127.0.0.1:"+p,BRAIN_TIMEOUT:"2"},encoding:"utf8"})}catch(e){o=String(e.stdout||"")}s.close();if(!/^SKIP/.test(o.trim())||/MERGE/.test(o)){console.error("FAIL: 超时未 fail-closed",o);process.exit(1)}console.log("timeout-skip OK")})' || exit 1

# 6. kernel merge_pr 在 gh pr merge 前先置 harness-judge=success（真 handler，spy execCmd）
node --input-type=module -e '
import { createKernelHandlers } from "./packages/brain/src/orchestrator/kernel-handlers.js";
const calls=[]; const h=createKernelHandlers({execCmd:c=>{calls.push(String(c));return {status:0};}});
await h.merge_pr({observed:{pr:{url:"https://github.com/o/r/pull/9",head_sha:"deadbeef",mergeStateStatus:"CLEAN"}}});
const si=calls.findIndex(c=>c.includes("statuses/deadbeef")&&c.includes("harness-judge")&&c.includes("state=success"));
const mi=calls.findIndex(c=>c.includes("pr merge"));
if(si<0){console.error("FAIL: kernel 未置 harness-judge=success",calls);process.exit(1);}
if(mi>=0&&si>mi){console.error("FAIL: 置 check 晚于 merge");process.exit(1);}
console.log("kernel-check OK");' || exit 1

# 6b. /dev 不回归兜底（R1-2）：ci.yml auto-merge job 对 not-owned(MERGE) PR 置 harness-judge=success
node -e 'const c=require("fs").readFileSync(".github/workflows/ci.yml","utf8");if(!/context=harness-judge/.test(c)||!/state=success/.test(c)){console.error("FAIL: ci.yml 缺 not-owned 置 harness-judge=success 兜底");process.exit(1)}console.log("ci-fallback OK")' || exit 1

echo "✅ Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| 通道1 归属换 Brain + fail-closed | `tests/should-auto-merge-brain.test.ts` | owned=true、owned=false、Brain 5xx、非法 JSON、不可达、超时、回归 #4755 分支、回归 #4759 分支、非cp-* 分支 |
| Brain 归属端点 | `tests/pr-ownership-endpoint.test.ts` | 端点已注册、命中 v2 initiative_run、无匹配 run、branch 与 pr_url 均缺失 |

> 合并 RED 证据：10 failed | 3 passed（3 passed 为现脚本行为巧合一致，非伪绿）。
