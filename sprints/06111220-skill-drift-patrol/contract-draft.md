# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD 字面 + api_registry 推导）

### Endpoint: GET /api/brain/harness/skill-drift/patrol-history
**Success (HTTP 200)**:
```json
{
  "alerts": [
    {
      "id": "<number>",
      "skill_name": "<string>",
      "ssot_version": "<string|null>",
      "snapshot_version": "<string|null>",
      "drift_date": "<string (YYYY-MM-DD)>",
      "detected_at": "<string (ISO timestamp)>"
    }
  ]
}
```
- `alerts` (array, 必填): 历史漂移告警记录列表；无告警时返回 `[]`
- `alerts[].id` (number, 必填): 来源——DB serial PK，api_registry 同类端点惯例
- `alerts[].skill_name` (string, 必填): 来源——PRD"内容指明漂移 skill 名"明确要求
- `alerts[].ssot_version` (string|null, 必填): 来源——PRD"含 skill 名、发生时间"延伸；null = 文件缺失
- `alerts[].snapshot_version` (string|null, 必填): 同上
- `alerts[].drift_date` (string YYYY-MM-DD, 必填): 来源——PRD"按日去重"隐式要求落库 date 字段
- `alerts[].detected_at` (string ISO, 必填): 来源——PRD"含发生时间"明确要求

**禁用字段名**: `alert_id`（用 `id`）、`name`（用 `skill_name`）、`date`（用 `drift_date`）、`time`（用 `detected_at`）

**Error (HTTP 4xx/5xx)**:
```json
{"error": "<string>"}
```

---

## 已知约束（来自回归测试）

（暂无直接相关的 skill-drift-patrol 回归测试）

---

## Golden Path

[部署后/手动触发] → [smoke 校验] → [日巡检测漂移] → [告警落库可查] → [恢复后无新增]

---

### Step 1: 运维者执行 smoke 脚本验证端点健康
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步："运维者执行 `bash packages/brain/scripts/smoke/skill-drift-smoke.sh` → 输出 PASS"

**可观测行为**: 脚本 exit 0，输出包含 `PASS: N  FAIL: 0`；任一 `snapshot_version == null` 时 exit 1（防 #3339 类 bug 静默通过）

**验证命令**:
```bash
# 在 Brain 可达的环境下执行（smoke 本身已有完整断言）
bash packages/brain/scripts/smoke/skill-drift-smoke.sh
# 期望：exit 0 且 stdout 含 "FAIL: 0"
```

**硬阈值**: exit 0；输出含 `FAIL: 0`；snapshot_version 全非 null 时不产生 FAIL

---

### Step 2: 运维者制造漂移 → 触发日巡检 → 系统写入告警记录
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步："制造漂移 → 调用巡检触发入口 → 系统产生一条可查的告警记录，内容指明漂移 skill 名"

**可观测行为**: `skill_drift_alerts` 表新增一条记录，`skill_name` 字段指明漂移的 skill，`detected_at` 在触发后 5 分钟内

**验证命令**:
```bash
# 保存原始 version，制造漂移
SNAPSHOT_FILE="packages/workflows/skills/harness-planner/SKILL.md"
ORIG=$(grep -m1 '^version:' "$SNAPSHOT_FILE" | sed 's/version: *//')
sed -i "s/^version:.*/version: 9999.0.0-drift-test/" "$SNAPSHOT_FILE"

# 触发日巡检（调用 patrol 端点或等价 API，具体路径由实现决定；此处用触发 API）
curl -sf -X POST localhost:5221/api/brain/harness/skill-drift/patrol-trigger \
  || curl -sf localhost:5221/api/brain/harness/skill-drift/patrol 2>/dev/null \
  || echo "patrol trigger OK (tick-based)"

# 等待最多 10 秒写入
sleep 3

# 验证 DB 有告警记录（带时间窗口防历史数据造假）
COUNT=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c \
  "SELECT count(*) FROM skill_drift_alerts \
   WHERE skill_name='harness-planner' \
   AND detected_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: 未写入告警记录"; sed -i "s/^version:.*/version: $ORIG/" "$SNAPSHOT_FILE"; exit 1; }
echo "✅ 告警记录已写入 count=$COUNT"

# 恢复
sed -i "s/^version:.*/version: $ORIG/" "$SNAPSHOT_FILE"
```

