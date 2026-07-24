# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面 + api_registry/db_schema 推导）

### Endpoint: DELETE /api/brain/tasks/:id

**Success (HTTP 200)** — 复用 conversations.js DELETE `/:id` 的软删除响应模式（`RETURNING *`，返回整行）：

```json
{
  "id": "<uuid>",
  "status": "cancelled",
  "title": "<string>",
  "updated_at": "<timestamp>",
  "...": "tasks 表其余既有列（原样透传，同现有 PATCH /:id 响应形状）"
}
```
- `id` (string/uuid, 必填): 来源——PRD Golden Path「校验（不存在→404；已终态→409；其余→软删除）」，回显被删除任务 id
- `status` (string, 必填): 来源——PRD 假设段 `[ASSUMPTION: DELETE 用软删除(status=cancelled)]`，固定字面量 `"cancelled"`
- 其余字段：沿用 tasks 表既有列（同 GET /:id、PATCH /:id 的返回形状，`SELECT *` / `RETURNING *`），不新增/不裁剪字段

**禁用字段名**: 无新增禁用字段（本端点复用整行返回模式，不引入新命名分歧）

**Error (HTTP 404 — 任务不存在)**:
```json
{"error": "<string>", "id": "<string>"}
```
- 来源：api_registry 推导——GET /:id 与 PATCH /:id 现有 404 均返回 `{error, id}` 形状（`task-tasks.js` 现有代码），DELETE 跟进同形状，不自创新字段名

**Error (HTTP 409 — 已终态)**:
```json
{"error": "<string>", "details": "<string>"}
```
- 来源：api_registry 推导——PATCH /:id 现有状态机保护 409 返回 `{error: 'State machine violation', details: '...'}`（`task-tasks.js` 现有代码 `TERMINAL_STATUSES` 分支），DELETE 复用同形状

### fetchPendingBatch（postdeploy-verifier.js，内部函数，无 HTTP 响应）

N/A — 无 HTTP 响应，仅 SQL WHERE 子句新增 `AND title NOT LIKE 'smoke:%'` 一个过滤条件，无 Response Schema 可推导。行为通过 `runPostdeployVerifier()` 的可观测副作用（DB 行状态）验证。

---

## 已知约束（来自回归测试 + 累积 FR）

- context-manifest: unavailable（PRD 声明 `journey_id: none`，无 journey_id 锚定，本 sprint 非 Golden Path 迭代任务，不查累积 FR 端点）
- [累积FR]（本 line 暂无历史，PRD 原文声明）

**回归测试约束（`packages/brain/src/__tests__/postdeploy-verifier.test.js`）**：
- [postdeploy-verifier.test.js] → 任务 command=sh -c "echo ok" → 验证通过 → UPDATE status=completed
- [postdeploy-verifier.test.js] → 任务 command 非法（rm -rf）→ 标 failed，不执行命令
- [postdeploy-verifier.test.js] → 任务无 command（兜底放行）→ 标 completed, skipped+1
- [postdeploy-verifier.test.js] → 命令失败 retry_count < MAX_RETRIES → 递增 retry_count，不标 failed
- [postdeploy-verifier.test.js] → 节流：连续两次调用第二次跳过
- [postdeploy-verifier.test.js] → 有 postdeploy_check.command 且非 exempt → 改 pending_postdeploy（execution-callback 门禁，未拦截）

**回归测试约束（`packages/brain/src/__tests__/routes/task-tasks.test.js` 与相关状态机测试）**：
- [routes/task-tasks.test.js] → PATCH /tasks/:id → returns 404 when task not found（GET/PATCH 现有 404 形状 `{error, id}`，DELETE 须跟进）
- [routes/task-tasks.test.js] → updates status and priority（PATCH 状态机保护先 SELECT 当前状态再 UPDATE 的既有模式，DELETE 复用同结构）
- [callback-resilience.test.js / integration/task-status-transitions.integration.test.js] → TERMINAL_STATUSES / State machine violation 既有约束：已终止任务（completed/cancelled）不可回退到非终止状态；DELETE 新增的 409 保护须与此既有铁律一致（不能新开一套独立状态机语义）

