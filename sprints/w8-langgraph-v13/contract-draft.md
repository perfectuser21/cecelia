# Sprint Contract Draft (Round 3)

> Round 3 修订要点（基于 Round 2 Reviewer 反馈 R1/R3/R4/R5）：
> 1. **R1（cascade 红）**：E2E 验收脚本去掉 `set -e`，改为顺序调用 `check_step_2..check_step_7` 并把每个返回码收集到 `STEP_RESULTS[]`；judge-result.sh 在 `result.md` 列出**所有**红 step（不只是首红），并在 `h12-draft.md` 标注「首红 step」为修复入口。
> 2. **R3（Brain 重启 inconclusive）**：collect-evidence.sh 在 `trace.txt` 头写入 `# brain_boot_time=<ISO8601>`（启动时刻 + 收集时刻）；judge-result.sh 检测到 boot_time 跨越（采集前后不一致）后写 `INCONCLUSIVE — brain restarted mid-run`，**不**写 PASS/FAIL。
> 3. **R4（并发污染）**：所有 SQL 在原 `parent_task_id` 子树过滤之外，再加 `payload->'tags' ?| array['w8-v13']`（PG JSONB 数组成员判断）做硬隔离；E2E Step 1 把 `INITIATIVE_TASK_ID` 写入 `$EVIDENCE_DIR/initiative-task-id.txt`，下游所有 step 强制读这个文件而不是任何 env 变量裸值。
> 4. **R5（breaker OPEN 误绿）**：collect-evidence.sh 在抓 trace 时遇到 `breaker .* OPEN` / `cecelia-run circuit OPEN` / `credentials .* not found` 三类关键字之一，立即写 `$EVIDENCE_DIR/inconclusive.flag`（含命中关键字行号 + 行内容）并以 exit 0 返回（让 judge-result 处理裁决，不让后续 step 继续跑）。
> 5. **Verdict 三态化**：result.md 第一行从 PASS/FAIL 二态升级为 `PASS` / `FAIL` / `INCONCLUSIVE` 三态。INCONCLUSIVE 时**不**生成 H12 草案（因为根因可能在外部环境，不是 graph bug）；FAIL 时才生成 h12-draft.md。

## Golden Path

[创建 harness_initiative 任务] → [Layer 1 Planner SKILL] → [Layer 2 Proposer/Reviewer GAN] → [Layer 3 spawn-and-interrupt + Generator] → [Evaluator] → [Absorption] → [Complete] → [evidence 落盘 + result.md 写 PASS/FAIL/INCONCLUSIVE 裁决]

---

## <a id="field-contract"></a>Field Contract（DB 字段统一约定）

> **唯一事实来源**：本节定义本合同所有 Step 引用的 `tasks.result` / `tasks.payload` JSONB 字段路径。Step 2~8 与 E2E 脚本、`scripts/lib-checks.sh` 中函数实现，**必须只引用本节字段名**；任何新增字段先在此处登记后再用。

### 父任务字段

| 字段路径 | 类型 | 出处 task_type | 含义 |
|---|---|---|---|
| `tasks.result.sprint_dir` | text | `harness_initiative`（顶层 initiative） | initiative 落地的 sprint 目录（相对仓库根） |
| `tasks.result.worktree_path` | text | `harness_initiative` | initiative 自己的根 worktree 绝对路径（用于 Step 4 反例对比） |
| `tasks.payload.tags[*]` | text[] | `harness_initiative` | **必须含 `w8-v13`**——所有下游 SQL 的硬隔离标签（R4 mitigation） |

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

### Evidence 文件契约（R3/R4/R5 新增）

| 文件路径 | 必填字段 | 含义 |
|---|---|---|
| `<EVIDENCE_DIR>/initiative-task-id.txt` | 单行 UUID | Step 1 写入；下游 step 必须从这里读 ID（R4 隔离） |
| `<EVIDENCE_DIR>/trace.txt` 头部 | `# brain_boot_time_pre=<ISO8601>` 与 `# brain_boot_time_post=<ISO8601>` | collect-evidence.sh 抓 trace 前后各采一次 brain 容器 `started_at`；judge-result 检测 pre≠post → INCONCLUSIVE（R3） |
| `<EVIDENCE_DIR>/inconclusive.flag` | 命中关键字行（`breaker.*OPEN` / `cecelia-run circuit OPEN` / `credentials.*not found` 任一） | 文件存在 → judge-result 直接裁 INCONCLUSIVE；不存在=正常路径（R5） |
| `<EVIDENCE_DIR>/db-snapshot.json` | tasks 子树 + langgraph_checkpoints 行 | 标准证据，**所有 SELECT 必须含 `payload->'tags' ?| array['w8-v13']` 硬过滤**（R4） |
| `<EVIDENCE_DIR>/pr-link.txt` | PR URL 或 `NO_CHANGE: <reason>` | 镜像 absorption.applied/pr_url/reason |

