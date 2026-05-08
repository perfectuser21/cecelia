# Sprint Contract Draft (Round 3)

> **表名/字段约定（SSOT）**
> - `checkpoints` — LangGraph PgCheckpointer 持久化表（按 `thread_id` 索引）
> - `brain_tasks` — Brain 任务表；`brain_tasks.id` **即** Initiative / sub-task 的 `task_id`（本合同所有 SQL 用 `WHERE id='<task_id>'`）
> - `dev_records` — 开发记录表（合同里所有「dev-records」描述指代该 SQL 真名）
> - 任务流转中 `task_id` 永远等同 `brain_tasks.id`（UUID）

## Golden Path

[入口: harness_initiative task 派发]
  → [Step 1: 14 节点 happy path 全程命中]
  → [Step 2: PgCheckpointer 真持久化 14 节点链路]
  → [Step 3: kill brain → 同 thread_id resume，从最近 checkpoint 续跑]
  → [出口: brain_tasks status ∈ {completed, failed} + dev_records ≥ 1 条]

---

### Step 1: 14 节点 happy path 全程命中（含 retry/terminal_fail 合法跳过）

**可观测行为**：派发一条最小 `harness_initiative` 任务后，LangGraph 图按拓扑顺序至少命中 12 个 happy path 节点（`prep, planner, parsePrd, ganLoop, inferTaskPlan, dbUpsert, pick_sub_task, run_sub_task, evaluate, advance, final_evaluate, report`），`retry` / `terminal_fail` 在最小 PRD 下未被命中即视为合法跳过。每节点在 `traversal-observer` 助手记录 ≥1 条 enter/exit 事件。

**验证命令**：
```bash
# 跑全图 acceptance traversal smoke（新增脚本，由 Generator 创建）
cd /workspace
TASK_ID=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID="harness-initiative-${TASK_ID}"
[ -n "$TASK_ID" ] && [ -n "$THREAD_ID" ] || { echo "FAIL: TASK_ID/THREAD_ID 未生成"; exit 1; }

node packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs \
  --task-id "$TASK_ID" --thread-id "$THREAD_ID" 2>&1 | tee /tmp/w8-traversal.log
[ -s /tmp/w8-traversal.log ] || { echo "FAIL: traversal smoke 无 stdout 输出"; exit 1; }

# 期望 stdout 含 VISITED_NODES 行，且 12 个 happy 节点都出现一次以上
HAPPY_HIT=$(grep -E "^VISITED_NODES:" /tmp/w8-traversal.log | head -1 \
  | grep -oE "(prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|final_evaluate|report)" \
  | sort -u | wc -l)
[ -n "$HAPPY_HIT" ] && [ "$HAPPY_HIT" -ge 12 ] || { echo "FAIL: only ${HAPPY_HIT:-0}/12 happy nodes hit"; exit 1; }
echo "OK: ${HAPPY_HIT}/12 happy nodes hit"

# 同时确认 retry / terminal_fail 在本 happy run 是合法"未命中"——脚本应输出 SKIPPED_NODES: retry,terminal_fail
grep -E "^SKIPPED_NODES:" /tmp/w8-traversal.log | grep -E "retry" | grep -E "terminal_fail" \
  || { echo "FAIL: retry/terminal_fail 未被显式标记为 SKIPPED"; exit 1; }
```

**硬阈值**：脚本 exit 0 + happy 节点访问数 ≥ 12（共 14 节点中 12 个 happy 必经，retry/terminal_fail 合法跳过）；脚本耗时 < 180s（最小 Initiative 端到端预算）。

---

### Step 2: PgCheckpointer 真持久化（无 MemorySaver fallback）

**可观测行为**：Step 1 跑完后，Pg `checkpoints` 表有以本次 `thread_id` 为键的多条记录，至少 12 条不同 `metadata->>'source'` / `checkpoint->>'channel_values.__node__'` 对应 happy path 12 节点；同时图源代码中 `MemorySaver` 引用已被 Stream 2 删除（除测试外）；`getPgCheckpointer` 自动注入路径在 hotfix #2846 后必经。