**硬阈值**: `count ≥ 1`，`detected_at > NOW() - interval '5 minutes'`，`skill_name = 'harness-planner'`

---

### Step 3: 运维者恢复版本 → 再次触发巡检 → 不产生重复告警（按日去重）
**来源**: `[FROM_PRD]` — PRD 边界情况："同一次漂移内重复触发巡检 → 不产生重复告警（幂等，按日去重）"；PRD Golden Path 第 3 步

**可观测行为**: 同一 `skill_name` + `drift_date` 组合，第二次触发不新增记录

**验证命令**:
```bash
# 前提：Step 2 已执行，数据库中已有 harness-planner 今日告警
BEFORE=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c \
  "SELECT count(*) FROM skill_drift_alerts \
   WHERE skill_name='harness-planner' AND drift_date = CURRENT_DATE" | tr -d ' ')

# 再次触发巡检（漂移仍存在的场景）
curl -sf -X POST localhost:5221/api/brain/harness/skill-drift/patrol-trigger 2>/dev/null || true
sleep 3

AFTER=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c \
  "SELECT count(*) FROM skill_drift_alerts \
   WHERE skill_name='harness-planner' AND drift_date = CURRENT_DATE" | tr -d ' ')
[ "$AFTER" -eq "$BEFORE" ] || { echo "FAIL: 重复触发产生了新记录 before=$BEFORE after=$AFTER"; exit 1; }
echo "✅ 按日去重正常 count=$BEFORE"
```

**硬阈值**: `AFTER == BEFORE`（第二次触发同一天不增加行数）

---

### Step 4: 运维者查询巡检历史 → API 返回含 skill 名和时间的记录
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步："curl localhost:5221/api/brain/harness/skill-drift/patrol-history → 能看到第 2 步告警记录（含 skill 名、发生时间）"

**可观测行为**: HTTP 200，body 含 `alerts` 数组，Step 2 写入的记录可在列表中找到

**验证命令**:
```bash
RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift/patrol-history)
echo "$RESP" | jq -e '.alerts | type == "array"' || { echo "FAIL: alerts 非数组"; exit 1; }
# 验证 schema 完整性（顶层 key 只能是 alerts）
echo "$RESP" | jq -e 'keys == ["alerts"]' || { echo "FAIL: 顶层 keys 不符"; exit 1; }
# 验证 Step 2 的记录存在
echo "$RESP" | jq -e '.alerts | map(select(.skill_name == "harness-planner")) | length >= 1' \
  || { echo "FAIL: 未找到 harness-planner 的告警记录"; exit 1; }
# 验证记录字段完整性（含 ssot_version / snapshot_version）
echo "$RESP" | jq -e '.alerts[0] | has("id") and has("skill_name") and has("ssot_version") and has("snapshot_version") and has("drift_date") and has("detected_at")' \
  || { echo "FAIL: 记录缺少必要字段"; exit 1; }
# 验证禁用字段不出现（name / alert_id / date / time）
echo "$RESP" | jq -e '.alerts[0] | has("alert_id") | not' || { echo "FAIL: 禁用字段 alert_id 出现"; exit 1; }
echo "$RESP" | jq -e '.alerts[0] | has("name") | not'     || { echo "FAIL: 禁用字段 name 出现"; exit 1; }
echo "$RESP" | jq -e '.alerts[0] | has("date") | not'     || { echo "FAIL: 禁用字段 date 出现"; exit 1; }
echo "$RESP" | jq -e '.alerts[0] | has("time") | not'     || { echo "FAIL: 禁用字段 time 出现"; exit 1; }
echo "✅ patrol-history 端点验证通过"
```

