# Contract Draft — 背靠背服务端裁剪 + 三 token 分权（D3）

task_id: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
sprint_dir: sprints/w2-backtoback-d3
journey_type: autonomous
target_environment: local_api
version: v1.0（首轮，无 reviewer feedback）

---

## BEHAVIOR 条目（共 14 条）

### 读侧裁剪（FR-1 / FR-2 / FR-3 / FR-4）

**[BEHAVIOR-1] loadChecks 默认不返回 AI 四列**
- 触发：任何调用 `loadChecks` 的路径（GET /runs/:run_key、GET /runs 列表、内网 GET /pending）
- 断言：响应体中 checks 数组每个元素均不含 `ai_verdict`、`ai_evidence`、`ai_run_at`、`adjudication` 四字段
- 反向断言：不传 `view=review` 时，即使 run.status = `human_complete`，AI 四列仍不出现

**[BEHAVIOR-2] loadChecks 带 view=review 且 run.status = human_complete 时解锁 AI 四列**
- 触发：`GET /runs/:run_key?view=review`，run 状态为 `human_complete`
- 断言：响应体 checks 数组每个元素含 `ai_verdict`、`ai_evidence`、`ai_run_at`、`adjudication` 四字段（值可为 null）
- 铁律来源：[SQL列白名单默认隐藏]

**[BEHAVIOR-3] view=review 但 run.status ≠ human_complete → 403**
- 触发：`GET /runs/:run_key?view=review`，run 状态为 `pending` / `in_review` / `adjudicated` 等非 human_complete 状态
- 断言：HTTP 403；响应体含 `error` 字段说明拒绝原因

**[BEHAVIOR-4] loadRunsWithChecks SQL 显式列白名单（默认不含 AI 四列）**
- 触发：`GET /runs?gp_id=xxx`
- 断言：SQL 查询使用显式列名而非 `SELECT *`；响应体 checks 中无 AI 四列

**[BEHAVIOR-5] gp 级跨轮闸——存在活跃 run 时，全部 run checks 的 AI 四列 + adjudication 置空**
- 触发：同一 gp_id 下存在 status IN ('pending','in_review') 的 run 时，`loadRunsWithChecks` 返回结果
- 断言：所有 run 的 checks 中 `ai_verdict`、`ai_evidence`、`ai_run_at`、`adjudication` 均为 null/缺失
- 铁律来源：[gp级跨轮闸活跃run谓词] — 谓词必须是 `status IN ('pending','in_review')`，不得使用宽泛「存在 run」

**[BEHAVIOR-6] 内网 GET /acceptance/pending 剥 AI 四列**
- 触发：内网 `GET /api/brain/acceptance/pending`（由 `loadPendingRuns` 驱动）
- 断言：响应体 runs 数组每个 run 的 checks 中无 AI 四列
- 铁律来源：FR-4

---

### 三 token 路由级分权（FR-5 / FR-6 / FR-7）

**[BEHAVIOR-7] createBearerAuth 空 token → 路由不挂载 + 启动告警，不 throw / 不崩**
- 触发：`acceptance-public-server.js` 启动时 token 参数为空/undefined
- 断言：该路由不挂载（对应端点返回 404）；`console.warn` / `console.log` 含告警文本；listener 正常启动
- 铁律来源：[createBearerAuth容错]；现状：当前 `createBearerAuth` 空 token 会 throw（需修改）

**[BEHAVIOR-8] AI token → 仅挂 POST /acceptance/ai-results**
- 触发：`ACCEPTANCE_AI_TOKEN` 配置且有效
- 断言：`POST /acceptance/ai-results` 携带正确 token → 200/业务响应；其他路径（GET /acceptance/gate、GET /acceptance/catalog）使用 AI token → 401 或 404
- 铁律来源：[AI token 不得持有人列写权]

**[BEHAVIOR-9] gate token → 仅挂 GET /acceptance/gate**
- 触发：`ACCEPTANCE_GATE_TOKEN` 配置且有效
- 断言：`GET /acceptance/gate` 携带正确 token → 200/业务响应；`POST /acceptance/ai-results` 使用 gate token → 401 或 404

**[BEHAVIOR-10] api token → 仅挂 GET /acceptance/catalog**
- 触发：`ACCEPTANCE_CATALOG_TOKEN` 配置且有效
- 断言：`GET /acceptance/catalog` 携带正确 token → 200/业务响应；其他两端点使用 api token → 401 或 404

**[BEHAVIOR-11] 单 token 缺失 → 对应端点不挂载，其他端点正常，listener 不崩**
- 触发：三个 token 中任意一个未配置（env var 缺失）
- 断言：缺失端点 → 404；其余两个端点正常响应；`startAcceptancePublicServer` 返回非 null（server 启动）；启动日志含缺失端点告警

**[BEHAVIOR-12] 公网 POST /acceptance/results 解挂（不删函数体）**
- 触发：公网端点重构后
- 断言：`createAcceptancePublicRouter` 中 `POST /acceptance/results` 路由不再注册；但 `submitAcceptanceResults` 函数体仍存在于代码中（不删除）
- 铁律来源：[公网端点休眠不删码]

