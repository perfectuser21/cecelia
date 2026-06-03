# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面 + 现有 brain routes 命名风格推导）

> Registry 不可用（api/db/test registry 接口返回 unavailable），按 PRD 第 15、20 行字面定义 + 参考 `packages/brain/src/routes/initiatives.js` 现有 snake_case 风格推导。无 NEW_PATTERN，沿用现仓库惯例。

### Endpoint: GET /api/brain/initiative-runs/phase-summary

**Success (HTTP 200)**:
```json
[
  {"phase": "<string>", "count": <number>}
]
```

- 顶层（必填）：JSON 数组（`type == "array"`）
  - 来源：PRD 第 15、20 行"`[{phase, count}]` 按 count 降序的 JSON 数组"
- 每个元素对象的字段集合（必填，**完整匹配** keys == `["count", "phase"]`，jq 按字母序）：
  - `phase` (string, 必填)：initiative_runs.phase 列字面值
    - 来源：PRD 字面 + DB 列名约定（参考 `packages/brain/src/routes/initiatives.js:41` SELECT 已存在 phase 字段为 text/varchar）
  - `count` (number, 必填，≥ 1)：该 phase 在 initiative_runs 表中的非空行数
    - 来源：PRD 字面 + 标准 SQL `COUNT(*)` 语义（≥ 1 因为只统计非空 phase 行）
- 排序：按 `count` 降序（DESC）；count 相同时二次排序未指定
  - 来源：PRD 第 15、20 行"按 count 降序"
- 空表：返回 `[]`
  - 来源：PRD 第 20、26 行"表空时返回 `[]`"
- NULL phase 排除：phase 列为 NULL 的行不进入分组结果
  - 来源：PRD 第 27 行"NULL phase 不进入分组结果（仅统计非空 phase）"

**禁用字段名**（generator 易漂移的同义替换词，contract 严禁出现且必须反向断言）：
- 替换 `phase`：`name` / `phase_name` / `phaseName` / `stage` / `type`
- 替换 `count`：`total` / `n` / `num` / `runs` / `value` / `cnt`

**Error**: 本端点无 query/path/body 入参，无业务异常路径。仅在 DB 不可达时由 Express 默认 500 handler 接管（非本 sprint 显式断言）。非 GET 方法 → Express 默认 404（PRD 第 29 行明确不要求断言）。

---

## Golden Path

[调用方 GET /api/brain/initiative-runs/phase-summary] → [Brain 路由读 initiative_runs 表，过滤 NULL phase 后 GROUP BY phase 计数] → [按 count DESC 排序返回 JSON 数组]

### Step 1: 调用方发起 GET /api/brain/initiative-runs/phase-summary
**来源**: `[FROM_PRD]` — PRD Golden Path 第 18 行"调用方发起 `GET http://localhost:5221/api/brain/initiative-runs/phase-summary`"

**可观测行为**: 该路径在 Brain server 已注册；HTTP 状态码返回 200（不是 404 路由未注册）；响应 Content-Type 含 `application/json`

**验证命令**:
```bash
# 路由必须真实注册：404 = 未注册（不可接受），200 = 已注册
CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/initiative-runs/phase-summary)
[ "$CODE" = "200" ] || { echo "FAIL: 路由未注册或 5xx code=$CODE"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200（路由已注册）；耗时 < 2s

---

### Step 2: Brain 路由按 phase 分组聚合 initiative_runs
**来源**: `[FROM_PRD]` — PRD Golden Path 第 19 行"Brain 路由读取 initiative_runs 表，按 phase 分组计 count" + 第 27 行边界"NULL phase 不进入分组结果"

**可观测行为**: 响应是 JSON 数组；非空时每个元素具备且仅具备 `{phase, count}` 两个字段；phase 是字符串，count 是数字且 ≥ 1；没有任何元素的 phase 为 null

**验证命令**:
```bash
# 注入若干 phase 测试数据 + 一条 NULL phase（验证 NULL 排除）
PSQL="${DB:-postgresql://localhost/cecelia}"
SENTINEL="phase-summary-test-$$"