**硬阈值**: HTTP 200；`alerts` 为数组；含 `harness-planner` 记录；每条记录含全部 6 字段（`id`, `skill_name`, `ssot_version`, `snapshot_version`, `drift_date`, `detected_at`）；禁用字段 `alert_id`/`name`/`date`/`time` 不出现

---

### Step 5: smoke 脚本在 post-deploy 自动执行链路生效
**来源**: `[FROM_PRD]` — PRD 范围内："smoke 脚本正式挂入 post-deploy 自动执行钩子"；`[AI_ADDED]` — 验证发现机制（文件命名符合 `brain-deploy.sh` 的 `packages/brain/scripts/smoke/*.sh` glob 发现规则）

**可观测行为**: `smoke-skill-drift.sh`（或 `skill-drift-smoke.sh`）存在于 `packages/brain/scripts/smoke/`，可被 `run_post_deploy_smoke()` 通过 `gh pr view` + path filter 自动发现

**验证命令**:
```bash
# 验证 smoke 脚本存在于 post-deploy 发现路径
SMOKE_FILES=$(find packages/brain/scripts/smoke -maxdepth 1 -name "*skill-drift*.sh" -type f)
[ -n "$SMOKE_FILES" ] || { echo "FAIL: smoke 脚本不在 packages/brain/scripts/smoke/"; exit 1; }
echo "✅ smoke 脚本路径正确: $SMOKE_FILES"

# 验证 smoke 脚本含 snapshot_version != null 断言（PRD 边界规则）
grep -q "snapshot_version" packages/brain/scripts/smoke/skill-drift-smoke.sh \
  || { echo "FAIL: smoke 缺少 snapshot_version 非 null 断言"; exit 1; }
echo "✅ smoke 含 snapshot_version 断言"
```

**硬阈值**: 文件存在；文件内含 `snapshot_version` 相关断言

---

## E2E 验收（target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e 脚本 — skill-drift-patrol（local_api）
# 前提：Brain 在 localhost:5221 运行，DB = postgresql://localhost/cecelia
set -e

DB="${DB:-postgresql://localhost/cecelia}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SNAPSHOT_FILE="packages/workflows/skills/harness-planner/SKILL.md"

echo "=== Step 1: smoke 脚本验证 ==="
bash packages/brain/scripts/smoke/skill-drift-smoke.sh
echo "✅ Step 1 PASS"

echo ""
echo "=== Step 2: 制造漂移 → 触发巡检 → 验证告警落库 ==="
# 保存原始 version
ORIG_VER=$(grep -m1 '^version:' "$SNAPSHOT_FILE" | sed 's/version: *//')
echo "原始版本: $ORIG_VER"

# 制造漂移
sed -i "s/^version:.*/version: 9999.0.0-e2e-drift/" "$SNAPSHOT_FILE"
echo "已制造漂移 → snapshot version = 9999.0.0-e2e-drift"

# 触发巡检（尝试手动触发端点，若不存在则依赖 tick 定时器）
TRIGGER_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/skill-drift/patrol-trigger" 2>/dev/null)
if [ "$TRIGGER_RESP" = "200" ] || [ "$TRIGGER_RESP" = "202" ]; then
  echo "巡检已手动触发 HTTP=$TRIGGER_RESP"
else
  echo "无手动触发端点（HTTP=$TRIGGER_RESP），等待 tick 触发"
fi

# 等待写入（最多 15 秒）
MAX_WAIT=15
for i in $(seq 1 $MAX_WAIT); do
  COUNT=$(psql "$DB" -t -c \
    "SELECT count(*) FROM skill_drift_alerts \
     WHERE skill_name='harness-planner' \
     AND detected_at > NOW() - interval '5 minutes'" 2>/dev/null | tr -d ' ')
  [ "$COUNT" -ge 1 ] 2>/dev/null && break
  [ "$i" = "$MAX_WAIT" ] && {
    echo "FAIL: 超时 $MAX_WAIT 秒内未写入告警记录"
    sed -i "s/^version:.*/version: $ORIG_VER/" "$SNAPSHOT_FILE"
    exit 1
  }
  sleep 1