**验证命令**：
```bash
# 2.1 查 checkpoints 表，确认 14 节点链路（happy path 至少 12 节点 each ≥1 entry）
DB="${DB_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
THREAD_ID=$(grep -E "^THREAD_ID: " /tmp/w8-traversal.log | head -1 | awk '{print $2}')
[ -n "$THREAD_ID" ] || { echo "FAIL: THREAD_ID 未从 Step 1 日志解析到（防 cascade 假绿，立即 exit 1）"; exit 1; }

# 总 entry 数 ≥ 14（每节点至少 1）；时间窗口 10 分钟，防旧测试污染（R-B mitigation）
TOTAL=$(psql "$DB" -t -A -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID' AND created_at > NOW() - interval '10 minutes'")
[ -n "$TOTAL" ] && [ "$TOTAL" -ge 14 ] || { echo "FAIL: total checkpoints=${TOTAL:-empty} < 14"; exit 1; }

# 不同节点（按 metadata->'writes' 中出现的 node 名）≥ 12
DISTINCT_NODES=$(psql "$DB" -t -A -c "
  SELECT count(DISTINCT k) FROM checkpoints,
    jsonb_object_keys(coalesce(metadata->'writes', '{}'::jsonb)) AS k
  WHERE thread_id='$THREAD_ID'
    AND created_at > NOW() - interval '10 minutes'
    AND k IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert',
              'pick_sub_task','run_sub_task','evaluate','advance','final_evaluate','report')
")
[ -n "$DISTINCT_NODES" ] && [ "$DISTINCT_NODES" -ge 12 ] || { echo "FAIL: distinct happy nodes=${DISTINCT_NODES:-empty} < 12"; exit 1; }

# 2.2 源码中无 MemorySaver fallback（Stream 2 已删除 ganLoop fallback；只测试文件可保留）
grep -n "MemorySaver" packages/brain/src/workflows/harness-initiative.graph.js \
  && { echo "FAIL: harness-initiative.graph.js 仍引用 MemorySaver"; exit 1; }
echo "OK: source 无 MemorySaver"

# 2.3 hotfix #2846 路径生效——traversal smoke 输出 PG_CHECKPOINTER_INJECTED: true
grep -E "^PG_CHECKPOINTER_INJECTED: true$" /tmp/w8-traversal.log \
  || { echo "FAIL: PgCheckpointer auto-inject 未观测到（hotfix 路径未生效）"; exit 1; }
```

**硬阈值**：`checkpoints` 表 thread_id 行数 ≥ 14（10 分钟时间窗内）；distinct happy nodes ≥ 12；源码 grep `MemorySaver` 命中数 = 0；smoke 输出 `PG_CHECKPOINTER_INJECTED: true`。

---

### Step 3: kill-resume on 14-node graph（精准 hook 触发 + 60s 超时回退 + 幂等 + 续跑）

**可观测行为**：在 Step 1 跑到 `evaluate` 节点 **exit 事件触发的那一刻**（用 LangGraph node enter/exit hook 精准触发，而非 `sleep N` 时间猜测），`kill-resume-runner` 对 brain 子进程发 SIGKILL，并 stdout 输出一行 `KILL_TIMING: evaluate` 便于事后复盘。然后用同 `thread_id` 重新 invoke，图从最近 checkpoint 恢复继续执行到终态；resume 不重复执行已完成节点的副作用（`brain_tasks` 表无重复 sub_task 行、`dev_records` 表本 initiative 仅 1 条）。**60s 内未观测到 `evaluate` exit 事件视为 kill 时机失败**，runner 必须 stdout 输出一行 `KILL_TIMING_TIMEOUT` 并 exit 2，验证命令对该行进行**负断言**（不接受 timeout 路径假绿）。

**实现要求（写给 Generator）**：
- runner 必须**同时**订阅 LangGraph 的两个事件流：`streamMode: "updates"` 与 `streamMode: "values"`（防单一 streamMode 在 ganLoop 内部流式更新时无 evaluate exit 信号 → R-A mitigation）。在指定 `killAfterNode` 的 exit 事件回调里发 `process.kill(child.pid, 'SIGKILL')`。
- runner 必须设置 **60 秒超时计时器**：从 invoke 开始计时，60s 内未收到 `killAfterNode` 的 exit 事件 → stdout 输出一行 `KILL_TIMING_TIMEOUT` + 立即 exit 2；测试断言**不接受** timeout 路径（即 timeout 视为合同失败，不是合法旁路）。
- **禁止**用 `setTimeout(kill, N*1000)` 之类的时间近似（只有 timeout 兜底用 setTimeout 是允许的，且仅用于失败路径）——CI 抖动会让该方式假绿/假红。
- runner stdout 必须按以下格式打印事件标记，使 reviewer 可以复盘 kill 时机：
  - 收到 `evaluate` exit 事件后立即一行：`KILL_TIMING: evaluate`
  - resume 跑到终态后一行：`RESUME_OK`
  - 节点幂等检测通过一行：`NO_DUPLICATE_SIDE_EFFECT`
  - **失败路径**（60s 超时）：一行 `KILL_TIMING_TIMEOUT` + exit 2