# 清理可能的残留
psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1 || true

# 插入 3 条 phase=A_contract, 1 条 phase=B_task_loop, 1 条 phase=NULL
psql "$PSQL" -c "
INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason)
SELECT gen_random_uuid(), gen_random_uuid(), v.phase, '$SENTINEL'
FROM (VALUES ('A_contract'), ('A_contract'), ('A_contract'), ('B_task_loop'), (NULL)) AS v(phase);
" >/dev/null 2>&1 || { echo "FAIL: 测试数据注入失败"; exit 1; }

RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary) || { echo "FAIL: curl 非 2xx"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 1) 顶层是数组
echo "$RESP" | jq -e 'type == "array"' >/dev/null || { echo "FAIL: 非数组"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 2) 每条对象 keys 完整匹配 ["count","phase"]（jq 按字母序）
echo "$RESP" | jq -e 'all(.[]; (keys | sort) == ["count","phase"])' >/dev/null || { echo "FAIL: keys 不匹配 [count,phase]"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 3) phase 是 string，count 是 number
echo "$RESP" | jq -e 'all(.[]; (.phase | type == "string") and (.count | type == "number"))' >/dev/null || { echo "FAIL: 字段类型不符"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 4) 没有任何元素 phase 为 null（PRD 第 27 行 NULL 排除）
echo "$RESP" | jq -e 'all(.[]; .phase != null)' >/dev/null || { echo "FAIL: 发现 NULL phase 漏网"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 5) 注入的 A_contract phase 出现且 count >= 3
A_COUNT=$(echo "$RESP" | jq -r '(map(select(.phase == "A_contract")) | .[0].count // 0)')
[ "$A_COUNT" -ge 3 ] || { echo "FAIL: A_contract count 应 >= 3，实际=$A_COUNT"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 清理
psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1
echo OK
```

**硬阈值**: 5 条 jq -e 全过；注入 3 条 A_contract + 1 条 B_task_loop + 1 条 NULL 后，A_contract count ≥ 3、无 NULL phase 漏网

---

### Step 3: 返回按 count 降序排列的 JSON 数组
**来源**: `[FROM_PRD]` — PRD Golden Path 第 15、20 行"按 count 降序排列"

**可观测行为**: 响应数组中 `count` 字段非升序（每个元素的 count 不大于前一个）

**验证命令**:
```bash
# 注入有明显梯度的数据（5 条 phase=top, 2 条 phase=mid, 1 条 phase=low）
PSQL="${DB:-postgresql://localhost/cecelia}"
SENTINEL="phase-sort-test-$$"

psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1 || true
psql "$PSQL" -c "
INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason)
SELECT gen_random_uuid(), gen_random_uuid(), v.phase, '$SENTINEL'
FROM (VALUES
  ('phase-summary-zzz-top'),('phase-summary-zzz-top'),('phase-summary-zzz-top'),('phase-summary-zzz-top'),('phase-summary-zzz-top'),
  ('phase-summary-zzz-mid'),('phase-summary-zzz-mid'),
  ('phase-summary-zzz-low')
) AS v(phase);
" >/dev/null 2>&1 || { echo "FAIL: 测试数据注入失败"; exit 1; }

RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary)