**约束对本合同的影响**：DELETE 响应形状（404/409 body）、复用 `TERMINAL_STATUSES` 常量的语义边界，均以上述既有测试锁定的形状为准，不允许另创新形状。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | ①新增 `DELETE /api/brain/tasks/:id`：不存在→404；已终态(completed/cancelled)→409；其余→软删除 `status='cancelled'`，200 返回更新后整行。②`postdeploy-verifier.js` 的 `fetchPendingBatch` 排除 `title LIKE 'smoke:%'` 的任务，使其永久静置 `pending_postdeploy`、不被消费/重试/标 failed/告警 |
| **NFR（做得多好）** | 性能/可靠性/并发阈值等 | N/A（PRD 显式声明：decisions 表 category=nfr 无匹配记录，运维 Bug 修复，无显式性能/频控指标，沿用 Invariant 作质量门槛） |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见下方「Invariant 覆盖」——核心两条：①已终态任务的 status 字段不可被 DELETE 逆转；②smoke: 前缀任务被过滤是「排除批次」而非「打坏批次机制」（非 smoke 任务必须继续被正常消费） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方「判定点登记表」 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | N/A——本次改动是永久性代码路径（路由+SQL过滤），非临时性数据/token，无过期概念。task 17c9d62d 本身保留现状不清理（PRD 明确留作历史证据，永久保留） |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道 | 若 DELETE 路由回归失效（如未来误删）→ smoke 脚本 Step 3 清理再次静默失败 → 残留任务重新进入 `fetchPendingBatch` 扫描范围 → 3 次重试耗尽 → 复现同一 P1 告警链路（本身即是死亡告警，问题会自证）。若 smoke 过滤失效 → 无新增专属告警，但由本 sprint 新增的单元测试（`postdeploy-verifier.test.js` 扩展）在 CI 回归中捕获 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 见下方「失败语义声明」 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？ | DELETE：响应体 `status=cancelled` 不作为唯一证据，DoD/E2E 额外用 `psql` 查真实 DB 行确认（防响应体自证造假）。smoke 过滤：不查"是否被跳过的日志"，直接查 DB 行 `status` 是否仍为 `pending_postdeploy` 且 `payload.postdeploy_retry_count` 未被写入（未被处理的直接物证） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 一个 pending_postdeploy 任务是否属于「smoke 测试任务」 | A. 全局 `is_test` 布尔字段（新框架）；B. `title` 前缀 `smoke:` 精确匹配（大小写敏感） | B. title 前缀 `smoke:` 精确匹配 | PRD 假设段明确指定，且 `postdeploy-verifier-smoke.sh` 脚本硬编码 title 正是 `"smoke: pending_postdeploy test"`，与该前缀逐字匹配；PRD 范围限定明确排除"不引入通用 is_test 字段框架" | 极低概率：真实生产任务恰好以 `smoke:` 开头会被误当测试任务静置，不产生告警（PRD 边界情况段已显式接受此风险，本 sprint 不处理） |
| DELETE 请求命中的任务是否处于「已终态」 | A. 独立维护 DELETE 专属终态列表；B. 复用 PATCH 路由已有的 `TERMINAL_STATUSES = ['completed', 'cancelled']` | B. 复用现有 `TERMINAL_STATUSES` | PRD 范围限定明确要求"复用现有 TERMINAL_STATUSES 保护"，且既有状态机测试（`task-status-transitions.integration.test.js`）已锁定该常量语义，避免 DELETE 与 PATCH 产生两套终态定义 | 若误建第二套终态定义，可能出现 PATCH 允许回退但 DELETE 拒绝（或反之）的语义分裂，后续任何状态机改动需双写维护 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| DELETE 目标任务不存在 | 返回 404，不写入任何 DB 变更 | 是（重复 DELETE 同一不存在 id 恒返回 404，无副作用） | 无需降级，客户端按 404 语义处理（幂等空操作） |
| DELETE 目标任务已终态 | 返回 409，不写入任何 DB 变更（`status` 保持原值） | 是（重复 DELETE 已终态任务恒返回 409，幂等，不会因重试造成状态抖动） | 无降级，409 是设计内保护，客户端不应重试相同请求 |
| fetchPendingBatch 查询本身失败（DB 连接异常等） | 沿用 `runPostdeployVerifier` 既有 try/catch 边界（该函数级异常处理不在本次改动范围内，本次只改 WHERE 子句，不改错误处理路径） | 沿用既有节流 + tick 重试机制 | 沿用既有降级：下一 tick 周期重新扫描 |