### 全局 SQL 硬约束（R4 mitigation）

> 所有 lib-checks.sh 内 SQL **必须同时满足**：
> 1. `parent_task_id`（或子孙级 `IN (SELECT id FROM tasks WHERE parent_task_id=...)`）锁定到本 initiative 子树
> 2. `created_at > NOW() - interval '60 minutes'` 时间窗口
> 3. `payload->'tags' ?| array['w8-v13']` JSONB 数组成员过滤
>
> 三条同时满足 → 即使主开发账号同时跑了别的 verification 任务也不会污染本次裁决。

---

### Step 1: 触发 — POST /api/brain/tasks 创建一条最简 harness_initiative

**可观测行为**: Brain API 接受请求并返回新创建的 task 行（含 id、status=queued 或 in_progress、task_type=harness_initiative），且 payload.tags 含 `w8-v13` 与 `verification`。

**引用字段**: 无（此步只创建任务，不读字段）

**验证命令**:
```bash
RESP=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d '{"task_type":"harness_initiative","payload":{"description":"W8 v13 真端到端验证最简 Initiative：往 docs/current/README.md 顶部追加一行 W8 v13 verification stamp YYYY-MM-DD","tags":["verification","w8-v13"]}}')
INITIATIVE_TASK_ID=$(echo "$RESP" | jq -r '.id // .task_id')
echo "$INITIATIVE_TASK_ID" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 1
# R4 隔离：立即落盘到 evidence 目录，下游所有 step 从此文件读
mkdir -p "$EVIDENCE_DIR"
echo -n "$INITIATIVE_TASK_ID" > "$EVIDENCE_DIR/initiative-task-id.txt"
# 期望：返回的 id 是合法 UUID v4 格式 + 文件落盘成功
```

**硬阈值**: HTTP 200，response.id 是合法 UUID，且耗时 < 3s；`$EVIDENCE_DIR/initiative-task-id.txt` 写盘成功（单行 UUID）。

---

### Step 2: Layer 1 — harness-planner SKILL 跑通且无 push noise（H9 验证点）

**可观测行为**: Initiative 任务被分发后，brain 容器日志里出现 planner SKILL 调用并最终输出 `tasks.result.verdict='DONE'`；同时 stderr 不含 `fatal: could not read Username` 或 `remote: Permission denied` 之类 push noise。

**引用字段**:
- `harness_planner.result.verdict`（期望 `DONE`）
- 子树过滤：`parent_task_id = $INITIATIVE_TASK_ID`
- 时间窗口：`created_at > NOW() - interval '60 minutes'`
- 标签过滤（R4）：`payload->'tags' ?| array['w8-v13']`

**验证命令**（**与 E2E 同源**：实现见 `sprints/w8-langgraph-v13/scripts/lib-checks.sh::check_step_2`，下方为该函数体的等价快照）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_2 "$INITIATIVE_TASK_ID"
# 内部行为：等待 planner 节点至多 5 分钟、断言 docker logs 含 verdict=DONE 且无 push fatal 关键字
# 函数 return 非 0 时**不**直接 exit；调用方收集 $? 后继续跑下个 step
```

**硬阈值**: planner 在 5 分钟内出 `verdict=DONE` 且 brain 日志无 push 错误关键字。

---

### Step 3: Layer 2 — Proposer/Reviewer GAN 收敛 APPROVED

**可观测行为**: brain.tasks 表里出现该 initiative 子树的 `harness_contract_propose` / `harness_contract_review` 任务，且最终 review 任务的 `result.verdict='APPROVED'` 且未触发 MAX_ROUNDS（`result.max_rounds_hit IS NOT TRUE`）。同时 propose 分支（`harness_contract_propose.result.propose_branch`）上有 `sprint-contract.md` + `task-plan.json` 两个文件。

**引用字段**:
- `harness_contract_review.result.verdict`（期望 `APPROVED` ≥ 1）
- `harness_contract_review.result.max_rounds_hit`（期望 false 或缺省）
- `harness_contract_propose.result.propose_branch`（取最新一条 completed 行的值，作为后续 git fetch 的分支）
- 三联硬过滤：`parent_task_id` + `created_at > NOW() - interval '60 minutes'` + `payload->'tags' ?| array['w8-v13']`

**验证命令**（同源于 `lib-checks.sh::check_step_3`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_3 "$INITIATIVE_TASK_ID"
# 内部 SQL（仅文档化，实际由函数封装）：
#   SELECT count(*) FROM tasks
#     WHERE parent_task_id='$INITIATIVE_TASK_ID'
#       AND task_type='harness_contract_review'
#       AND status='completed'
#       AND result->>'verdict'='APPROVED'
#       AND created_at > NOW() - interval '60 minutes'
#       AND payload->'tags' ?| array['w8-v13']
#   -- 期望 ≥ 1
```