**验证命令**：
```bash
# 3.1 跑 kill-resume smoke（新增脚本）
cd /workspace
TASK_ID=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID="harness-initiative-kr-${TASK_ID}"
[ -n "$TASK_ID" ] && [ -n "$THREAD_ID" ] || { echo "FAIL: TASK_ID/THREAD_ID 未生成"; exit 1; }

node packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs \
  --task-id "$TASK_ID" --thread-id "$THREAD_ID" \
  --kill-after-node evaluate 2>&1 | tee /tmp/w8-kill-resume.log
[ -s /tmp/w8-kill-resume.log ] || { echo "FAIL: kill-resume smoke 无 stdout 输出"; exit 1; }

# 3.2 R-A 负断言：必须**没有** KILL_TIMING_TIMEOUT 行（timeout 路径不接受为合法）
if grep -E "^KILL_TIMING_TIMEOUT$" /tmp/w8-kill-resume.log; then
  echo "FAIL: 命中 KILL_TIMING_TIMEOUT —— 60s 内未观测到 evaluate exit，runner 走超时回退路径，本合同视为失败（R-A mitigation 强约束）"; exit 1
fi

# 3.3 确认 kill 在 evaluate 节点 exit 事件触发（hook 精准触发，非 sleep 时间）
grep -E "^KILL_TIMING: evaluate$" /tmp/w8-kill-resume.log \
  || { echo "FAIL: smoke 未输出 KILL_TIMING: evaluate（runner 未走 hook 精准触发路径）"; exit 1; }

# 3.4 确认 RESUME_OK 标记
grep -E "^RESUME_OK$" /tmp/w8-kill-resume.log \
  || { echo "FAIL: smoke 未输出 RESUME_OK"; exit 1; }

# 3.5 确认幂等（无副作用重复）
grep -E "^NO_DUPLICATE_SIDE_EFFECT$" /tmp/w8-kill-resume.log \
  || { echo "FAIL: smoke 检测到副作用重复（节点幂等门破损）"; exit 1; }

# 3.6 DB 层复检：dev_records 表本 task_id 关联记录 = 1（R-D mitigation：用 task_id 唯一 UUID 隔离）
DB="${DB_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
DEVREC_COUNT=$(psql "$DB" -t -A -c "
  SELECT count(*) FROM dev_records
  WHERE task_id='$TASK_ID'
    AND created_at > NOW() - interval '10 minutes'
")
[ -n "$DEVREC_COUNT" ] && [ "$DEVREC_COUNT" -eq 1 ] || { echo "FAIL: dev_records 本 task_id 行数=${DEVREC_COUNT:-empty}，期望恰好 1（幂等）"; exit 1; }

# 3.7 brain_tasks 终态（brain_tasks.id 即 task_id）
TASK_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM brain_tasks WHERE id='$TASK_ID'")
[ -n "$TASK_STATUS" ] || { echo "FAIL: brain_tasks 查无此 task_id 记录"; exit 1; }
case "$TASK_STATUS" in
  completed|failed) echo "OK: task 终态=$TASK_STATUS" ;;
  *) echo "FAIL: task 仍在中间态: $TASK_STATUS"; exit 1 ;;
esac
```

**硬阈值**：smoke 输出 `KILL_TIMING: evaluate`（hook 精准触发证据） + `RESUME_OK` + `NO_DUPLICATE_SIDE_EFFECT`；**`KILL_TIMING_TIMEOUT` 不出现**（R-A mitigation 负断言）；`dev_records` 本 task_id 行数 = 1（恰好 1，证明幂等）；`brain_tasks.status ∈ {completed, failed}`（按 `id=$TASK_ID` 查询）。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous
**journey_type_reason**: 整个验证只触碰 packages/brain/ 内的 LangGraph harness 运行时持久化与节点遍历，无 UI、无 dev pipeline、无 agent 协议变更。