---

## Invariant 覆盖（映射 PRD「Invariant 约束」段 8 条铁律）

- [ ] [BEHAVIOR] INV-1 [单slot串行] — N/A：本任务是无状态 HTTP 路由 + 单条 SQL WHERE 子句改动，不涉及 slot/会话调度机制
- [ ] [BEHAVIOR] INV-2 [禁止写死环境假设值] — N/A：DELETE 路由的终态判断复用既有 `TERMINAL_STATUSES` 常量（非环境值），smoke 过滤的 `'smoke:%'` 前缀是业务命名约定（PRD 假设段显式登记来源，非环境探测/坐标/阈值类环境假设值），不涉及需要"从环境推导或真机校准"的场景
- [ ] [BEHAVIOR] INV-3 [真环境验证才算done] — 覆盖：本合同 `## E2E 验收` 段全程使用真实本地 Brain（localhost:5221）+ 真实 Postgres（`psql`/`pg.Client`），contract-dod.md 全部 [BEHAVIOR] 用 `manual:bash` 真实 curl/psql 命令，无 mock，满足此铁律，不再单列冗余断言
- [ ] [BEHAVIOR] INV-4 [测试默认多租户] — N/A（PRD 已注明：本任务无租户维度不适用，tasks 表本次改动不涉及租户隔离查询）
- [ ] [BEHAVIOR] INV-5 [凭据安全] — N/A：本次改动不引入任何新凭据/secret
- [ ] [BEHAVIOR] INV-6 [日志脱敏] — N/A：DELETE 路由与 fetchPendingBatch 均不新增涉及 PII/聊天内容的日志输出
- [ ] [BEHAVIOR] INV-7 [端点鉴权] — N/A（PRD"不在范围内"段已显式声明：新 DELETE 与本文件现有 POST/PATCH/GET 同一现状，无显式 auth，依赖 Brain 内网部署边界，本 sprint 不新增认证改造）
- [ ] [BEHAVIOR] INV-8 [租户隔离] — N/A（PRD 已注明：tasks 表非租户数据不适用）

---

## 真实调用方请求 shape

N/A — Golden Path 全部步骤为 Brain 内部路由（HTTP DELETE，curl/fetch 调用）与内部调度函数（`runPostdeployVerifier`），无外部设备/Agent 调用方涉及本次改动的字段/认证方式。

## 第三方真调一次（规则B）

N/A — 本次改动不依赖任何第三方 API（LLM/支付/短信/平台 API）。

## 未覆盖真实链路清单（规则C — mock 豁免登记）

（本合同无 mock 豁免。两份 contract test 均使用真实 HTTP fetch 打真实本地 Brain + 真实 `pg.Client` 连接真实本地 Postgres，不 mock `db.js` pool，不 mock 被改路径。N/A）

## 禁 mock 边清单

本单改动涉及「DB 写路径」（DELETE 路由新增 UPDATE）与「调度」（fetchPendingBatch 决定哪些任务进入本轮批次）两类，两条边均禁 mock：

- `packages/brain/src/routes/task-tasks.js` ↔ `tasks` 表（DELETE 路由新增 `UPDATE tasks SET status='cancelled' ...`，Test Contract 中 `contract-task-delete.test.ts` 用真实 HTTP DELETE + 真实 `pg.Client` 直连验证，不 mock `db.js`）
- `packages/brain/src/postdeploy-verifier.js` ↔ `tasks` 表（`fetchPendingBatch` 调度批次查询新增 `title NOT LIKE 'smoke:%'` 过滤，决定任务是否进入本轮消费；Test Contract 中 `contract-postdeploy-smoke-filter.test.ts` 直接调用真实 `runPostdeployVerifier()` + 真实 `pg.Client`，不 mock pool 对象拦截 SQL）

