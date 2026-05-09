# Sprint Contract Draft (Round 2)

> Round 2 修订要点（基于 Round 1 Reviewer 反馈）：
> 1. 新增 [Field Contract](#field-contract) 小节，统一 Step 2~8 引用的所有 `result` JSON 字段名 — 杜绝同字段在不同 Step 写法漂移。
> 2. E2E 验收脚本 Step 2~7 改为 `source $SPRINT_DIR/scripts/lib-checks.sh; check_step_N "$INITIATIVE_TASK_ID"` — 各 Step 验证命令与 E2E 脚本同源，CI 检查 lib hash 一致即可，不再粘贴漂移。
> 3. [Test Contract](#test-contract) 表加「断言 ID/名」与「fixture 路径」两列，每个 `it()` 显式列名。

## Golden Path

[创建 harness_initiative 任务] → [Layer 1 Planner SKILL] → [Layer 2 Proposer/Reviewer GAN] → [Layer 3 spawn-and-interrupt + Generator] → [Evaluator] → [Absorption] → [Complete] → [evidence 落盘 + result.md 写 PASS / H12 草案]

---

## <a id="field-contract"></a>Field Contract（DB 字段统一约定）

> **唯一事实来源**：本节定义本合同所有 Step 引用的 `tasks.result` / `tasks.payload` JSONB 字段路径。Step 2~8 与 E2E 脚本、`scripts/lib-checks.sh` 中函数实现，**必须只引用本节字段名**；任何新增字段先在此处登记后再用。

### 父任务字段

| 字段路径 | 类型 | 出处 task_type | 含义 |
|---|---|---|---|
| `tasks.result.sprint_dir` | text | `harness_initiative`（顶层 initiative） | initiative 落地的 sprint 目录（相对仓库根） |
| `tasks.result.worktree_path` | text | `harness_initiative` | initiative 自己的根 worktree 绝对路径（用于 Step 4 反例对比） |
| `tasks.payload.tags[*]` | text[] | `harness_initiative` | 含 `verification` / `w8-v13` 便于事后过滤 |

### Planner / Proposer / Reviewer 字段

| 字段路径 | 类型 | 出处 task_type | 含义 |
|---|---|---|---|
| `tasks.result.verdict` | text | `harness_planner` | `DONE`（其余视为失败） |
| `tasks.result.propose_branch` | text | `harness_contract_propose` | 当轮 Proposer push 出去的分支名（每轮都写，包括 REVISION 轮） |
| `tasks.result.contract_draft_path` | text | `harness_contract_propose` | propose 分支上 contract 草案路径 |
| `tasks.result.task_plan_path` | text | `harness_contract_propose` | propose 分支上 task-plan.json 路径 |
| `tasks.result.verdict` | text | `harness_contract_review` | `APPROVED` / `REVISION` |
| `tasks.result.feedback` | text | `harness_contract_review` | REVISION 时的反馈正文（APPROVED 时可空） |
| `tasks.result.max_rounds_hit` | bool | `harness_contract_review` | 是否触发 MAX_ROUNDS 强收敛（合规路径必须为 false 或缺省） |

### 子任务字段（spawn-and-interrupt + Generator/Evaluator）

| 字段路径 | 类型 | 出处 task_type | 含义 |
|---|---|---|---|
| `tasks.payload.logical_task_id` | text | 任意 sub_task | runSubTaskNode 注入的逻辑 ID；缺失 = #2851 旧病 |
| `tasks.result.worktree_path` | text | `generator` | Generator 子任务实际运行的 git worktree 绝对路径 |
| `tasks.result.stdout` | text | `generator` | 远端 agent 容器 STDOUT_FILE tee 后回传内容（H7 验证点；非空表示 entrypoint tee 生效） |
| `tasks.result.exit_code` | int | `generator` / `evaluator` | 远端进程退出码 |
| `tasks.result.evaluator_worktree_path` | text | `evaluator` | Evaluator 验证时 cd 进的 worktree（H8 验证点；必须等于姊妹 generator 的 `worktree_path`） |
| `tasks.result.evaluator_verdict` | text | `evaluator` | `APPROVED` / `REJECTED` / `FORCE_APPROVED` |

### Absorption / Complete 字段

| 字段路径 | 类型 | 出处 task_type | 含义 |
|---|---|---|---|
| `tasks.result.applied` | bool | `absorption` | true=已合并；false=诚实未合并（NO_CHANGE 等） |
| `tasks.result.pr_url` | text | `absorption` | applied=true 必填，PR URL |
| `tasks.result.reason` | text | `absorption` | applied=false 必填，未合并原因（NO_CHANGE / EVAL_REJECT / etc.） |
| `tasks.result.merged` | bool | `harness_initiative` 终态 | 终态合并标志（与 absorption.applied 镜像） |
| `langgraph_checkpoints.metadata.next_node` | text | checkpoint 表 | 终态行必须 ∈ {`complete`, `end`, `__end__`} |

> **注**：本表里的 `tasks.*` 都默认在 `WHERE created_at > NOW() - interval '60 minutes'` 时间窗口内（防止 Step 命令被人工 INSERT 旧数据假绿）。

---

### Step 1: 触发 — POST /api/brain/tasks 创建一条最简 harness_initiative

**可观测行为**: Brain API 接受请求并返回新创建的 task 行（含 id、status=queued 或 in_progress、task_type=harness_initiative）。

**引用字段**: 无（此步只创建任务，不读字段）

**验证命令**:
```bash
RESP=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d '{"task_type":"harness_initiative","payload":{"description":"W8 v13 真端到端验证最简 Initiative：往 docs/current/README.md 顶部追加一行 W8 v13 verification stamp YYYY-MM-DD","tags":["verification","w8-v13"]}}')
INITIATIVE_TASK_ID=$(echo "$RESP" | jq -r '.id // .task_id')
echo "$INITIATIVE_TASK_ID" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 1
# 期望：返回的 id 是合法 UUID v4 格式
```

**硬阈值**: HTTP 200，response.id 是合法 UUID，且耗时 < 3s。

---

### Step 2: Layer 1 — harness-planner SKILL 跑通且无 push noise（H9 验证点）

**可观测行为**: Initiative 任务被分发后，brain 容器日志里出现 planner SKILL 调用并最终输出 `tasks.result.verdict='DONE'`；同时 stderr 不含 `fatal: could not read Username` 或 `remote: Permission denied` 之类 push noise。

**引用字段**:
- `harness_planner.result.verdict`（期望 `DONE`）

**验证命令**（**与 E2E 同源**：实现见 `sprints/w8-langgraph-v13/scripts/lib-checks.sh::check_step_2`，下方为该函数体的等价快照）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_2 "$INITIATIVE_TASK_ID"
# 内部行为：等待 planner 节点至多 5 分钟、断言 docker logs 含 verdict=DONE 且无 push fatal 关键字
```

**硬阈值**: planner 在 5 分钟内出 `verdict=DONE` 且 brain 日志无 push 错误关键字。

---

### Step 3: Layer 2 — Proposer/Reviewer GAN 收敛 APPROVED

**可观测行为**: brain.tasks 表里出现该 initiative 子树的 `harness_contract_propose` / `harness_contract_review` 任务，且最终 review 任务的 `result.verdict='APPROVED'` 且未触发 MAX_ROUNDS（`result.max_rounds_hit IS NOT TRUE`）。同时 propose 分支（`harness_contract_propose.result.propose_branch`）上有 `sprint-contract.md` + `task-plan.json` 两个文件。

**引用字段**:
- `harness_contract_review.result.verdict`（期望 `APPROVED` ≥ 1）
- `harness_contract_review.result.max_rounds_hit`（期望 false 或缺省）
- `harness_contract_propose.result.propose_branch`（取最新一条 completed 行的值，作为后续 git fetch 的分支）

**验证命令**（同源于 `lib-checks.sh::check_step_3`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_3 "$INITIATIVE_TASK_ID"
# 内部 SQL（仅文档化，实际由函数封装；时间窗口固定 60 分钟）：
#   SELECT count(*) FROM tasks
#     WHERE parent_task_id='$INITIATIVE_TASK_ID'
#       AND task_type='harness_contract_review'
#       AND status='completed'
#       AND result->>'verdict'='APPROVED'
#       AND created_at > NOW() - interval '60 minutes'
#   -- 期望 ≥ 1
#   SELECT count(*) FROM tasks
#     WHERE parent_task_id='$INITIATIVE_TASK_ID'
#       AND task_type='harness_contract_review'
#       AND coalesce((result->>'max_rounds_hit')::bool, false) = true
#   -- 期望 = 0
#   SELECT result->>'propose_branch' FROM tasks
#     WHERE parent_task_id='$INITIATIVE_TASK_ID'
#       AND task_type='harness_contract_propose'
#       AND status='completed'
#     ORDER BY created_at DESC LIMIT 1
#   -- 取出后 git fetch，断言 sprint-contract.md + task-plan.json 都存在
```

**硬阈值**: APPROVED 任务 ≥ 1，`max_rounds_hit=true` 数 = 0，propose 分支含 contract + plan 两个文件。

---

### Step 4: Layer 3 — spawn-and-interrupt 模式正确（#2851 验证点）

**可观测行为**: brain 在分发 sub_task 时为每个子任务注入 `tasks.payload.logical_task_id`；每个 generator 子任务的 `tasks.result.worktree_path` 与 `harness_initiative.result.worktree_path`（initiative 根 worktree）不相等。

**引用字段**:
- `<sub_task>.payload.logical_task_id`（期望非空）
- `harness_initiative.result.worktree_path`（initiative 根 worktree）
- `generator.result.worktree_path`（必须 ≠ initiative 根 worktree）

**验证命令**（同源于 `lib-checks.sh::check_step_4`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_4 "$INITIATIVE_TASK_ID"
# 内部行为：
#   - 子任务都带 payload.logical_task_id（缺失数 = 0）
#   - 没有任何 generator 子任务的 result.worktree_path 等于 initiative.result.worktree_path
```

**硬阈值**: 缺 `logical_task_id` 的子任务数 = 0，与 initiative 共享 worktree 的 generator 子任务数 = 0。

---

### Step 5: Generator 远端 agent stdout tee 非空（H7 验证点）

**可观测行为**: 至少一个 generator 类型子任务 `tasks.result.stdout` 字段长度 > 100 字节（说明 entrypoint.sh tee 生效且回调拿到内容）。

**引用字段**:
- `generator.result.stdout`（期望长度 > 100）
- `generator.result.exit_code`（仅供 evidence 记录，不参与判定）

**验证命令**（同源于 `lib-checks.sh::check_step_5`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_5 "$INITIATIVE_TASK_ID"
# 内部 SQL：
#   SELECT count(*) FROM tasks
#     WHERE parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID')
#       AND task_type='generator'
#       AND status IN ('completed','failed')
#       AND length(coalesce(result->>'stdout','')) > 100
#       AND created_at > NOW() - interval '60 minutes'
#   -- 期望 ≥ 1
```

**硬阈值**: stdout > 100 字节的 generator 子任务 ≥ 1。

---

### Step 6: Evaluator 在 Generator 的 task worktree 上运行（H8 验证点）

**可观测行为**: 同一 `payload.logical_task_id` 下，evaluator 子任务的 `result.evaluator_worktree_path` 必须等于姊妹 generator 子任务的 `result.worktree_path`。

**引用字段**:
- `evaluator.payload.logical_task_id`（用于 join）
- `evaluator.result.evaluator_worktree_path`
- `generator.result.worktree_path`

**验证命令**（同源于 `lib-checks.sh::check_step_6`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_6 "$INITIATIVE_TASK_ID"
# 内部 SQL（伪）：
#   WITH paired AS (
#     SELECT e.result->>'evaluator_worktree_path' AS eval_wt,
#            g.result->>'worktree_path'           AS gen_wt
#     FROM tasks e
#     JOIN tasks g
#       ON g.payload->>'logical_task_id' = e.payload->>'logical_task_id'
#      AND g.task_type='generator'
#     WHERE e.task_type='evaluator'
#       AND e.parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id='$INITIATIVE_TASK_ID')
#       AND e.created_at > NOW() - interval '60 minutes'
#   )
#   SELECT count(*) FROM paired WHERE eval_wt IS DISTINCT FROM gen_wt
#   -- 期望 = 0
```

**硬阈值**: worktree 不一致的 evaluator 数 = 0。

---

### Step 7: Absorption policy 真实触发（#2855 验证点）

**可观测行为**: 该 initiative 的 absorption 子任务 `result` 必须含 `applied` 布尔字段；若 `applied=true` 必含非空 `pr_url`；若 `applied=false` 必含非空 `reason`。绝不允许出现"假装 applied"的空字段路径。

**引用字段**:
- `absorption.result.applied`（期望 boolean）
- `absorption.result.pr_url`（applied=true 时必填）
- `absorption.result.reason`（applied=false 时必填）

**验证命令**（同源于 `lib-checks.sh::check_step_7`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_7 "$INITIATIVE_TASK_ID"
# 内部行为：
#   - 取最新 absorption 任务 result
#   - case applied:
#       true  → 断言 pr_url 非空非 null
#       false → 断言 reason 非空非 null
#       *     → exit 1
```

**硬阈值**: `applied` 是 boolean；true 时 `pr_url` 非空；false 时 `reason` 非空。

---

### Step 8: 终态 — initiative 任务 status=completed + evidence 落盘 + result.md 写裁决

**可观测行为**: brain.tasks 中 initiative 行 `status=completed`；`sprints/w8-langgraph-v13/evidence/` 含三件证据（`trace.txt`、`db-snapshot.json`、`pr-link.txt`）；`sprints/w8-langgraph-v13/result.md` 第一行明确写 `PASS` 或 `FAIL`，FAIL 时同时生成 `sprints/w8-langgraph-v13/h12-draft.md`。

**引用字段**:
- `harness_initiative.status`（期望 `completed`）
- `harness_initiative.result.merged`（仅供 evidence；与 absorption.applied 镜像）
- `langgraph_checkpoints.metadata.next_node`（期望 ∈ {`complete`, `end`, `__end__`}）

**验证命令**（同源于 `lib-checks.sh::check_step_8`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
check_step_8 "$INITIATIVE_TASK_ID" "sprints/w8-langgraph-v13"
# 内部行为：
#   - 断言 GET /api/brain/tasks/$INITIATIVE_TASK_ID 返回 status=completed
#   - 断言 sprints/w8-langgraph-v13/evidence/{trace.txt, db-snapshot.json, pr-link.txt} 三件齐且非空
#   - 断言 langgraph_checkpoints.metadata.next_node 终行 ∈ {complete, end, __end__}
#   - 断言 result.md 第一行匹配 ^(PASS|FAIL)
#   - FAIL 时断言 h12-draft.md 存在且非空
```

**硬阈值**: status=completed，evidence 三件齐且非空，checkpoint 终节点合法，result.md 有 PASS/FAIL 裁决，FAIL 时含 H12 草案。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: agent_remote

**同源约束**: 下方脚本 Step 2~8 段直接 `source` 上文各 Step 引用的 `lib-checks.sh`，调用同名 `check_step_N` 函数。Generator 实现的 `lib-checks.sh` 必须导出全部 8 个 `check_step_*` 函数；E2E 脚本里**不再内联 SQL/curl**，避免与 Step 命令粘贴漂移。CI 可对 lib hash 做单点比对而非逐步骤比对。

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/w8-langgraph-v13"
EVIDENCE_DIR="$SPRINT_DIR/evidence"
mkdir -p "$EVIDENCE_DIR"

# 同源加载：所有 Step 验证函数
# shellcheck source=sprints/w8-langgraph-v13/scripts/lib-checks.sh
source "$SPRINT_DIR/scripts/lib-checks.sh"

# === Step 1: 触发 ===
RESP=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d "{\"task_type\":\"harness_initiative\",\"payload\":{\"description\":\"W8 v13 真端到端验证最简 Initiative：往 docs/current/README.md 顶部追加一行 W8 v13 verification stamp $(date -u +%Y-%m-%d)\",\"tags\":[\"verification\",\"w8-v13\"]}}")
INITIATIVE_TASK_ID=$(echo "$RESP" | jq -r '.id // .task_id')
[[ "$INITIATIVE_TASK_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "Step1 FAIL: bad task id"; exit 1; }
echo "INITIATIVE_TASK_ID=$INITIATIVE_TASK_ID"

# === 等待 + 抽证据（WS1 collect-evidence.sh）===
bash "$SPRINT_DIR/scripts/collect-evidence.sh" "$INITIATIVE_TASK_ID" "$EVIDENCE_DIR" \
  || { echo "collect-evidence FAIL"; exit 1; }

# === Step 2~7：函数化、同源 ===
check_step_2 "$INITIATIVE_TASK_ID" || { echo "Step2 FAIL"; exit 1; }
check_step_3 "$INITIATIVE_TASK_ID" || { echo "Step3 FAIL"; exit 1; }
check_step_4 "$INITIATIVE_TASK_ID" || { echo "Step4 FAIL"; exit 1; }
check_step_5 "$INITIATIVE_TASK_ID" || { echo "Step5 FAIL"; exit 1; }
check_step_6 "$INITIATIVE_TASK_ID" || { echo "Step6 FAIL"; exit 1; }
check_step_7 "$INITIATIVE_TASK_ID" || { echo "Step7 FAIL"; exit 1; }

# === Step 8：判决 + 落 result.md（WS2 judge-result.sh 内部也 source 同一个 lib-checks）===
bash "$SPRINT_DIR/scripts/judge-result.sh" "$INITIATIVE_TASK_ID" "$EVIDENCE_DIR" "$SPRINT_DIR" \
  || { echo "judge-result FAIL"; exit 1; }

check_step_8 "$INITIATIVE_TASK_ID" "$SPRINT_DIR" || { echo "Step8 FAIL"; exit 1; }

echo "Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0；result.md 第一行为 `PASS`（FAIL 也被视为"验证机制本身工作正常"，但本 sprint 的 OKR 进度只有 PASS 时才算结清；FAIL 自动派生 H12+ initiative 由后继 sprint 接力）。

---

## Workstreams

workstream_count: 3

### Workstream 1: collect-evidence 脚本（M）

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/collect-evidence.sh`，签名 `collect-evidence.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR>`。
- 轮询 brain API，等待 initiative status ∈ {completed, failed} 或超时（默认 60min，可通过 `TIMEOUT_SEC` env 覆盖）
- 把 brain 容器最近 60 分钟内含 `<INITIATIVE_TASK_ID>` 的日志写入 `<EVIDENCE_DIR>/trace.txt`，并按 7 节点签名（plan/propose/review/spawn/generator/evaluator/absorption）抽出最少 1 行/节点
- 把 `tasks` + `langgraph_checkpoints` 中与 initiative 相关的行写入 `<EVIDENCE_DIR>/db-snapshot.json`
- 从 absorption 任务的 `result.applied/pr_url/reason`（见 [Field Contract](#field-contract)）抽 PR URL 或 NO_CHANGE 说明写入 `<EVIDENCE_DIR>/pr-link.txt`
- 支持 `DRY_RUN=1` 时只打印执行计划且 exit 0，不真实调 brain
- 不带参数时 exit 1 并输出 usage 到 stderr

**大小**: M（150~250 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts`

---

### Workstream 2: lib-checks 函数库 + judge-result 脚本（M）

**范围**:

(a) 实现 `sprints/w8-langgraph-v13/scripts/lib-checks.sh`，导出函数：
- `check_step_2 <TASK_ID>` … `check_step_8 <TASK_ID> [SPRINT_DIR]`
- 每个函数严格按 [Field Contract](#field-contract) 字段路径取值，含 60 分钟时间窗口
- 函数失败时 return 非 0；成功 return 0；不允许 echo "ok" 假绿
- 顶部注释里登记每个函数对应的 Step 号 + 引用的字段表

(b) 实现 `sprints/w8-langgraph-v13/scripts/judge-result.sh`，签名 `judge-result.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR> <SPRINT_DIR>`：
- 顶部 `source ./lib-checks.sh`（同源消费上面 (a) 的函数）
- 按 Step 2~7 顺序调用 `check_step_2..check_step_7`，全部通过 → 写 `result.md` 第一行 `PASS — W8 v13 端到端验证通过`，附通过的 7 个节点摘要
- 任一失败 → 写 `result.md` 第一行 `FAIL — 卡在 step_<N>`，并生成 `h12-draft.md`（含失败 step、破裂假设、修复方向草稿）
- 必含字段：`Initiative Task ID:`、`Verdict:`、`Failed Step:`（FAIL 时）、`PR/NO_CHANGE:`

**大小**: M（180~280 行 — lib-checks ~150 行 + judge-result ~80 行）
**依赖**: Workstream 1 完成（消费其 evidence 输出做证据落地参考；lib-checks 内不依赖 evidence 文件，只查 DB / API）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts`

---

## <a id="test-contract"></a>Test Contract

| Workstream | Test File | 断言 ID/it() name | BEHAVIOR 覆盖 | Fixture 路径 | 预期红证据 |
|---|---|---|---|---|---|
| WS1 | `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts` | `script file exists at expected path` | `sprints/w8-langgraph-v13/scripts/collect-evidence.sh` 存在 | 无（无需 fixture） | spawn 失败 / existsSync=false |
| WS1 | 同上 | `script is executable` | 文件 mode & 0o111 ≠ 0 | 无 | mode=0 |
| WS1 | 同上 | `exits non-zero with usage on stderr when called with no args` | 缺参时 exit≠0 且 stderr 含 `usage/Usage/USAGE` | 无 | 脚本不存在 spawn 失败 |
| WS1 | 同上 | `DRY_RUN=1 with valid args exits 0 and stdout names trace.txt + db-snapshot.json + pr-link.txt` | DRY_RUN=1 干跑输出含三件产出物名 | 无 | spawn 失败 |
| WS2 | `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts` | `script file exists and is executable` | judge-result.sh 存在且可执行 | 无 | existsSync=false |
| WS2 | 同上 | `exits non-zero with usage when called with no args` | 缺参时 exit≠0 且 stderr 含 usage | 无 | 脚本不存在 |
| WS2 | 同上 | `writes result.md starting with PASS when given pass-fixture evidence` | 喂 PASS fixture → result.md 第一行 `^PASS` | `sprints/w8-langgraph-v13/tests/ws2/fixtures/pass/{trace.txt, db-snapshot.json, pr-link.txt}` | 脚本不存在 / readFileSync ENOENT |
| WS2 | 同上 | `writes result.md starting with FAIL and generates h12-draft.md when given fail-fixture evidence` | 喂 FAIL fixture → result.md 第一行 `^FAIL` 且 `h12-draft.md` 非空 | `sprints/w8-langgraph-v13/tests/ws2/fixtures/fail/{trace.txt, db-snapshot.json, pr-link.txt}` | 脚本不存在 / 找不到 h12-draft.md |

**总计**: WS1 → 4 failures，WS2 → 4 failures，合计 8 个 BEHAVIOR 断言。

> **注**：上述断言名直接对应测试文件里 `it("...")` 的字面量字符串，CI 可 grep 校验"合同表里有的断言名一定能在 test 文件里 grep 到"。Fixture 路径已在 round-1 仓库里实际落盘（`tests/ws2/fixtures/{pass,fail}/` 下三件齐），WS2 实现只需读取消费。