# 整体降序断言：count 列单调非升
echo "$RESP" | jq -e 'length == 0 or ([.[].count] | . == (sort | reverse))' >/dev/null || { echo "FAIL: count 未降序"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

# 注入数据下，phase-summary-zzz-top 应排在 phase-summary-zzz-mid 之前
TOP_IDX=$(echo "$RESP" | jq -r 'map(.phase) | index("phase-summary-zzz-top") // -1')
MID_IDX=$(echo "$RESP" | jq -r 'map(.phase) | index("phase-summary-zzz-mid") // -1')
LOW_IDX=$(echo "$RESP" | jq -r 'map(.phase) | index("phase-summary-zzz-low") // -1')
[ "$TOP_IDX" -ge 0 ] && [ "$MID_IDX" -ge 0 ] && [ "$LOW_IDX" -ge 0 ] || { echo "FAIL: 注入 phase 不全在响应中 top=$TOP_IDX mid=$MID_IDX low=$LOW_IDX"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }
[ "$TOP_IDX" -lt "$MID_IDX" ] && [ "$MID_IDX" -lt "$LOW_IDX" ] || { echo "FAIL: 排序错误 top=$TOP_IDX mid=$MID_IDX low=$LOW_IDX (期望 top<mid<low)"; psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1; exit 1; }

psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1
echo OK
```

**硬阈值**: count 数组等于其降序版；注入的 top/mid/low 三条 phase 顺序符合 5>2>1 的下标关系

---

### Step 4: 禁用字段反向断言 — 防止 generator 漂移字段名
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入；理由：PRD 字面用 `{phase, count}`，但 generator 易把 `phase` 写成 `name/phase_name/stage`、把 `count` 写成 `total/n/runs/value`。无反向断言，假绿风险高（一旦漂移 evaluator 仍 jq 通过）。

**可观测行为**: 响应每个元素**不包含** `name / phase_name / phaseName / stage / type / total / n / num / runs / value / cnt` 任何一个 key

**验证命令**:
```bash
RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary)
echo "$RESP" | jq -e 'length == 0 or all(.[]; (has("name") | not) and (has("phase_name") | not) and (has("phaseName") | not) and (has("stage") | not) and (has("type") | not) and (has("total") | not) and (has("n") | not) and (has("num") | not) and (has("runs") | not) and (has("value") | not) and (has("cnt") | not))' >/dev/null || { echo "FAIL: 发现禁用字段名漏网"; exit 1; }
echo OK
```

**硬阈值**: 11 个禁用字段名全部不在任何响应元素中

---

### Step 5: 空表场景契约 — 顶层始终是 array 类型
**来源**: `[FROM_PRD]` — PRD 第 20、26 行"表空时返回 `[]`"

**可观测行为**: 顶层响应永远是 array 类型；length 可被计算（不是 null/object/error）

**验证命令**:
```bash
# 验证空数组场景：响应必须仍是 array 类型（不论是否真空）
# 真正"空表"难以无副作用模拟（要清空生产表），所以这里断言"length==0 时仍是 array 不报错"作为契约
RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary)
echo "$RESP" | jq -e 'type == "array"' >/dev/null || { echo "FAIL: 顶层非 array"; exit 1; }
# length == 0 的形态契约（jq 接受空数组无报错）
echo "$RESP" | jq -e '(length == 0) or (length > 0)' >/dev/null || { echo "FAIL: length 计算异常"; exit 1; }
echo OK
```

**硬阈值**: 顶层始终是 array 类型；length 可被计算

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# Golden Path 端到端验证 — autonomous + local_api
set -e

PSQL="${DB:-postgresql://localhost/cecelia}"
SENTINEL="phase-summary-e2e-$$"

cleanup() {
  psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 0. Brain 健康检查（端口在线）
curl -fsS localhost:5221/api/brain/health >/dev/null || { echo "FAIL: Brain 不在 5221"; exit 1; }

# 1. 注入种子数据（防止表完全空导致后续断言乏力）
psql "$PSQL" -c "DELETE FROM initiative_runs WHERE failure_reason = '$SENTINEL'" >/dev/null 2>&1 || true
psql "$PSQL" -c "
INSERT INTO initiative_runs (id, initiative_id, phase, failure_reason)
SELECT gen_random_uuid(), gen_random_uuid(), v.phase, '$SENTINEL'
FROM (VALUES
  ('e2e-zzz-alpha'),('e2e-zzz-alpha'),('e2e-zzz-alpha'),
  ('e2e-zzz-beta'),('e2e-zzz-beta'),
  ('e2e-zzz-gamma'),
  (NULL)
) AS v(phase);
" >/dev/null

# 2. Golden Path 触发：单次 GET
RESP=$(curl -fsS localhost:5221/api/brain/initiative-runs/phase-summary) || { echo "FAIL: endpoint 未注册或 5xx"; exit 1; }

# 3. 顶层是 array
echo "$RESP" | jq -e 'type == "array"' >/dev/null || { echo "FAIL: 非 array"; exit 1; }

# 4. 每条 keys 完整匹配 ["count","phase"]
echo "$RESP" | jq -e 'all(.[]; (keys | sort) == ["count","phase"])' >/dev/null || { echo "FAIL: keys 不匹配 [count,phase]"; exit 1; }

# 5. phase 是 string，count 是 number
echo "$RESP" | jq -e 'all(.[]; (.phase | type == "string") and (.count | type == "number"))' >/dev/null || { echo "FAIL: 字段类型不符"; exit 1; }

# 6. NULL phase 已排除（注入的 NULL 不在响应中）
echo "$RESP" | jq -e 'all(.[]; .phase != null)' >/dev/null || { echo "FAIL: NULL phase 漏网"; exit 1; }

# 7. count 整体降序
echo "$RESP" | jq -e '[.[].count] | . == (sort | reverse)' >/dev/null || { echo "FAIL: count 未降序"; exit 1; }

# 8. 注入的 e2e-zzz-alpha (3 条) 排在 e2e-zzz-beta (2 条) 之前 e2e-zzz-gamma (1 条)
ALPHA_IDX=$(echo "$RESP" | jq -r 'map(.phase) | index("e2e-zzz-alpha") // -1')
BETA_IDX=$(echo "$RESP" | jq -r 'map(.phase) | index("e2e-zzz-beta") // -1')
GAMMA_IDX=$(echo "$RESP" | jq -r 'map(.phase) | index("e2e-zzz-gamma") // -1')
[ "$ALPHA_IDX" -ge 0 ] && [ "$BETA_IDX" -ge 0 ] && [ "$GAMMA_IDX" -ge 0 ] || { echo "FAIL: 注入 phase 不全在响应 alpha=$ALPHA_IDX beta=$BETA_IDX gamma=$GAMMA_IDX"; exit 1; }
[ "$ALPHA_IDX" -lt "$BETA_IDX" ] && [ "$BETA_IDX" -lt "$GAMMA_IDX" ] || { echo "FAIL: 排序错误 alpha=$ALPHA_IDX beta=$BETA_IDX gamma=$GAMMA_IDX"; exit 1; }

# 9. count 与实际注入数量匹配
ALPHA_COUNT=$(echo "$RESP" | jq -r 'map(select(.phase == "e2e-zzz-alpha")) | .[0].count')
[ "$ALPHA_COUNT" -eq 3 ] || { echo "FAIL: alpha count=$ALPHA_COUNT 应为 3"; exit 1; }
BETA_COUNT=$(echo "$RESP" | jq -r 'map(select(.phase == "e2e-zzz-beta")) | .[0].count')
[ "$BETA_COUNT" -eq 2 ] || { echo "FAIL: beta count=$BETA_COUNT 应为 2"; exit 1; }
GAMMA_COUNT=$(echo "$RESP" | jq -r 'map(select(.phase == "e2e-zzz-gamma")) | .[0].count')
[ "$GAMMA_COUNT" -eq 1 ] || { echo "FAIL: gamma count=$GAMMA_COUNT 应为 1"; exit 1; }

# 10. 禁用字段名反向检查
echo "$RESP" | jq -e 'all(.[]; (has("name") | not) and (has("total") | not) and (has("stage") | not) and (has("runs") | not) and (has("n") | not))' >/dev/null || { echo "FAIL: 禁用字段名漏网"; exit 1; }

echo "✅ Golden Path E2E 验证通过 alpha=3 beta=2 gamma=1 sort=DESC null_excluded=true"
```