**完整验证脚本**（R-E mitigation：`set -e` + 每步关键变量 `[ -n "$VAR" ]` 显式校验，任一 Step 失败立即 exit 1，不进入下一 Step）：
```bash
#!/bin/bash
set -e
set -u  # R-E 强化：未定义变量直接报错，杜绝 cascade 假绿

cd /workspace
DB="${DB_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
[ -n "$DB" ] || { echo "FAIL: DB 连接串为空"; exit 1; }

# ==== 0a. 前置：docker compose 服务名校验（R-C mitigation —— 不可删）====
SERVICES=$(docker compose config --services 2>/dev/null || true)
echo "$SERVICES" | grep -qE "^brain$"    || { echo "FAIL: docker compose 缺 'brain' 服务（实际：$SERVICES）"; exit 1; }
echo "$SERVICES" | grep -qE "^postgres$" || { echo "FAIL: docker compose 缺 'postgres' 服务（实际：$SERVICES）"; exit 1; }

# ==== 0b. 前置：容器实际在跑 ====
docker compose ps brain | grep -qE "running|Up" \
  || { echo "FAIL: brain 容器未起，跑 docker compose up -d 后再试"; exit 1; }
docker compose ps postgres | grep -qE "running|Up" \
  || { echo "FAIL: postgres 容器未起"; exit 1; }

# ==== 1. Step 1 — 14 节点 traversal smoke ====
TASK_ID_T=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID_T="harness-initiative-${TASK_ID_T}"
[ -n "$TASK_ID_T" ] && [ -n "$THREAD_ID_T" ] || { echo "FAIL: Step1 TASK_ID/THREAD_ID 未生成（cascade 防护）"; exit 1; }

node packages/brain/scripts/smoke/harness-initiative-acceptance-traversal.mjs \
  --task-id "$TASK_ID_T" --thread-id "$THREAD_ID_T" 2>&1 | tee /tmp/w8-traversal.log
[ -s /tmp/w8-traversal.log ] || { echo "FAIL: Step1 traversal smoke 无 stdout"; exit 1; }

HAPPY_HIT=$(grep -E "^VISITED_NODES:" /tmp/w8-traversal.log | head -1 \
  | grep -oE "(prep|planner|parsePrd|ganLoop|inferTaskPlan|dbUpsert|pick_sub_task|run_sub_task|evaluate|advance|final_evaluate|report)" \
  | sort -u | wc -l)
[ -n "$HAPPY_HIT" ] && [ "$HAPPY_HIT" -ge 12 ] || { echo "FAIL: Step1 happy 节点 ${HAPPY_HIT:-0}/12（cascade 立即终止，不进 Step2）"; exit 1; }
grep -E "^PG_CHECKPOINTER_INJECTED: true$" /tmp/w8-traversal.log \
  || { echo "FAIL: PgCheckpointer 未自动注入"; exit 1; }

# ==== 2. Step 2 — Pg 持久化复检（R-B mitigation：thread_id 强随机 + 10 分钟时间窗）====
[ -n "$THREAD_ID_T" ] || { echo "FAIL: Step2 THREAD_ID_T 丢失（cascade）"; exit 1; }
TOTAL=$(psql "$DB" -t -A -c "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID_T' AND created_at > NOW() - interval '10 minutes'")
[ -n "$TOTAL" ] && [ "$TOTAL" -ge 14 ] || { echo "FAIL: Step2 checkpoints=${TOTAL:-empty} < 14"; exit 1; }

DISTINCT_NODES=$(psql "$DB" -t -A -c "
  SELECT count(DISTINCT k) FROM checkpoints,
    jsonb_object_keys(coalesce(metadata->'writes', '{}'::jsonb)) AS k
  WHERE thread_id='$THREAD_ID_T'
    AND created_at > NOW() - interval '10 minutes'
    AND k IN ('prep','planner','parsePrd','ganLoop','inferTaskPlan','dbUpsert',
              'pick_sub_task','run_sub_task','evaluate','advance','final_evaluate','report')
")
[ -n "$DISTINCT_NODES" ] && [ "$DISTINCT_NODES" -ge 12 ] || { echo "FAIL: Step2 distinct happy nodes=${DISTINCT_NODES:-empty} < 12"; exit 1; }

if grep -n "MemorySaver" packages/brain/src/workflows/harness-initiative.graph.js; then
  echo "FAIL: 源码仍引用 MemorySaver"; exit 1
fi

# ==== 3. Step 3 — kill-resume（hook 精准触发 + 60s 超时负断言）====
TASK_ID_K=$(node -e "console.log(require('crypto').randomUUID())")
THREAD_ID_K="harness-initiative-kr-${TASK_ID_K}"
[ -n "$TASK_ID_K" ] && [ -n "$THREAD_ID_K" ] || { echo "FAIL: Step3 TASK_ID/THREAD_ID 未生成（cascade）"; exit 1; }

node packages/brain/scripts/smoke/harness-initiative-kill-resume.mjs \
  --task-id "$TASK_ID_K" --thread-id "$THREAD_ID_K" \
  --kill-after-node evaluate 2>&1 | tee /tmp/w8-kill-resume.log
[ -s /tmp/w8-kill-resume.log ] || { echo "FAIL: Step3 kill-resume smoke 无 stdout"; exit 1; }

# R-A 负断言：60s 超时不接受
if grep -E "^KILL_TIMING_TIMEOUT$" /tmp/w8-kill-resume.log; then
  echo "FAIL: Step3 命中 KILL_TIMING_TIMEOUT（60s 内未观测到 evaluate exit，超时回退路径不算合法）"; exit 1
fi
grep -E "^KILL_TIMING: evaluate$" /tmp/w8-kill-resume.log || { echo "FAIL: Step3 KILL_TIMING: evaluate 缺失（hook 精准触发未生效）"; exit 1; }
grep -E "^RESUME_OK$" /tmp/w8-kill-resume.log || { echo "FAIL: Step3 RESUME_OK 缺失"; exit 1; }
grep -E "^NO_DUPLICATE_SIDE_EFFECT$" /tmp/w8-kill-resume.log || { echo "FAIL: Step3 副作用重复"; exit 1; }

# R-D mitigation：dev_records 用 task_id UUID 隔离
DEVREC=$(psql "$DB" -t -A -c "SELECT count(*) FROM dev_records WHERE task_id='$TASK_ID_K' AND created_at > NOW() - interval '10 minutes'")
[ -n "$DEVREC" ] && [ "$DEVREC" -eq 1 ] || { echo "FAIL: Step3 dev_records=${DEVREC:-empty} ≠ 1"; exit 1; }

TASK_STATUS=$(psql "$DB" -t -A -c "SELECT status FROM brain_tasks WHERE id='$TASK_ID_K'")
[ -n "$TASK_STATUS" ] || { echo "FAIL: Step3 brain_tasks 查无记录"; exit 1; }
case "$TASK_STATUS" in
  completed|failed) ;;
  *) echo "FAIL: Step3 task 仍在中间态: $TASK_STATUS"; exit 1 ;;
esac

echo "OK: W8 Acceptance v7 Golden Path 全程通过"
```