---

## Golden Path

[运维/测试脚本对残留任务发起清理] → [Step 1 正常删除] → [Step 2 幂等/边界防护 404] → [Step 3 幂等/边界防护 409-completed] → [Step 4 幂等/边界防护 409-cancelled] → [Step 5 smoke 前缀纵深防御] → [Step 6 全链路 smoke 脚本回归]

### Step 1: DELETE 真实存在的 pending_postdeploy 任务
**来源**: `[FROM_PRD]` — Golden Path 场景 1「DELETE /api/brain/tasks/:id → Brain 校验...其余→软删除 status='cancelled'，200 + 更新后记录」

**可观测行为**: 对一个真实存在、非终态（如 `pending_postdeploy`）的任务发起 `DELETE /api/brain/tasks/:id`，响应 200，响应体 `status='cancelled'`；且该任务从此不再出现在 `pending_postdeploy` 扫描范围内（`status` 已变更，不再满足 `fetchPendingBatch` 的 `WHERE status = 'pending_postdeploy'`）。

**验证命令**:
```bash
TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','contract-e2e-delete-ok','{}'::jsonb) RETURNING id" | tr -d ' \n')
RESP=$(curl -sf -X DELETE "localhost:5221/api/brain/tasks/$TID")
echo "$RESP" | jq -e '.status == "cancelled"' || { echo "FAIL: 响应 status 不是 cancelled"; exit 1; }
echo "$RESP" | jq -e 'has("id") and has("status")' || { echo "FAIL: 200 响应缺 id/status 字段完整性"; exit 1; }
DBSTATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' \n')
[ "$DBSTATUS" = "cancelled" ] || { echo "FAIL: DB status=$DBSTATUS"; exit 1; }
```

**硬阈值**: HTTP 200 且响应体 `status == "cancelled"`、含 `id`/`status` 字段完整性，且 DB 行 `status == 'cancelled'`（双重校验，不信任响应体自证）

---

### Step 2: DELETE 不存在的任务 id
**来源**: `[FROM_PRD]` — 边界情况段「目标任务不存在 → 404」

**可观测行为**: 对随机不存在的 UUID 发起 DELETE，返回 404 + `error` 字段（string），不产生任何 DB 变更。

**验证命令**:
```bash
CODE=$(curl -s -o /tmp/del_404_resp.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000099")
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404 得 $CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/del_404_resp.json || { echo "FAIL: 404 响应缺 error 字段"; exit 1; }
jq -e '.id == "00000000-0000-0000-0000-000000000099"' /tmp/del_404_resp.json || { echo "FAIL: 404 响应 id 字段未回显请求 id"; exit 1; }
```

**硬阈值**: HTTP 404 且响应体含 `error` (string) 字段，且 `id` 字段回显请求的任务 id

---

### Step 3: DELETE 已终态（completed）的任务
**来源**: `[FROM_PRD]` — 边界情况段「已是 completed/cancelled → 409（防误删历史记录）」

**可观测行为**: 对一个已 `completed` 的任务发起 DELETE，返回 409，DB 行 `status` 保持 `completed` 不变（未被误改）。

**验证命令**:
```bash
TID2=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','completed','contract-e2e-delete-terminal','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE=$(curl -s -o /tmp/del_409_completed_resp.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2")
[ "$CODE" = "409" ] || { echo "FAIL: 期望 409 得 $CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/del_409_completed_resp.json || { echo "FAIL: 409 响应缺 error 字段"; exit 1; }
jq -e '.details | type == "string"' /tmp/del_409_completed_resp.json || { echo "FAIL: 409 响应缺 details 字段"; exit 1; }
DBSTATUS2=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2'" | tr -d ' \n')
[ "$DBSTATUS2" = "completed" ] || { echo "FAIL: 已终态任务 status 被误改为 $DBSTATUS2"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2'" >/dev/null
```

**硬阈值**: HTTP 409 且响应体含 `error`/`details`（均为 string）且 DB 行 `status` 仍为 `completed`（未被 DELETE 请求改动）