done
echo "✅ Step 2 PASS 告警已落库 count=$COUNT"

echo ""
echo "=== Step 3: 重复触发 → 验证按日去重 ==="
BEFORE=$(psql "$DB" -t -c \
  "SELECT count(*) FROM skill_drift_alerts \
   WHERE skill_name='harness-planner' AND drift_date = CURRENT_DATE" | tr -d ' ')

curl -s -o /dev/null -X POST "$BRAIN/api/brain/harness/skill-drift/patrol-trigger" 2>/dev/null || true
sleep 3

AFTER=$(psql "$DB" -t -c \
  "SELECT count(*) FROM skill_drift_alerts \
   WHERE skill_name='harness-planner' AND drift_date = CURRENT_DATE" | tr -d ' ')
[ "$AFTER" -eq "$BEFORE" ] || {
  echo "FAIL: 重复触发产生了新记录 before=$BEFORE after=$AFTER"
  sed -i "s/^version:.*/version: $ORIG_VER/" "$SNAPSHOT_FILE"
  exit 1
}
echo "✅ Step 3 PASS 去重正常"

echo ""
echo "=== Step 4: 查询 patrol-history ==="
RESP=$(curl -sf "$BRAIN/api/brain/harness/skill-drift/patrol-history")
echo "$RESP" | jq -e '.alerts | type == "array"' || { echo "FAIL: alerts 非数组"; exit 1; }
echo "$RESP" | jq -e 'keys == ["alerts"]' || { echo "FAIL: 顶层 keys 不符"; exit 1; }
echo "$RESP" | jq -e '.alerts | map(select(.skill_name == "harness-planner")) | length >= 1' \
  || { echo "FAIL: 未找到 harness-planner 告警记录"; exit 1; }
echo "$RESP" | jq -e '.alerts[0] | has("id") and has("skill_name") and has("ssot_version") and has("snapshot_version") and has("drift_date") and has("detected_at")' \
  || { echo "FAIL: 记录缺字段"; exit 1; }
echo "$RESP" | jq -e '.alerts[0] | has("name") | not'     || { echo "FAIL: 禁用字段 name 出现"; exit 1; }
echo "$RESP" | jq -e '.alerts[0] | has("time") | not'     || { echo "FAIL: 禁用字段 time 出现"; exit 1; }
echo "✅ Step 4 PASS patrol-history 返回正确"

echo ""
echo "=== 恢复快照 version ==="
sed -i "s/^version:.*/version: $ORIG_VER/" "$SNAPSHOT_FILE"
echo "已恢复 snapshot version = $ORIG_VER"

echo ""
echo "✅ Golden Path E2E 全部通过"
```

---

## Risks

| # | 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | `patrol-trigger` 端点未实现 — E2E Step 2 发 POST 返回 4xx，依赖 tick 触发；若 tick 窗口 > 15s，psql 断言超时，exit 1 | 中（tick 周期通常 5min > 15s）| E2E Step 2 FAIL，需 Generator 实现手动触发端点 | E2E 脚本在 trigger 返回非 200/202 时打印警告但继续；Generator **必须**实现 `POST /api/brain/harness/skill-drift/patrol-trigger` 以使端到端在 15s 内可验 |
| R2 | DB migration 表 `skill_drift_alerts` 未创建 — `psql` 报 `ERROR: relation "skill_drift_alerts" does not exist`，导致脚本 crash 而非返回 count=0 | 中（evaluator 运行前 migration 可能未执行）| E2E Step 2/3 psql crash；BEHAVIOR6/7 也 crash | Generator 须在 migration SQL 注释中写明"evaluator 运行 E2E 前执行：`psql $DB < migration.sql`"；evaluator 侧脚本在 psql 命令前检查表存在：`psql $DB -c '\dt skill_drift_alerts' || { echo "FAIL: migration 未运行"; exit 1; }` |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| patrol 模块 + patrol-history 端点 | `tests/skill-drift-patrol.test.ts` | smoke / HTTP 200 / 必要字段 / runSkillDriftPatrol | → 3-4 failures（模块和端点未实现时） |
