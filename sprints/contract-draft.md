# Sprint Contract Draft (Round 1)

**Sprint**: 实测各 harness 角色容器真实 RSS 峰值（跑到 evaluator 后即停）
**journey_type**: autonomous
**target_environment**: local_api
**journey_id**: cecelia-harness-pipeline（Line 唯一 = Harness Pipeline）

---

## 已知约束（来自回归测试）

- [executor-harness-initiative-default-fullgraph.test.js] → harness initiative 默认走 full graph（planner→…→evaluator），本 sprint 的 stop_after=evaluator 是显式截断，不得破坏默认 full graph 行为
- [harness-b40-exclude-tests-dir.test.js] → 产物/CI 扫描排除 tests/ 目录，新增 sprints/tests/ 测试不进 generator 净增统计
- [harness-detail.test.js / routes/harness.js] → harness 端点统一返回 `{...}` 或 `{error}`，UUID 校验失败返 400，资源不存在返 404；新增端点必须沿用此约定
- （RSS 采样/峰值聚合相关回归测试：暂无已知约束，本 sprint 为 [NEW_PATTERN] 首次引入）

---

## 接缝清单（碰真实世界的点 — 必须真目标验证，未真验标 logic-done-pending）

> 逻辑断言（环境无关）= CI/单测验绿即真 done；接缝断言（环境相关）= 必须在真目标验过才 done。

| # | 接缝（碰真实世界点） | 真目标验证方式 | 未真验时标记 |
|---|---|---|---|
| 1 | **真实 `docker stats` 读取角色容器 RSS**：对真实运行中的 `harness-{role}-*` 容器读常驻内存 | final-e2e 跑一次真实 measurement run（docker 可用），断言 report 4 角色 `peak_rss_mb > 0` 且采样源是真实容器 id（非进程 RSS 兜底） | docker-path 采样在无 docker 的 CI 里 → `logic-done-pending`；CI 只验得了 process-path 采样逻辑 |
| 2 | **stop-after-evaluator 真实截断 graph**：真实 `harness-initiative.graph` 执行到 evaluator 节点后终止，不进入 PR/回写节点 | final-e2e 真实 run 后断言：report `stopped_after=="evaluator"`、`roles` 恰 4 项无第 5 角色、本 run 无 PR 产出（dev_records 无新增） | 仅控制函数纯逻辑（给定节点序列返回截断点）在 CI 验绿 = 真 done；真实 graph 截断标 `logic-done-pending` 直到 final-e2e 跑过 |

**禁止写死环境假设值**：采样间隔从入参/常量推导并可被复查（不写不可解释的魔数）；`docker stats` 输出解析必须从 `--format '{{.MemUsage}}'` 显式取值，**禁止假设固定列位置**；`peak_rss_mb` 不得假设任何固定 MB 值（必须来自真实采样的 max）。

---

## Response Schema（推导来源: [NEW_PATTERN] — api_registry 不可达，按 PRD 字面 + routes/harness.js 既有约定 snake_case/`run_id`/`{error}`）

### Endpoint: POST /api/brain/harness/rss-measure

触发一次 RSS 测量 run（含 planner/proposer/generator/evaluator 四角色，evaluator 后即停），异步启动，返回 run 句柄。