---

### Step 4: DELETE 已终态（cancelled）的任务（幂等边界）
**来源**: `[FROM_PRD]` — 边界情况段「已是 completed/cancelled → 409（防误删历史记录）」，`cancelled` 与 `completed` 同属边界情况原文列举的两个终态，此前仅 Step 3 覆盖 completed，本步补齐 cancelled（GAN Round 1 Reviewer internal_consistency 反馈：BEHAVIOR4/Test Contract 已覆盖 cancelled 但 Golden Path 与最终 E2E 脚本缺对应步骤）

**可观测行为**: 对一个已 `cancelled` 的任务再次发起 DELETE，返回 409（幂等：重复 DELETE 同一已终态任务恒返回 409，不因重复请求产生状态抖动），DB 行 `status` 保持 `cancelled` 不变。

**验证命令**:
```bash
TID2B=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','cancelled','contract-e2e-delete-already-cancelled','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE2B=$(curl -s -o /tmp/del_409_cancelled_resp.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2B")
[ "$CODE2B" = "409" ] || { echo "FAIL: 期望 409 得 $CODE2B"; exit 1; }
jq -e '.error | type == "string"' /tmp/del_409_cancelled_resp.json || { echo "FAIL: 409 响应缺 error 字段"; exit 1; }
jq -e '.details | type == "string"' /tmp/del_409_cancelled_resp.json || { echo "FAIL: 409 响应缺 details 字段"; exit 1; }
DBSTATUS2B=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2B'" | tr -d ' \n')
[ "$DBSTATUS2B" = "cancelled" ] || { echo "FAIL: 已 cancelled 任务 status 被误改为 $DBSTATUS2B"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2B'" >/dev/null
```

**硬阈值**: HTTP 409 且响应体含 `error`/`details`（均为 string）且 DB 行 `status` 仍为 `cancelled`（幂等，未被二次 DELETE 改动）

---

### Step 5: fetchPendingBatch 排除 smoke: 前缀任务（纵深防御）
**来源**: `[FROM_PRD]` — Golden Path 场景 2「smoke 脚本插入 title 前缀 smoke: 的测试任务...fetchPendingBatch 在 SQL 层排除 smoke: 前缀任务...不被消费/重试/标 failed/告警」

**可观测行为**: 插入一个 `title` 以 `smoke:` 开头、`payload.postdeploy_check.command` 可正常执行成功的 `pending_postdeploy` 任务，直接调用真实 `runPostdeployVerifier()`（本地 node 进程内触发，同 evaluator 的 `manual:bash` 调用方式）扫描后，该任务 `status` 仍为 `pending_postdeploy`（未被消费/未被标 completed/failed），`payload.postdeploy_retry_count` 未被写入。同批次插入的非 smoke 前缀对照任务应正常被消费为 `completed`（证明过滤是选择性排除，非打坏整个批次机制）。

**验证命令**:
```bash
SMOKE_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: contract-e2e-filter-test', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
CONTROL_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','contract-e2e-filter-control', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')

node --input-type=module -e "
import { runPostdeployVerifier, _resetThrottleForTest } from '$(pwd)/packages/brain/src/postdeploy-verifier.js';
import pg from 'pg';
const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
await client.connect();
_resetThrottleForTest();
await runPostdeployVerifier(client);
await client.end();
"

SMOKE_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
[ "$SMOKE_STATUS" = "pending_postdeploy" ] || { echo "FAIL: smoke 任务被消费，status=$SMOKE_STATUS（应保持 pending_postdeploy）"; exit 1; }

CONTROL_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$CONTROL_TID'" | tr -d ' \n')
[ "$CONTROL_STATUS" = "completed" ] || { echo "FAIL: 对照任务未被正常消费，status=$CONTROL_STATUS（应变 completed，证明过滤未打坏整个批次机制）"; exit 1; }

psql "$DB" -c "DELETE FROM tasks WHERE id IN ('$SMOKE_TID','$CONTROL_TID')" >/dev/null
```

**硬阈值**: smoke 前缀任务 `status` 保持 `pending_postdeploy`；非 smoke 对照任务 `status` 变为 `completed`