**通过标准**: 脚本 exit 0；注入 3/2/1/NULL 组合后响应正确含 alpha=3 / beta=2 / gamma=1，NULL 排除，顺序 alpha→beta→gamma 降序

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint：phase-summary 路由实现 | `tests/phase-summary.test.ts` | HTTP 200、keys 完整匹配、phase 是 string、NULL phase 行不出现、count 整体单调降序、禁用字段名反向 | 全部 FAIL：`packages/brain/src/routes/initiative-runs.js` 不存在，import 阶段抛错 → 6 个 it 块全部红 |

---

## Risks

> 本段为 GAN Round 2 Reviewer 反馈补入（维度 5 risk_registered）。仅登记 2 条 generator 在本任务中真实易犯的实现陷阱，每条 mitigation 直接映射到合同已有 Step 的 jq 断言，不新增范围、不扩展场景。

### R1: NULL phase 漏网（PostgreSQL GROUP BY 默认行为）

**风险**：PostgreSQL 的 `GROUP BY phase` 默认会把 `phase IS NULL` 当作一个独立分组返回（NULL 在 GROUP BY 中被视为唯一值）。Generator 若直接写 `SELECT phase, count(*) FROM initiative_runs GROUP BY phase ORDER BY count DESC`，没有显式 `WHERE phase IS NOT NULL`，响应中会出现 `{phase: null, count: N}` 元素，违反 PRD 第 27 行边界"NULL phase 不进入分组结果"。