**Success (HTTP 200)**:
```json
{"run_id": "5f0e...uuid", "status": "started"}
```
- `run_id` (string, uuid, 必填): 本次测量 run 的唯一 id。来源——[NEW_PATTERN]，对齐 routes/harness.js 既有 `run id` UUID 约定
- `status` (string 字面量, 必填): 恒为 `"started"`。来源——[NEW_PATTERN]

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```
- 400：非法请求体；500：内部错误。沿用 routes/harness.js `{error}` 约定

**禁用字段名**（generator 不得漂移到这些同义词）: `id`（顶层用 `run_id`）、`runId`（必须 snake_case）

---

### Endpoint: GET /api/brain/harness/rss-report/:run_id

读取某次测量 run 的 RSS 峰值报告。

**Success (HTTP 200)**:
```json
{
  "run_id": "5f0e...uuid",
  "run_ts": 1718900000000,
  "stopped_after": "evaluator",
  "roles": [
    {"role": "planner",   "peak_rss_mb": 312.5, "sample_count": 18, "status": "complete"},
    {"role": "proposer",  "peak_rss_mb": 287.1, "sample_count": 22, "status": "complete"},
    {"role": "generator", "peak_rss_mb": 540.8, "sample_count": 35, "status": "complete"},
    {"role": "evaluator", "peak_rss_mb": 410.2, "sample_count": 27, "status": "complete"}
  ]
}
```
- `run_id` (string, uuid, 必填): 与 path 参数一致
- `run_ts` (number, epoch ms, 必填): 本 run 的时间戳（>0）
- `stopped_after` (string 字面量, 必填): 恒为 `"evaluator"`（证明范围控制：evaluator 后即停）
- `roles` (array<object>, 必填, **length == 4**): 每项 ——
  - `role` (string, 必填): ∈ `{"planner","proposer","generator","evaluator"}`，4 项互不重复
  - `peak_rss_mb` (number, 必填): 真实 RSS 峰值（MB）；`status=="complete"` 时 **> 0**（绝不为 0/空，边界情况下至少取启动+退出两点）
  - `sample_count` (number, 必填): 该角色采样次数，**>= 1**
  - `status` (string, 必填): `"complete"` | `"incomplete"`（角色提前异常退出 → `"incomplete"`，已采峰值仍记录）

**Error**:
- 400 `{"error":"invalid run id: must be a UUID"}`（path 非 UUID）
- 404 `{"error":"report not found"}`（run_id 未知 / 报告不存在）

**禁用字段名**（generator 不得漂移到这些同义词）:
- `peak_rss_mb` 禁漂 → `rss_mb` / `peak` / `memory_mb` / `rss` / `memory`
- `sample_count` 禁漂 → `samples` / `count` / `n_samples`
- `role` 禁漂 → `phase` / `name` / `agent`
- `stopped_after` 禁漂 → `stop_at` / `stopped_at`

---

## Golden Path

[POST /rss-measure 触发测量 run] → [四角色依次执行 + 每角色全程采样 RSS 记峰值] → [evaluator 完成即停] → [GET /rss-report/:run_id 返回 4 角色峰值报告 + DB 持久化 + run 目录报告文件]

---

### Step 1: 触发一次 harness 测量 run
**来源**: `[FROM_PRD]` — Golden Path 步骤 1「启动一次 harness 测量 run（含 planner、proposer、generator、evaluator 四角色）」

**可观测行为**: POST `/api/brain/harness/rss-measure` 返回 200 + 一个新 `run_id`（uuid）+ `status="started"`；该 run_id 后续可用于查报告。

**验证命令**:
```bash
RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/rss-measure -H 'Content-Type: application/json' -d '{}') || { echo "FAIL: 端点未返回 200（404=路由未注册）"; exit 1; }
echo "$RESP" | jq -e '.status == "started"' || { echo "FAIL: status!=started"; exit 1; }
echo "$RESP" | jq -e '(.run_id|type=="string") and (.run_id|test("^[0-9a-f-]{36}$"))' || { echo "FAIL: run_id 非 uuid"; exit 1; }
echo "$RESP" | jq -e 'keys == ["run_id","status"]' || { echo "FAIL: 顶层 keys 不符（schema 漂移）"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200，返回合法 uuid run_id，响应 < 3s
**硬阈值验证命令**:
```bash
START=$(date +%s); curl -sf -X POST localhost:5221/api/brain/harness/rss-measure -d '{}' >/dev/null; END=$(date +%s); [ $((END-START)) -lt 3 ] || { echo "FAIL: 触发耗时 $((END-START))s ≥ 3s"; exit 1; }
```

---

### Step 2: 每角色全程采样 RSS 并记录峰值
**来源**: `[FROM_PRD]` — Golden Path 步骤 2「每个角色容器/进程运行期间，按固定间隔采样其 RSS，记录该角色峰值」

**可观测行为**: 测量 run 完成后，每个角色都有 `sample_count >= 1` 且 `peak_rss_mb > 0`（complete 时）。峰值 = 该角色全部采样的 max。采样器对真实进程/容器读真实 RSS（**禁止 mock**）。

**验证命令**（logic 层 — 采样器对真实子进程读真实 RSS，无 mock，env 无关）:
```bash
# 起一个真实短命子进程占住一块内存，用真实采样器读它的真实 RSS
node -e 'const a=[];for(let i=0;i<2e6;i++)a.push(i);setTimeout(()=>{},2500);console.error("CHILD_PID="+process.pid)' &
CPID=$!
OUT=$(node packages/brain/src/scripts/rss-sample-probe.mjs --pid "$CPID" --interval-ms 200 --max-ms 2000)
echo "$OUT" | jq -e '.peak_rss_mb > 0' || { echo "FAIL: 峰值未 > 0"; exit 1; }
echo "$OUT" | jq -e '.sample_count >= 2' || { echo "FAIL: 采样次数 < 2（固定间隔采样未生效）"; exit 1; }
echo OK
```

**硬阈值**: peak_rss_mb > 0；sample_count >= 2（2s / 200ms 间隔至少取到 2 点）
**接缝**: 真实 `docker stats` 读 `harness-{role}-*` 容器 RSS = 接缝 #1，由 final-e2e 真实 run 验证（见接缝清单）

---

### Step 3: evaluator 完成即停（范围控制）
**来源**: `[FROM_PRD]` — Golden Path 步骤 3「evaluator 角色执行完毕后 pipeline 即停——不进入后续节点、不开 PR、不做 generator↔evaluator 多轮」

**可观测行为**: 报告 `stopped_after=="evaluator"`；`roles` 恰 4 项，无第 5 角色（PR/回写/多轮节点未执行）；本 run 不产生 PR。

**验证命令**（logic 层 — 截断控制函数对节点序列返回正确截断点）:
```bash
node -e '
import("./packages/brain/src/harness-rss-measure.js").then(m => {
  const full = ["planner","proposer","generator","evaluator","openPr","writeback"];
  const r = m.computeStopBoundary(full, "evaluator");
  if (JSON.stringify(r) !== JSON.stringify(["planner","proposer","generator","evaluator"])) { console.error("FAIL: 截断点错", r); process.exit(1); }
  console.log("OK");
}).catch(e => { console.error("FAIL:", e.message); process.exit(1); });
'
```

**硬阈值**: 截断后角色集合 == ["planner","proposer","generator","evaluator"]，长度 4，不含 openPr/writeback
**接缝**: 真实 graph 执行到 evaluator 后真截断、本 run 无 PR 产出 = 接缝 #2，由 final-e2e 验证

---

### Step 4: 输出 4 角色 RSS 峰值报告
**来源**: `[FROM_PRD]` — Golden Path 步骤 4「产出一份报告，列出 4 个角色各自的真实 RSS 峰值（MB）+ 采样次数 + run 时间戳」

**可观测行为**: GET `/api/brain/harness/rss-report/:run_id` 返回 `{run_id, run_ts, stopped_after, roles[4]}`，schema 严格匹配；同时落地 run 目录报告文件 `sprints/rss-reports/<run_id>.json`（同内容）。

**验证命令**:
```bash
RID="$MEASURE_RUN_ID"  # 来自 Step 1 / final-e2e 触发
REP=$(curl -sf "localhost:5221/api/brain/harness/rss-report/$RID") || { echo "FAIL: 报告端点未 200"; exit 1; }
echo "$REP" | jq -e 'keys == ["roles","run_id","run_ts","stopped_after"]' || { echo "FAIL: 顶层 keys 漂移"; exit 1; }
echo "$REP" | jq -e '.stopped_after == "evaluator"' || { echo "FAIL: stopped_after!=evaluator"; exit 1; }
echo "$REP" | jq -e '(.roles|length)==4' || { echo "FAIL: 角色数 != 4"; exit 1; }
echo "$REP" | jq -e '([.roles[].role]|sort) == ["evaluator","generator","planner","proposer"]' || { echo "FAIL: 角色集合不符/重复"; exit 1; }
echo "$REP" | jq -e 'all(.roles[]; (.peak_rss_mb|type=="number") and (.sample_count|type=="number") and (.status=="complete" or .status=="incomplete"))' || { echo "FAIL: role 项 schema 不符"; exit 1; }
echo "$REP" | jq -e 'all(.roles[]; (.status!="complete") or (.peak_rss_mb>0))' || { echo "FAIL: complete 角色 peak 未 >0"; exit 1; }
echo "$REP" | jq -e 'all(.roles[]; .sample_count >= 1)' || { echo "FAIL: 有角色采样次数 < 1"; exit 1; }
# 报告文件同步落地
test -f "sprints/rss-reports/$RID.json" || { echo "FAIL: run 目录报告文件缺失"; exit 1; }
jq -e '(.roles|length)==4' "sprints/rss-reports/$RID.json" || { echo "FAIL: 报告文件 4 角色不符"; exit 1; }
echo OK
```

**硬阈值**: 顶层 keys=={roles,run_id,run_ts,stopped_after}；roles 长度 4；每 complete 角色 peak>0；report 文件存在且一致

---

### Step 5: DB 持久化（带时间窗防伪）
**来源**: `[AI_ADDED]` — 理由：防止 generator 用历史残留报告/记录冒充本轮产出（防造假）。`SELECT count(*)` 必须配 `created_at` 时间窗，且本 run 4 角色都落 DB 行才算真实产出。

**可观测行为**: 表 `harness_role_rss` 每 run 写 4 行（planner/proposer/generator/evaluator 各一），UNIQUE(run_id, role)，含 created_at；本轮记录在时间窗内。

**验证命令**:
```bash
RID="$MEASURE_RUN_ID"
C=$(psql "${DB_URL:-cecelia}" -t -c "SELECT count(*) FROM harness_role_rss WHERE run_id='$RID' AND created_at > NOW() - interval '10 minutes'" | tr -d ' ')
[ "$C" -eq 4 ] || { echo "FAIL: DB 本轮 RSS 行数=$C != 4（历史冒充或缺角色）"; exit 1; }
# complete 角色 peak_rss_mb 必须 > 0
Z=$(psql "${DB_URL:-cecelia}" -t -c "SELECT count(*) FROM harness_role_rss WHERE run_id='$RID' AND status='complete' AND peak_rss_mb <= 0" | tr -d ' ')
[ "$Z" -eq 0 ] || { echo "FAIL: 有 complete 角色 peak_rss_mb<=0"; exit 1; }
echo OK
```

**硬阈值**: 本 run 恰 4 行，10 分钟时间窗内，complete 角色 peak_rss_mb > 0

---

### Step 6: 边界 — 角色提前退出 → incomplete，峰值不为 0/空
**来源**: `[FROM_PRD]` — 边界情况「某角色进程提前异常退出 → 报告标记该角色 incomplete，已采到的峰值仍记录」「采样间隔内未取到样本 → 至少取启动与退出两点，峰值不得为 0/空」

**可观测行为**: 角色提前退出时该角色 `status="incomplete"` 但 `peak_rss_mb > 0`（至少启动+退出两点）；error path——非法 run_id 返 4xx + error 字段。

**验证命令**（error path + 边界逻辑）:
```bash
# error path：非 UUID → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/rss-report/not-a-uuid"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 run_id 未返 400 (got $CODE)"; exit 1; }
# 未知合法 UUID → 404 + error 字段
ERR=$(curl -s "localhost:5221/api/brain/harness/rss-report/00000000-0000-4000-8000-000000000000")
echo "$ERR" | jq -e '.error | type == "string"' || { echo "FAIL: 404 缺 error 字段"; exit 1; }
# incomplete 边界：采样器对一个秒级退出的进程仍给出两点峰值 > 0
node -e 'const a=[];for(let i=0;i<1e6;i++)a.push(i);console.error("PID="+process.pid);setTimeout(()=>process.exit(0),800)' &
SPID=$!
OUT=$(node packages/brain/src/scripts/rss-sample-probe.mjs --pid "$SPID" --interval-ms 300 --max-ms 3000)
echo "$OUT" | jq -e '.peak_rss_mb > 0 and (.sample_count >= 1)' || { echo "FAIL: 提前退出进程峰值为 0/空（违反两点规则）"; exit 1; }
echo OK
```

**硬阈值**: 非法 run_id→400；未知 run_id→404+error；提前退出角色 peak>0 且 sample_count>=1

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 模式 B final-e2e 由 evaluator 作为独立 task 执行。本脚本触发一次**真实** measurement run（真 docker 角色容器 + 真 docker stats RSS 采样 = 接缝 #1/#2 的真目标验证），断言报告真实、4 角色 peak>0、evaluator 后即停、无 PR 产出。

```bash
#!/bin/bash
set -e
DB_CONN="${DB_URL:-cecelia}"
START_EPOCH=$(date +%s)000  # 防伪：本轮 run_ts 必须晚于此（epoch ms）

# 1. 触发真实测量 run（真实起 4 角色容器，evaluator 后即停）
RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/rss-measure -H 'Content-Type: application/json' -d '{"real":true}')
RID=$(echo "$RESP" | jq -r '.run_id')
echo "$RESP" | jq -e '.status == "started" and (.run_id|test("^[0-9a-f-]{36}$"))' || { echo "FAIL: 触发响应不合法"; exit 1; }

# 2. 轮询报告就绪（真实 4 角色跑完，最多等 20 分钟）
MAX_WAIT=240   # 240 * 5s = 20min
REP='{}'
for i in $(seq 1 $MAX_WAIT); do
  REP=$(curl -sf "localhost:5221/api/brain/harness/rss-report/$RID" 2>/dev/null || echo '{}')
  if echo "$REP" | jq -e '(.roles|length)==4 and (all(.roles[]; .status=="complete" or .status=="incomplete"))' >/dev/null 2>&1; then break; fi
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: 20min 内报告未就绪 run=$RID"; exit 1; }
  sleep 5
done

# 3. 报告 schema + 4 角色真实峰值（接缝 #1：真实容器 RSS）
echo "$REP" | jq -e 'keys == ["roles","run_id","run_ts","stopped_after"]' || { echo "FAIL: 顶层 keys 漂移"; exit 1; }
echo "$REP" | jq -e '([.roles[].role]|sort) == ["evaluator","generator","planner","proposer"]' || { echo "FAIL: 角色集合不符"; exit 1; }
echo "$REP" | jq -e 'all(.roles[]; (.status!="complete") or (.peak_rss_mb > 0))' || { echo "FAIL: 有 complete 角色真实 RSS 峰值 <= 0（采样未读到真实容器）"; exit 1; }
echo "$REP" | jq -e 'all(.roles[]; .sample_count >= 1)' || { echo "FAIL: 有角色采样次数 < 1"; exit 1; }
echo "$REP" | jq -e ".run_ts >= $START_EPOCH" || { echo "FAIL: run_ts 早于脚本启动（历史报告冒充本轮）"; exit 1; }

# 4. evaluator 后即停（接缝 #2）：stopped_after + 无第 5 角色 + 无 PR 产出
echo "$REP" | jq -e '.stopped_after == "evaluator"' || { echo "FAIL: 未在 evaluator 后停"; exit 1; }
echo "$REP" | jq -e '(.roles|length)==4' || { echo "FAIL: 出现 evaluator 之后的节点记录"; exit 1; }
PRN=$(psql "$DB_CONN" -t -c "SELECT count(*) FROM dev_records WHERE created_at > NOW() - interval '25 minutes' AND (metadata->>'rss_measure_run_id')='$RID'" 2>/dev/null | tr -d ' ' || echo 0)
[ "${PRN:-0}" -eq 0 ] || { echo "FAIL: 本 measurement run 产生了 PR（违反 evaluator 后即停）"; exit 1; }

# 5. DB 持久化（时间窗防伪）：本 run 恰 4 行
C=$(psql "$DB_CONN" -t -c "SELECT count(*) FROM harness_role_rss WHERE run_id='$RID' AND created_at > NOW() - interval '25 minutes'" | tr -d ' ')
[ "$C" -eq 4 ] || { echo "FAIL: DB 本轮 RSS 行数=$C != 4"; exit 1; }

echo "✅ Golden Path 验证通过：4 角色真实 RSS 峰值已采集，evaluator 后即停 run=$RID"
```

**通过标准**: 脚本 exit 0
**领域 oracle**: 本 sprint = 内存实测 + DB 写入类 → DB 断言带 `created_at > NOW() - interval` 时间窗（防历史冒充）；峰值断言 `> 0`（防空/0 假绿）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| RSS 采样器（peak=max, count, 两点保底） | `tests/rss-sampler.test.ts` | Step 2 / Step 6 采样逻辑 | → import harness-rss-sampler.js 失败 / 断言失败 |
| 截断控制 + 报告聚合 schema | `tests/rss-report.test.ts` | Step 3 / Step 4 截断点 + report schema | → import harness-rss-measure.js 失败 / 断言失败 |