---

### Step 6: postdeploy-verifier-smoke.sh 全脚本回归（清理链路真正生效）
**来源**: `[FROM_PRD]` — E2E 验收段第 4 点「postdeploy-verifier-smoke.sh 全脚本跑一遍，Step 3 清理用新 DELETE 路由，响应码 200，脚本清理后 psql 确认任务 status='cancelled'」

**可观测行为**: 运行仓库既有的 `packages/brain/scripts/smoke/postdeploy-verifier-smoke.sh`（本 sprint 不改动该脚本本身，只让其 Step 3 的 `curl -X DELETE` 命中真实存在的新路由），脚本 Step 2 创建的任务在 Step 3 被真实 DELETE（200），最终 DB 中该任务 `status='cancelled'`（不再残留 `pending_postdeploy`，验证 PRD 背景段描述的根因链路已断开）。

**验证命令**:
```bash
OUT=$(BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/postdeploy-verifier-smoke.sh 2>&1)
echo "$OUT"
TID3=$(echo "$OUT" | grep -oE 'id=[0-9a-f-]{36}' | head -1 | cut -d= -f2)
[ -n "$TID3" ] || { echo "FAIL: 未能从 smoke 脚本输出解析出 task id"; exit 1; }
DBSTATUS3=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID3'" | tr -d ' \n')
[ "$DBSTATUS3" = "cancelled" ] || { echo "FAIL: smoke 脚本清理后 task status=$DBSTATUS3（期望 cancelled）"; exit 1; }
```

**硬阈值**: smoke 脚本 Step 3 清理后，该任务 DB 行 `status == 'cancelled'`（脚本本身 PASS/FAIL 计数不作为唯一判据——脚本 Step 4 对 `/scheduler/jobs` 端点缺失有软退让逻辑，非本合同关注点；本合同只关注 Step 2+3 清理链路本身）

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e
DB="${DB:-postgresql://localhost/cecelia}"

echo "── 1. DELETE 存在的 pending_postdeploy 任务 → 200 + DB cancelled ──"
TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','final-e2e-delete-ok','{}'::jsonb) RETURNING id" | tr -d ' \n')
RESP=$(curl -sf -X DELETE "localhost:5221/api/brain/tasks/$TID")
echo "$RESP" | jq -e '.status == "cancelled"' || { echo "FAIL: 响应 status 非 cancelled"; exit 1; }
DBSTATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' \n')
[ "$DBSTATUS" = "cancelled" ] || { echo "FAIL: DB status=$DBSTATUS"; exit 1; }
echo "✅ Step1 通过"