**通过标准**：脚本 exit 0；docker compose 服务名校验通过（brain + postgres）；Step1 happy 节点 ≥ 12，Step2 checkpoints 行数 ≥ 14、distinct happy nodes ≥ 12、源码 MemorySaver 引用 = 0，Step3 `KILL_TIMING: evaluate` + `RESUME_OK` + `NO_DUPLICATE_SIDE_EFFECT` + dev_records = 1 + brain_tasks 终态 + **`KILL_TIMING_TIMEOUT` 必须不出现**（R-A 负断言）。

---

## Risk Register（R-B / R-C / R-D 显式登记，未来维护者不可删 mitigation）

| Risk ID | 风险描述 | Mitigation 落地位置 | **维护约束** |
|---|---|---|---|
| **R-A** | kill 时机过早或 streamMode 单一造成假绿/假红：runner 依赖单一 `streamMode` 时 ganLoop 内部流式更新可能无 `evaluate` exit 信号 | WS3 实现要求：runner 同时订阅 `streamMode: "updates"` 与 `streamMode: "values"`；60s 超时回退 stdout 输出 `KILL_TIMING_TIMEOUT` + exit 2；E2E 脚本 Step 3.2 + 3.x **负断言** `KILL_TIMING_TIMEOUT` 不出现 | 不可降级为单一 streamMode；不可删除 60s timeout；不可改成"timeout 视为合法旁路" |
| **R-B** | `thread_id` 在 10 分钟时间窗内被旧测试污染（多次跑 Step 1 共用同 thread_id 时 SQL count 累计） | thread_id 用 `harness-initiative-${uuid}`（`crypto.randomUUID()` 强随机前缀，每次 run 独立）；Step 2 SQL 在 `WHERE thread_id=...` 之后追加 `AND created_at > NOW() - interval '10 minutes'` | 不可改为固定 thread_id；不可删除时间窗口 `interval '10 minutes'` 子句；新增 thread_id 类查询必须沿用同一时间窗约束 |
| **R-C** | docker compose 服务名在 prod / dev compose 文件间漂移（`brain` ↔ `cecelia-brain`，`postgres` ↔ `cecelia-postgres`）造成 E2E 脚本静默用错容器 | E2E 脚本 0a 段 `docker compose config --services` + `grep -qE "^brain$"` / `^postgres$` 校验段 | 不可删除 0a 校验段；服务名漂移时**必须先改 compose 文件回标准名**而非改本合同 |
| **R-D** | `dev_records` 写入由其他并发任务污染计数（Step 3 跑时其他 brain task 同时写 dev_records） | Step 3 SQL 用 `WHERE task_id='$TASK_ID_K'`，`TASK_ID_K` 是本 run 唯一 `crypto.randomUUID()`，其他任务不可能命中同一 UUID | 不可去掉 `WHERE task_id='$TASK_ID_K'` 过滤；不可改用更宽松条件（如 `WHERE created_at > ...` 单独使用） |
| **R-E** | Step 1 失败后 Step 2/3 因 `THREAD_ID` / `TASK_ID` 未定义而走默认值/空字符串路径 → 整链假绿 | E2E 脚本 `set -e` + `set -u` + 每个关键变量 `[ -n "$VAR" ]` 显式校验，任一 Step 失败立即 `exit 1` 不进入下一 Step | 不可删除 `set -e` / `set -u`；不可去掉 `[ -n "$VAR" ]` 校验；新增中间变量必须沿用同一非空校验模式 |