**硬阈值**: APPROVED 任务 ≥ 1，`max_rounds_hit=true` 数 = 0，propose 分支含 contract + plan 两个文件。

---

### Step 4: Layer 3 — spawn-and-interrupt 模式正确（#2851 验证点）

**可观测行为**: brain 在分发 sub_task 时为每个子任务注入 `tasks.payload.logical_task_id`；每个 generator 子任务的 `tasks.result.worktree_path` 与 `harness_initiative.result.worktree_path`（initiative 根 worktree）不相等。

**引用字段**:
- `<sub_task>.payload.logical_task_id`（期望非空）
- `harness_initiative.result.worktree_path`（initiative 根 worktree）
- `generator.result.worktree_path`（必须 ≠ initiative 根 worktree）
- 三联硬过滤同 Step 3。

**验证命令**（同源于 `lib-checks.sh::check_step_4`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_4 "$INITIATIVE_TASK_ID"
```

**硬阈值**: 缺 `logical_task_id` 的子任务数 = 0，与 initiative 共享 worktree 的 generator 子任务数 = 0。

---

### Step 5: Generator 远端 agent stdout tee 非空（H7 验证点）

**可观测行为**: 至少一个 generator 类型子任务 `tasks.result.stdout` 字段长度 > 100 字节（说明 entrypoint.sh tee 生效且回调拿到内容）。

**引用字段**:
- `generator.result.stdout`（期望长度 > 100）
- `generator.result.exit_code`（仅供 evidence 记录，不参与判定）
- 三联硬过滤同 Step 3（注意：generator 是孙级，过滤通过 `parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id=$INITIATIVE_TASK_ID AND payload->'tags' ?| array['w8-v13'])`）。

**验证命令**（同源于 `lib-checks.sh::check_step_5`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_5 "$INITIATIVE_TASK_ID"
```

**硬阈值**: stdout > 100 字节的 generator 子任务 ≥ 1。

---

### Step 6: Evaluator 在 Generator 的 task worktree 上运行（H8 验证点）

**可观测行为**: 同一 `payload.logical_task_id` 下，evaluator 子任务的 `result.evaluator_worktree_path` 必须等于姊妹 generator 子任务的 `result.worktree_path`。

**引用字段**:
- `evaluator.payload.logical_task_id`（用于 join）
- `evaluator.result.evaluator_worktree_path`
- `generator.result.worktree_path`
- 三联硬过滤同 Step 5。

**验证命令**（同源于 `lib-checks.sh::check_step_6`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_6 "$INITIATIVE_TASK_ID"
```

**硬阈值**: worktree 不一致的 evaluator 数 = 0。

---

### Step 7: Absorption policy 真实触发（#2855 验证点）

**可观测行为**: 该 initiative 的 absorption 子任务 `result` 必须含 `applied` 布尔字段；若 `applied=true` 必含非空 `pr_url`；若 `applied=false` 必含非空 `reason`。绝不允许出现"假装 applied"的空字段路径。

**引用字段**:
- `absorption.result.applied`（期望 boolean）
- `absorption.result.pr_url`（applied=true 时必填）
- `absorption.result.reason`（applied=false 时必填）
- 三联硬过滤同 Step 3。

**验证命令**（同源于 `lib-checks.sh::check_step_7`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_7 "$INITIATIVE_TASK_ID"
```