**触发场景**：现存或将来 initiative_runs 表插入了 phase=NULL 的行（已有运行数据中实际可能存在）。

**Mitigation**：
- Step 2 验证命令第 4 条 jq 断言 `all(.[]; .phase != null)`，主动注入 1 条 `(phase=NULL, failure_reason=SENTINEL)` 测试数据后断言响应中无 phase==null 元素。NULL phase 漏网时该断言 FAIL → exit 1。
- E2E 验收脚本第 6 步同断言 `all(.[]; .phase != null)`，在 final-e2e 阶段二次拦截。
- ARTIFACT 静态扫描 `phase IS NOT NULL`（contract-dod.md 第 16 行的第二条 ARTIFACT），要求 generator 在 SQL 字面包含此过滤子句。

### R2: 字段名漂移（generator 用同义词替换 phase/count）

**风险**：Generator 在写 `SELECT phase, count(*) ... GROUP BY phase` 时易受常见命名风格诱惑，把响应字段写成 `{name, total}` / `{stage, runs}` / `{phase_name, n}` / `{type, num}` / `{phaseName, value}` / `{phase, cnt}` 等"更直观"的同义词组合（尤其当模型从训练集中检索到类似聚合 API 时）。一旦漂移，正向 jq 断言 `.phase` / `.count` 会失败，但若仅做正向断言，generator 也可能写成 `{phase, total}` 这种半漂移使部分断言意外通过造成假绿。

**触发场景**：generator 自由发挥 SELECT 别名，未严守 PRD `## Response Schema` 段字面 keys。

**Mitigation**：
- Step 4 验证命令的反向断言 — 11 个禁用字段名 `name / phase_name / phaseName / stage / type / total / n / num / runs / value / cnt` 通过 jq `(has("X") | not)` 链式断言，任一禁用字段出现即 FAIL。
- E2E 验收脚本第 10 步精简版（5 个高频禁用名）二次拦截。
- Step 2 验证命令第 2 条 keys 完整匹配 `(keys | sort) == ["count","phase"]`，不允许多出任何字段（即使正向字段都对）。
- contract-dod.md 第 31 行 BEHAVIOR 第 2 条 + 第 43 行 BEHAVIOR 第 5 条同步执行此双向断言。