echo "── 2. DELETE 不存在的 id → 404 ──"
CODE=$(curl -s -o /tmp/e2e_404.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000099")
[ "$CODE" = "404" ] || { echo "FAIL: 期望404得$CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_404.json || { echo "FAIL: 缺error字段"; exit 1; }
jq -e '.id == "00000000-0000-0000-0000-000000000099"' /tmp/e2e_404.json || { echo "FAIL: 404响应id字段未回显请求id"; exit 1; }
echo "✅ Step2 通过"

echo "── 3. DELETE 已 completed 任务 → 409，未被误改 ──"
TID2=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','completed','final-e2e-delete-terminal','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE2=$(curl -s -o /tmp/e2e_409_completed.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2")
[ "$CODE2" = "409" ] || { echo "FAIL: 期望409得$CODE2"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_409_completed.json || { echo "FAIL: 409响应缺error字段"; exit 1; }
jq -e '.details | type == "string"' /tmp/e2e_409_completed.json || { echo "FAIL: 409响应缺details字段"; exit 1; }
DBSTATUS2=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2'" | tr -d ' \n')
[ "$DBSTATUS2" = "completed" ] || { echo "FAIL: 已终态任务被误改为$DBSTATUS2"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2'" >/dev/null
echo "✅ Step3 通过"

echo "── 4. DELETE 已 cancelled 任务再次 DELETE → 409，幂等未被误改 ──"
TID2B=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','cancelled','final-e2e-delete-already-cancelled','{}'::jsonb) RETURNING id" | tr -d ' \n')
CODE2B=$(curl -s -o /tmp/e2e_409_cancelled.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2B")
[ "$CODE2B" = "409" ] || { echo "FAIL: 期望409得$CODE2B"; exit 1; }
jq -e '.error | type == "string"' /tmp/e2e_409_cancelled.json || { echo "FAIL: 409响应缺error字段"; exit 1; }
jq -e '.details | type == "string"' /tmp/e2e_409_cancelled.json || { echo "FAIL: 409响应缺details字段"; exit 1; }
DBSTATUS2B=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2B'" | tr -d ' \n')
[ "$DBSTATUS2B" = "cancelled" ] || { echo "FAIL: 已cancelled任务被误改为$DBSTATUS2B"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2B'" >/dev/null
echo "✅ Step4 通过"

echo "── 5. fetchPendingBatch 排除 smoke: 前缀任务（纵深防御，选择性排除）──"
SMOKE_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: final-e2e-filter-test', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
CONTROL_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','final-e2e-filter-control', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')

node --input-type=module -e "
import { runPostdeployVerifier, _resetThrottleForTest } from '$(pwd)/packages/brain/src/postdeploy-verifier.js';
import pg from 'pg';
const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
await client.connect();
_resetThrottleForTest();
await runPostdeployVerifier(client);
await client.end();
"

SMOKE_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
[ "$SMOKE_STATUS" = "pending_postdeploy" ] || { echo "FAIL: smoke任务被消费status=$SMOKE_STATUS"; exit 1; }
CONTROL_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$CONTROL_TID'" | tr -d ' \n')
[ "$CONTROL_STATUS" = "completed" ] || { echo "FAIL: 对照任务未被消费status=$CONTROL_STATUS"; exit 1; }
psql "$DB" -c "DELETE FROM tasks WHERE id IN ('$SMOKE_TID','$CONTROL_TID')" >/dev/null
echo "✅ Step5 通过"

echo "── 6. postdeploy-verifier-smoke.sh 全脚本回归（真实清理链路）──"
OUT=$(BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/postdeploy-verifier-smoke.sh 2>&1)
echo "$OUT"
TID3=$(echo "$OUT" | grep -oE 'id=[0-9a-f-]{36}' | head -1 | cut -d= -f2)
[ -n "$TID3" ] || { echo "FAIL: 未解析出smoke脚本task id"; exit 1; }
DBSTATUS3=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID3'" | tr -d ' \n')
[ "$DBSTATUS3" = "cancelled" ] || { echo "FAIL: smoke脚本清理后status=$DBSTATUS3"; exit 1; }
echo "✅ Step6 通过"

echo "✅ Golden Path 全链路验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| DELETE /:id 状态机 | `tests/contract-task-delete.test.ts` | 存在的非终态任务 → HTTP 200，响应 status=cancelled; DB 中该任务 status 真实变为 cancelled; 不存在的 id → HTTP 404 + error 字段 (string); 已 completed 的任务 → HTTP 409，状态未被改动; 已 cancelled 的任务再次 DELETE → HTTP 409 | → 6 项断言中 5 项 FAIL（当前 404 全部命中 Express 默认 HTML 404，非 JSON 200/409） |
| fetchPendingBatch smoke 过滤 | `tests/contract-postdeploy-smoke-filter.test.ts` | title 以 "smoke:" 开头的任务 → runPostdeployVerifier 扫描后 status 仍为 pending_postdeploy（未被消费）; 对照：不带 smoke: 前缀的同批次任务 → 正常被消费，status 变为 completed | → smoke 前缀断言 FAIL（当前无过滤，smoke 任务被正常消费为 completed），对照断言本轮已 PASS（既有批次消费逻辑未改动） |

**实测 Red 证据（本轮已跑）**：`npx vitest run sprints/07240614-relay-137fea96/tests/ --reporter=verbose` → `Test Files 2 failed (2)` / `Tests 6 failed | 1 passed (7)`。

---

## 已知约束（来自回归测试）

（已在上方「已知约束（来自回归测试 + 累积 FR）」章节完整给出，不重复）