**硬阈值**: `applied` 是 boolean；true 时 `pr_url` 非空；false 时 `reason` 非空。

---

### Step 8: 终态 — initiative 任务 status=completed + evidence 落盘 + result.md 写裁决（含 INCONCLUSIVE）

**可观测行为**:
- brain.tasks 中 initiative 行 `status=completed`（INCONCLUSIVE 路径下不强制此条件——brain 重启可能让任务卡 in_progress）；
- `sprints/w8-langgraph-v13/evidence/` 含 evidence 五件（`initiative-task-id.txt`、`trace.txt`、`db-snapshot.json`、`pr-link.txt` 必有；`inconclusive.flag` 仅 R5 命中时存在）；
- `sprints/w8-langgraph-v13/result.md` 第一行明确写 `PASS` / `FAIL` / `INCONCLUSIVE` 三选一；
- FAIL 时同时生成 `sprints/w8-langgraph-v13/h12-draft.md`（含**全部**红 step 列表 + **首红 step** 标注为修复入口）；
- INCONCLUSIVE 时**不**生成 h12-draft.md（根因可能在外部环境）；
- PASS 时也**不**生成 h12-draft.md。

**引用字段**:
- `harness_initiative.status`（期望 `completed`，仅 PASS/FAIL 路径要求）
- `harness_initiative.result.merged`（仅供 evidence；与 absorption.applied 镜像）
- `langgraph_checkpoints.metadata.next_node`（期望 ∈ {`complete`, `end`, `__end__`}，仅 PASS 路径要求）
- 文件级断言：见 [Field Contract Evidence 文件契约](#field-contract) 节。

**验证命令**（同源于 `lib-checks.sh::check_step_8`）：
```bash
source sprints/w8-langgraph-v13/scripts/lib-checks.sh
INITIATIVE_TASK_ID=$(cat "$EVIDENCE_DIR/initiative-task-id.txt")
check_step_8 "$INITIATIVE_TASK_ID" "sprints/w8-langgraph-v13"
# 内部行为：
#   1. 若 $EVIDENCE_DIR/inconclusive.flag 存在 → 断言 result.md 第一行 ^INCONCLUSIVE
#   2. 否则若 trace.txt 头 brain_boot_time_pre ≠ brain_boot_time_post → 断言 result.md 第一行 ^INCONCLUSIVE
#   3. 否则 PASS 路径：断言 status=completed + checkpoint 终节点合法 + result.md ^PASS + 无 h12-draft.md
#   4. 否则 FAIL 路径：断言 result.md ^FAIL + h12-draft.md 非空且含「首红 step」标注
```

**硬阈值**: result.md 第一行匹配 `^(PASS|FAIL|INCONCLUSIVE)`；FAIL 时 h12-draft.md 含 `Failed Steps:` 列表与 `First Red Step:` 标注；INCONCLUSIVE 时 h12-draft.md 不存在；evidence 必有 4 件 + 可选 1 件。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: agent_remote

**同源约束**: 下方脚本 Step 2~8 段直接 `source` 上文各 Step 引用的 `lib-checks.sh`，调用同名 `check_step_N` 函数。Generator 实现的 `lib-checks.sh` 必须导出全部 7 个 `check_step_*` 函数；E2E 脚本里**不再内联 SQL/curl**，避免与 Step 命令粘贴漂移。CI 可对 lib hash 做单点比对而非逐步骤比对。

**Cascade 防护（R1）**: 顶部用 `set -uo pipefail`（**不带 e**）；用 `STEP_RESULTS[]` 数组收集每个 `check_step_*` 的返回码，全部跑完后再统一交给 `judge-result.sh` 裁决——任何单 step 红不再短路下游 step。

**完整验证脚本**:
```bash
#!/bin/bash
# R1: 不要 set -e — 避免 step 2 红后 cascade 把 step 3~7 全染红，无法定位首红
set -uo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
SPRINT_DIR="sprints/w8-langgraph-v13"
EVIDENCE_DIR="$SPRINT_DIR/evidence"
mkdir -p "$EVIDENCE_DIR"

# 同源加载：所有 Step 验证函数
# shellcheck source=sprints/w8-langgraph-v13/scripts/lib-checks.sh
source "$SPRINT_DIR/scripts/lib-checks.sh"

# === Step 1: 触发 + R4 ID 落盘隔离 ===
RESP=$(curl -fsS -X POST localhost:5221/api/brain/tasks \
  -H 'Content-Type: application/json' \
  -d "{\"task_type\":\"harness_initiative\",\"payload\":{\"description\":\"W8 v13 真端到端验证最简 Initiative：往 docs/current/README.md 顶部追加一行 W8 v13 verification stamp $(date -u +%Y-%m-%d)\",\"tags\":[\"verification\",\"w8-v13\"]}}")
INITIATIVE_TASK_ID=$(echo "$RESP" | jq -r '.id // .task_id')
[[ "$INITIATIVE_TASK_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "Step1 FAIL: bad task id" >&2; exit 1; }
echo -n "$INITIATIVE_TASK_ID" > "$EVIDENCE_DIR/initiative-task-id.txt"
echo "INITIATIVE_TASK_ID=$INITIATIVE_TASK_ID (written to evidence/initiative-task-id.txt)"

# === 等待 + 抽证据（WS1 collect-evidence.sh）===
# collect-evidence 内部会:
#   - 头部写 brain_boot_time_pre / _post（R3）
#   - 命中 breaker OPEN / credentials not found 时写 inconclusive.flag（R5）
#   - 出口仍以 exit 0 返回（让 judge-result 处理三态裁决）
bash "$SPRINT_DIR/scripts/collect-evidence.sh" "$INITIATIVE_TASK_ID" "$EVIDENCE_DIR"
COLLECT_RC=$?
echo "collect-evidence rc=$COLLECT_RC"

# === Step 2~7：函数化、同源、不短路（R1）===
declare -A STEP_RESULTS
for N in 2 3 4 5 6 7; do
  "check_step_$N" "$INITIATIVE_TASK_ID"
  STEP_RESULTS[$N]=$?
  echo "step_$N rc=${STEP_RESULTS[$N]}"
done

# === Step 8：判决 + 落 result.md（WS2 judge-result.sh 内部 source 同一个 lib-checks，自己再跑一遍）===
# judge-result 接管三态裁决：
#   - inconclusive.flag 存在 OR boot_time 跨越 → INCONCLUSIVE
#   - 全绿 → PASS
#   - 否则 FAIL（列出全部红 step + 标首红入口）
bash "$SPRINT_DIR/scripts/judge-result.sh" "$INITIATIVE_TASK_ID" "$EVIDENCE_DIR" "$SPRINT_DIR"
JUDGE_RC=$?
echo "judge-result rc=$JUDGE_RC"

# === Step 8 自检：result.md 第一行必须是三态之一 ===
check_step_8 "$INITIATIVE_TASK_ID" "$SPRINT_DIR"
STEP8_RC=$?
echo "step_8 rc=$STEP8_RC"

# 最终：只有 step_8 通过才算 E2E 收尾成功；step_8 内部已实现三态判决合规检查
exit $STEP8_RC
```

**通过标准**: 脚本 exit 0 且 result.md 第一行为 `PASS`。`FAIL` 也算"验证机制本身工作正常"（产出可定位的 H12 草案），但 OKR 进度只有 PASS 时算结清。`INCONCLUSIVE` 必须由人工/上层 sprint 复跑一次（不自动派生 H12，因为根因可能是 brain 重启 / 外部 credentials 问题）。

---

## Workstreams

workstream_count: 2

### Workstream 1: collect-evidence 脚本（M）

**范围**: 实现 `sprints/w8-langgraph-v13/scripts/collect-evidence.sh`，签名 `collect-evidence.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR>`。
- 轮询 brain API，等待 initiative status ∈ {completed, failed} 或超时（默认 60min，可通过 `TIMEOUT_SEC` env 覆盖）
- **trace.txt 头部（R3）**: 抓 trace 前调 `docker inspect <brain-container> --format '{{.State.StartedAt}}'` 得到 `brain_boot_time_pre`，抓完后再调一次得到 `brain_boot_time_post`；二者写入 `trace.txt` 头两行（`# brain_boot_time_pre=<ISO8601>` / `# brain_boot_time_post=<ISO8601>`）
- 把 brain 容器最近 60 分钟内含 `<INITIATIVE_TASK_ID>` 的日志写入 `<EVIDENCE_DIR>/trace.txt`，并按 7 节点签名（plan/propose/review/spawn/generator/evaluator/absorption）抽出最少 1 行/节点
- **breaker OPEN 检测（R5）**: 在 trace 抓取过程中如遇 `breaker.*OPEN` / `cecelia-run circuit OPEN` / `credentials.*not found` 三类正则任一命中，立即写 `<EVIDENCE_DIR>/inconclusive.flag`（含命中行号 + 行内容）；脚本仍 exit 0 让 judge-result 接管裁决
- **db-snapshot 标签过滤（R4）**: 把 `tasks` + `langgraph_checkpoints` 中**带 `payload->'tags' ?| array['w8-v13']` 过滤**与 initiative 子树相关的行写入 `<EVIDENCE_DIR>/db-snapshot.json`
- 从 absorption 任务的 `result.applied/pr_url/reason`（见 [Field Contract](#field-contract)）抽 PR URL 或 NO_CHANGE 说明写入 `<EVIDENCE_DIR>/pr-link.txt`
- 支持 `DRY_RUN=1` 时只打印执行计划且 exit 0（计划 stdout 须列出 `trace.txt`、`db-snapshot.json`、`pr-link.txt`、`brain_boot_time` 关键字、`breaker OPEN check` 关键字），不真实调 brain
- 不带参数时 exit 1 并输出 usage 到 stderr

**大小**: M（200~300 行；新增 R3/R4/R5 比 round-2 多 ~50 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts`

---

### Workstream 2: lib-checks 函数库 + judge-result 脚本（M）

**范围**:

(a) 实现 `sprints/w8-langgraph-v13/scripts/lib-checks.sh`，导出函数：
- `check_step_2 <TASK_ID>` … `check_step_8 <TASK_ID> [SPRINT_DIR]`
- 每个函数严格按 [Field Contract](#field-contract) 字段路径取值
- **三联硬过滤（R4）**: 函数内所有 SQL 必须同时含 `parent_task_id`、`interval '60 minutes'`、`payload->'tags' ?| array['w8-v13']`
- 函数失败时 `return` 非 0；成功 `return` 0；不允许 echo "ok" 假绿
- **不污染调用方（R1）**: 文件顶部用 `set -u`（不要 `-e`），让 source 它的 E2E 脚本可以收集 `$?` 而不被中断
- 顶部注释里登记每个函数对应的 Step 号 + 引用的字段表
- `check_step_8` 必须支持三态判决：检查 `$EVIDENCE_DIR/inconclusive.flag` / `trace.txt` 头 boot_time pre/post 不一致 → INCONCLUSIVE 路径合规校验

(b) 实现 `sprints/w8-langgraph-v13/scripts/judge-result.sh`，签名 `judge-result.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR> <SPRINT_DIR>`：
- 顶部 `source ./lib-checks.sh`（同源消费上面 (a) 的函数）
- **三态裁决树（R3 + R5）**:
  - 优先级 1：若 `<EVIDENCE_DIR>/inconclusive.flag` 存在 → 写 `result.md` 首行 `INCONCLUSIVE — <flag 第一行内容>`；不写 h12-draft.md；exit 0
  - 优先级 2：解析 `trace.txt` 头读 `brain_boot_time_pre` 与 `brain_boot_time_post`，二者不等 → 写 `INCONCLUSIVE — brain restarted mid-run`；不写 h12-draft.md；exit 0
  - 优先级 3：顺序调 `check_step_2..check_step_7`，**每个返回码都收集**（不短路）；全部 0 → 写 `result.md` 首行 `PASS — W8 v13 端到端验证通过`，附通过的 7 节点摘要；不写 h12-draft.md；exit 0
  - 优先级 4：任一非 0 → 写 `result.md` 首行 `FAIL — 卡在 step_<首红N>`，**列出全部红 step 列表**；同时生成 `h12-draft.md` 含 `Failed Steps: [N1, N2, ...]` 与 `First Red Step: <首红N>` 标注（H12 修复入口）；exit 1
- 必含字段：`Initiative Task ID:`、`Verdict:`、`Failed Steps:`（FAIL 时列表）、`First Red Step:`（FAIL 时单值）、`PR/NO_CHANGE:`

**大小**: M（250~350 行 — lib-checks ~200 行 + judge-result ~120 行；R3/R5 新增三态裁决树）
**依赖**: Workstream 1 完成（消费其 evidence 输出做证据落地参考；lib-checks 内不依赖 evidence 文件，只查 DB / API；judge-result 依赖 evidence 文件做三态判决）

**BEHAVIOR 覆盖测试文件**: `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts`

---

## <a id="test-contract"></a>Test Contract

| Workstream | Test File | 断言 ID/it() name | BEHAVIOR 覆盖 | Fixture 路径 | 预期红证据 |
|---|---|---|---|---|---|
| WS1 | `sprints/w8-langgraph-v13/tests/ws1/collect-evidence.test.ts` | `script file exists at expected path` | `sprints/w8-langgraph-v13/scripts/collect-evidence.sh` 存在 | 无 | spawn 失败 / existsSync=false |
| WS1 | 同上 | `script is executable` | 文件 mode & 0o111 ≠ 0 | 无 | mode=0 |
| WS1 | 同上 | `exits non-zero with usage on stderr when called with no args` | 缺参时 exit≠0 且 stderr/stdout 含 `usage/Usage/USAGE` | 无 | 脚本不存在 spawn 失败 |
| WS1 | 同上 | `DRY_RUN=1 with valid args exits 0 and stdout names trace.txt + db-snapshot.json + pr-link.txt` | DRY_RUN=1 干跑输出含三件产出物名 | 无 | spawn 失败 |
| WS1 | 同上 | `DRY_RUN=1 plan mentions brain_boot_time and breaker OPEN check (R3+R5)` | DRY_RUN stdout 含字符串 `brain_boot_time` 与 `breaker OPEN` | 无 | 脚本不存在 / 干跑不含关键字 |
| WS2 | `sprints/w8-langgraph-v13/tests/ws2/judge-result.test.ts` | `script file exists and is executable` | judge-result.sh 存在且可执行 | 无 | existsSync=false |
| WS2 | 同上 | `exits non-zero with usage when called with no args` | 缺参时 exit≠0 且 stderr 含 usage | 无 | 脚本不存在 |
| WS2 | 同上 | `writes result.md starting with PASS when given pass-fixture evidence` | 喂 PASS fixture → result.md 第一行 `^PASS` | `tests/ws2/fixtures/pass/{trace.txt, db-snapshot.json, pr-link.txt, initiative-task-id.txt}` | 脚本不存在 / readFileSync ENOENT |
| WS2 | 同上 | `writes result.md starting with FAIL with all-red-steps list and h12-draft.md marks first-red-step (R1)` | 喂 FAIL fixture → result.md 第一行 `^FAIL`，正文含 `Failed Steps:` 列表；`h12-draft.md` 含 `First Red Step:` 标注 | `tests/ws2/fixtures/fail/...` | 脚本不存在 / 找不到 First Red Step 标注 |
| WS2 | 同上 | `writes result.md starting with INCONCLUSIVE when inconclusive.flag exists (R5)` | 喂 inconclusive fixture（含 `inconclusive.flag`）→ result.md 第一行 `^INCONCLUSIVE`，**不**生成 h12-draft.md | `tests/ws2/fixtures/inconclusive/{trace.txt, db-snapshot.json, pr-link.txt, initiative-task-id.txt, inconclusive.flag}` | 脚本不存在 / 误生成 h12-draft.md |
| WS2 | 同上 | `writes result.md starting with INCONCLUSIVE when trace.txt boot_time crosses (R3)` | 喂 boot_time 跨越 fixture（trace.txt 头 pre≠post）→ result.md 第一行 `^INCONCLUSIVE`，**不**生成 h12-draft.md | `tests/ws2/fixtures/boot-cross/{trace.txt 含 pre/post 不一致, db-snapshot.json, pr-link.txt, initiative-task-id.txt}` | 脚本不存在 / 误判 PASS/FAIL |

**总计**: WS1 → 5 failures，WS2 → 6 failures，合计 11 个 BEHAVIOR 断言。

> **注**：上述断言名直接对应测试文件里 `it("...")` 的字面量字符串，CI 可 grep 校验"合同表里有的断言名一定能在 test 文件里 grep 到"。Fixture 在 round-3 仓库里需新增 `tests/ws2/fixtures/inconclusive/` 与 `tests/ws2/fixtures/boot-cross/` 两个目录（pass / fail 沿用 round-1 已落盘的，仅 pass/fail 各加一个 `initiative-task-id.txt`）。