---

## Workstreams

workstream_count: 3

### Workstream 1: 14 节点 traversal observer + happy path 验收测试

**范围**：新增 traversal observer 助手模块（包装 `harness-initiative.graph.invoke` 注册 enter/exit 事件 hook，输出 VISITED_NODES / SKIPPED_NODES / PG_CHECKPOINTER_INJECTED / THREAD_ID 行）+ smoke 脚本 + Vitest 验收测试，覆盖最小 Initiative 12 happy 节点全程命中、retry/terminal_fail 合法跳过。
**大小**：M（150–250 行：observer + smoke 脚本 + 测试）
**依赖**：无
**BEHAVIOR 覆盖测试文件**：`tests/ws1/acceptance-traversal.test.js`

---

### Workstream 2: PgCheckpointer 持久化验证 + 无 MemorySaver 静态守门

**范围**：新增 checkpoint inspector 助手模块（按 thread_id 查 `checkpoints` 表 + 解析 `metadata->'writes'` 拿到节点名集合，参数化查询防注入）+ Vitest 验收测试，跑完 Step 1 后断言 ≥14 行、≥12 distinct happy nodes、`PG_CHECKPOINTER_INJECTED: true`、源码 grep `MemorySaver` 为空。
**大小**：S（80–150 行：inspector + 测试，复用 WS1 smoke 输出）
**依赖**：Workstream 1 完成后（依赖 traversal smoke 产物 thread_id）
**BEHAVIOR 覆盖测试文件**：`tests/ws2/acceptance-pg-persistence.test.js`

---

### Workstream 3: kill-resume on 14-node graph 验收（hook 精准触发 + 60s timeout 兜底）