---

### AI 写侧过滤（FR-7）

**[BEHAVIOR-13] POST /acceptance/ai-results 静默忽略 result / submitted_by / adjudication**
- 触发：请求体含 `result`、`submitted_by`、`adjudication` 字段
- 断言：DB 中 acceptance_checks 对应行的 `result`、`submitted_by`、`decided_at` 字段不被修改；只更新 `ai_verdict`、`ai_evidence`、`ai_run_at`
- 铁律来源：[写侧过滤]

**[BEHAVIOR-14] POST /acceptance/ai-results 端点受 ACCEPTANCE_AI_TOKEN 守卫**
- 触发：不携带 token 或携带错误 token 调用 `POST /acceptance/ai-results`
- 断言：HTTP 401；不执行任何 DB 写操作
- 铁律来源：[端点鉴权]；[AI token 不得持有人列写权]

---

## E2E 验收段

### manual:bash 验收（target_environment: local_api）

```bash
# ① 读侧默认隐藏（BEHAVIOR-1）
RUN_KEY="d3-e2e-$(date +%s)"
# 建单
curl -sf -X POST http://localhost:5221/api/brain/acceptance/runs \
  -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$RUN_KEY\",\"title\":\"D3-E2E\",\"gp_id\":\"test-gp\",\"detail\":{},\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"test-check\"}]}"
# 读取——不带 view=review，AI 四列不应出现
RESP=$(curl -sf http://localhost:5221/api/brain/acceptance/runs/$RUN_KEY)
echo "$RESP" | python3 -c "
import json,sys
data=json.load(sys.stdin)
checks=data.get('checks',[])
for c in checks:
    for col in ['ai_verdict','ai_evidence','ai_run_at','adjudication']:
        assert col not in c or c[col] is None, f'AI col leaked: {col}={c[col]}'
print('PASS: AI cols hidden by default')
"

# ② view=review 非 human_complete → 403（BEHAVIOR-3）
STATUS=$(curl -o /dev/null -w "%{http_code}" \
  "http://localhost:5221/api/brain/acceptance/runs/$RUN_KEY?view=review")
[ "$STATUS" = "403" ] && echo "PASS: 403 for non-human_complete review" || echo "FAIL: got $STATUS"

# ③ 写侧过滤验证（BEHAVIOR-13）
# 需先确认 POST /acceptance/ai-results 只更新 ai_* 三列
# 通过 psql 查验
psql -U cecelia cecelia -c "SELECT check_key, result, submitted_by, ai_verdict FROM acceptance_checks WHERE run_id IN (SELECT id FROM acceptance_runs WHERE run_key='$RUN_KEY');"
```

---

## 字段名核对（[proposer起草涉及DB字段的合同前先psql核对] 铁律）

**acceptance_checks 字段**（来源：migration 369 + 380 + 392）：
- 原始列：`id`, `run_id`, `check_key`, `kind`, `name`, `device`, `result`, `note`, `decided_at`, `created_at`, `updated_at`
- 380 新增：`detail`, `submitted_by`
- 392 新增：`ai_verdict`, `ai_evidence`, `ai_run_at`, `adjudication`

**AI 四列定义**：`ai_verdict TEXT`、`ai_evidence JSONB`、`ai_run_at TIMESTAMPTZ`、`adjudication JSONB`（均 nullable）

**acceptance_runs 字段**（来源：migration 369 + 392）：
- 原始列：`id`, `run_key`, `title`, `gp_id`, `line`, `surface`, `version`, `status`, `pass_rate`, `source`, `created_at`, `updated_at`
- 392 新增：`detail JSONB`

> 注：本 sprint 以 migration 文件为 SSOT，未直接 `\d` 核查（本地 DB 连接需服务运行）。若 DB 已运行，执行 `psql -U cecelia cecelia -c "\d acceptance_checks"` 二次确认。

---

## 铁律覆盖矩阵

| 铁律 | 覆盖 BEHAVIOR | 状态 |
|------|-------------|------|
| [SQL列白名单默认隐藏] | B1, B2, B3, B4, B6 | ✓ 覆盖 |
| [gp级跨轮闸活跃run谓词] | B5 | ✓ 覆盖 |
| [createBearerAuth容错] | B7, B11 | ✓ 覆盖 |
| [公网端点休眠不删码] | B12 | ✓ 覆盖 |
| [AI token 不得持有人列写权] | B8, B14 | ✓ 覆盖 |
| [写侧过滤] | B13 | ✓ 覆盖 |
| [端点鉴权] | B8, B9, B10, B14 | ✓ 覆盖 |
| [凭据安全] | B7~B11（token 不硬编码） | ✓ 行为约束含此要求 |
| [租户隔离] | 本 sprint 无新租户查询路径 | N/A |
| [failing test 先 commit] | FR-8 → 见 DoD | ✓ DoD 强制 |
| [上线前核日志] | 非代码行为，见 DoD SOP | ✓ DoD SOP |