**范围**：新增 kill-resume runner 助手模块（spawn brain 子进程跑图 → **同时**订阅 LangGraph node enter/exit 事件流的 `streamMode: "updates"` 与 `streamMode: "values"` → 在 `killAfterNode` 的 exit 回调发 SIGKILL（**禁止 sleep N 时间近似**） → stdout 打印 `KILL_TIMING: <node>` → 同 thread_id 重新 invoke 续跑；**60s 内未观测到 killAfterNode exit 事件则 stdout 输出 `KILL_TIMING_TIMEOUT` 并 exit 2**；未知节点名抛 `UnknownNodeError`）+ smoke 脚本 + Vitest 验收测试，断言 KILL_TIMING + RESUME_OK + 节点幂等（无副作用重复）+ dev_records 仅 1 条 + brain_tasks 终态可达 + timeout 路径合约（`timedOut === true` 但**不视为 happy path 通过**）。
**大小**：M（200–320 行：runner + smoke + 测试，新增 hook 双 streamMode 订阅 + timeout 计时器）
**依赖**：Workstream 1 完成后（共享 observer 与 smoke 基础设施）
**BEHAVIOR 覆盖测试文件**：`tests/ws3/acceptance-kill-resume.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（具体 it 名 + 报错） |
|---|---|---|---|
| WS1 | `tests/ws1/acceptance-traversal.test.js` | 12 happy 节点全程命中 + retry/terminal_fail 合法跳过 + PgCheckpointer 自动注入观测 | `it('runWithTraversalObserver 跑完最小 Initiative 后，事件流含 12 个 happy path 节点 enter+exit 事件', ...)` 报 `Cannot find module '../../../../packages/brain/src/workflows/acceptance/traversal-observer.js'`；同文件 4 条 it 全部因 import 失败抛 ERR_MODULE_NOT_FOUND → vitest exit 1 |
| WS2 | `tests/ws2/acceptance-pg-persistence.test.js` | checkpoints 表 ≥14 行 + ≥12 distinct happy node 写入 + 源码无 MemorySaver | `it('listCheckpointsByThread 在跑完 traversal smoke 后返回 ≥14 行（10 分钟时间窗内）', ...)` 报 `Cannot find module '../../../../packages/brain/src/workflows/acceptance/checkpoint-inspector.js'`；同文件 4 条 it 全部因 import 失败抛 ERR_MODULE_NOT_FOUND → vitest exit 1 |
| WS3 | `tests/ws3/acceptance-kill-resume.test.js` | kill 中段（hook 精准触发，非 sleep）→ resume 续跑到终态 + 节点幂等（dev_records=1）+ brain_tasks 终态 + **60s timeout 不被视为合法旁路** | `it("在 'evaluate' 节点完成后中断子进程，再用同 threadId resume，最终 task 状态 ∈ {completed, failed}", ...)` 报 `Cannot find module '../../../../packages/brain/src/workflows/acceptance/kill-resume-runner.js'`；同文件 6 条 it 全部因 import 失败抛 ERR_MODULE_NOT_FOUND → vitest exit 1 |

---

## Round 3 修订日志（响应 Reviewer 反馈 R-A ~ R-E）

- **R-A / kill 时机过早 + streamMode 单一漏信号**：Step 3 实现要求新增"runner 同时订阅 `streamMode: "updates"` 与 `streamMode: "values"`"；新增"60s 内未观测到 killAfterNode exit → stdout 输出 `KILL_TIMING_TIMEOUT` + exit 2"约束；E2E 脚本 Step 3.2 + Risk Register R-A **负断言** `KILL_TIMING_TIMEOUT` 不出现；WS3 范围与 contract-dod-ws3.md 同步加 BEHAVIOR/ARTIFACT；新增 `tests/ws3/` 一条 timeout BEHAVIOR 测试 it。
- **R-B / thread_id 旧测试污染**：登记为 Risk Register R-B；保留 `harness-initiative-${uuid}` 强随机前缀（已在 R2 落地）；保留 SQL `created_at > NOW() - interval '10 minutes'` 时间窗；维护约束写明"不可删除时间窗子句"。
- **R-C / docker compose 服务名漂移**：登记为 Risk Register R-C；E2E 脚本 0a 段服务名校验保留；维护约束写明"服务名漂移时先改 compose，不可改合同"。
- **R-D / dev_records 并发污染**：登记为 Risk Register R-D；保留 `WHERE task_id='$TASK_ID_K'` UUID 隔离（已在 R2 落地）；维护约束写明"不可去掉 task_id 过滤"。
- **R-E / cascade 假绿**：E2E 脚本头部新增 `set -u`（与 `set -e` 联合杜绝未定义变量）；每个关键中间变量（TASK_ID_T / THREAD_ID_T / HAPPY_HIT / TOTAL / DISTINCT_NODES / TASK_ID_K / DEVREC / TASK_STATUS）后均追加 `[ -n "$VAR" ]` 显式非空校验；任一 Step 失败立即 `exit 1`；登记为 Risk Register R-E。
