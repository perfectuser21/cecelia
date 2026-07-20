# Contract Draft — Inbox P1 主干
## 元信息
- **task_id**: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
- **sprint_dir**: sprints/07200850-relay-07b2fd3b
- **合同轮次**: R1
- **base_repo**: cecelia
- **target_environment**: mac_web
- **生成时间**: 2026-07-20
- **依赖**: PR#4126 已合入 main（P0 清场完成）

---

## 范围声明

本合同覆盖 **Inbox P1 主干**全部功能，对应 PRD 中 FR-1 到 FR-10 及 10 条铁律（I-1 到 I-10）。

**本合同不覆盖**：
- captures 快捷输入框（P2，本 sprint 不做）
- Feishu webhook 直连 captures（P3）
- i18n 国际化

---

## 技术断言总览

| 断言ID | 对应 FR/铁律 | 类型 | 可验证方式 |
|--------|-------------|------|-----------|
| A-01 | FR-1 | DB 字段 | `\d captures` 含 7 个新字段 |
| A-02 | FR-1 | DB 状态 | `SELECT DISTINCT status FROM captures` 只含 4 态 |
| A-03 | FR-2 | DB 字段 | `\d capture_atoms` 含 nature/repo/lane/retry_count |
| A-04 | FR-2 | DB 状态 | `SELECT count(*) WHERE status='parked'` ≥ triage 标记数 |
| A-05 | FR-3 | HTTP 201 | POST captures 返回 201 + {id, status, dedupe_key} |
| A-06 | FR-3 | 幂等 | 重复 POST（dedupe_key 相同）返回 200 + dedupe_hit:true |
| A-07 | FR-3 | 出身路由 | nature 有值 → status='clarified'；无值 → status='captured' |
| A-08 | FR-4 | 写 captures | writing learning → captures 表有 nature='learning' 记录 |
| A-09 | FR-4 | 双写 atoms | capture 写入后 capture_atoms 有对应 capture_id |
| A-10 | FR-5 | task 创建 | urgent 触发 → tasks 表增加 title LIKE '[紧急]%' 记录 |
| A-11 | FR-5 | Bark 发出 | urgent 触发 → console.log/bark response 可见 |
| A-12 | FR-5 | 回链 | atom.routed_to_table='tasks', routed_to_id 有值 |
| A-13 | FR-5 | 护栏保留 | isProductionSensitive 命中 → 仅 Bark，不建 task |
| A-14 | FR-6 | notes 写入 | okr 触发 → notes 表有 category='strategic_input' 记录 |
| A-15 | FR-6 | 回链 | atom.routed_to_table='notes', routed_to_id 有值 |
| A-16 | FR-7 | 重试逻辑 | retry_count=0 llm_failed atom → 运行 aging → retry_count=1, ai_reason=NULL |
| A-17 | FR-7 | 超限转 parked | retry_count=3 llm_failed atom → 运行 aging → status='parked' |
| A-18 | FR-7 | 计数返回 | aging 返回 {overdue_captures, overdue_atoms, retried, parked_by_aging} |
| A-19 | FR-8 | 列表 API | GET /captures?stage=captured → 含 counts_by_stage 对象 |
| A-20 | FR-8 | 详情 API | GET /captures/:id → 含 atoms 数组 |
| A-21 | FR-8 | reroute | PATCH confirm {action:"reroute", nature:"learning"} → ai_reason 清空 |
| A-22 | FR-8 | drop | PATCH confirm {action:"drop"} → status='dropped' |
| A-23 | FR-8 | 手动重试 | POST /capture-atoms/:id/retry → status='pending_review', retry_count+1 |
| A-24 | FR-9 | 漏斗渲染 | Playwright 截图 /inbox → 页面含"captured"或"clarified"文字 |
| A-25 | FR-9 | 列表渲染 | 至少一行条目可见 |
| A-26 | FR-9 | 详情抽屉 | 点击条目 → 抽屉出现（含"nature"或"atoms"文字） |
| A-27 | FR-9 | 超期标红 | >7天非终态条目行背景含 #ef4444 |
| A-28 | FR-10 | 积压清零 | 运行脚本后 `SELECT count(*) WHERE status='pending_review'` = 0 |
| A-29 | FR-10 | parked 迁移 | 有 triage 标记的 atoms 转为 status='parked' |

---

## 判定点登记表

| 判定点 | 可验证断言 | 失败定义 |
|--------|-----------|---------|
| CP-01: migration 354 执行成功 | `SELECT column_name FROM information_schema.columns WHERE table_name='captures' AND column_name IN ('nature','repo','lane','ref_task_id','ref_journey_id','ref_pr_url','dedupe_key')` 返回 7 行 | 任一字段缺失 |
| CP-02: migration 354 状态迁移 | `SELECT DISTINCT status FROM captures` 结果集 = {'captured','clarified','done','dropped'}（无 inbox/processing/archived） | 含旧状态 |
| CP-03: migration 355 执行成功 | `SELECT column_name FROM information_schema.columns WHERE table_name='capture_atoms' AND column_name IN ('nature','repo','lane','retry_count')` 返回 4 行 | 任一字段缺失 |
| CP-04: migration 355 parked 迁移 | `SELECT count(*) FROM capture_atoms WHERE status='parked'` ≥ 0 + triage 标记数量（脚本执行前记录） | count 未增加 |
| CP-05: POST /captures 端点存在 | curl -X POST localhost:5221/api/brain/captures -H 'Content-Type:application/json' -d '{"content":"test","source":"harness","dedupe_key":"cp-05"}' → HTTP 201 | 非 201 |
| CP-06: dedupe 幂等性 | 同 dedupe_key 二次 POST → HTTP 200 + body.dedupe_hit=true | 报错或返回 201 |
| CP-07: nature=learning → status=clarified | POST with nature:"learning" → response.status="clarified" | status 非 clarified |
| CP-08: pushCapture 双写 | 写 learning → captures 有记录 AND capture_atoms 有对应 capture_id 记录 | 任一表缺失 |
| CP-09: urgent → task 创建 | INSERT atom (target_type='issue',target_subtype='P0') + runCaptureTriage → tasks 增 1 行 | tasks 未增加 |
| CP-10: urgent 护栏 | PRODUCTION_SENSITIVE_PATTERN 命中内容 → tasks 不增加，Bark 发出 | task 被创建 |
| CP-11: okr → notes 写入 | okr 路由 atom → notes 增 1 行 category='strategic_input' | notes 未增加 |
| CP-12: aging 重试逻辑 | llm_failed atom retry_count=0 → aging 后 retry_count=1, ai_reason=NULL | 未更新 |
| CP-13: aging 超限转 parked | llm_failed atom retry_count=3 → aging 后 status='parked' | 状态未变 |
| CP-14: GET /captures 列表 | 返回 counts_by_stage 含4个键 | 缺少 counts_by_stage |
| CP-15: GET /captures/:id 详情 | 返回 atoms 数组（空数组也可，key 必须存在） | 无 atoms 字段 |
| CP-16: reroute 清 ai_reason | PATCH action:reroute → ai_reason 为 NULL 或空字符串 | ai_reason 未清 |
| CP-17: /inbox 页渲染 | Playwright 访问 localhost:5174/inbox → HTTP 200，DOM 含漏斗磁贴 | 页面 404 或空白 |
| CP-18: 积压 pending_review 清零 | 运行 backfill 脚本 → `SELECT count(*) FROM capture_atoms WHERE status='pending_review'` = 0 | count > 0 |

**判定点总数: 18**

---

## 铁律覆盖矩阵

| 铁律 | 对应实现 | 验证方式 |
|------|---------|---------|
| I-1: captures 是 L0 唯一入口 | FR-3 POST /captures 端点 + FR-4 pushCapture 改道 | A-05, A-08 |
| I-2: 新 job 必须有消费方 | FR-5 urgent→task, FR-6 okr→notes, FR-7 aging 有计数 | A-10, A-14, A-18 |
| I-3: 建表前 grep 写入方 | migration 前 grep captures 写入方（开发侧验证） | CP-01, CP-03 |
| I-4: catch 吞错 job 必须带失败计数 | FR-7 aging 返回计数指标 {retried, parked_by_aging} | A-18 |
| I-5: 退役判断查生产库 | FR-10 backfill 前 SELECT count 实锤 | A-28 |
| I-6: 派生回链强制写 routed_to | FR-5/FR-6 updateAtom 含 routedToTable/routedToId | A-12, A-15 |
| I-7: invariant 路过 invariant-gate | capture-triage.js invariant 分支不动 | 代码审查确认 |
| I-8: 每条路由有真实消费者 | FR-5 urgent→task, FR-6 okr→notes | A-10, A-14 |
| I-9: Dropped 合法终态，parked 是人工队列 | FR-2 parked 状态 + FR-8 drop 操作 | A-04, A-22 |
| I-10: 生产护栏不动 | PRODUCTION_SENSITIVE_PATTERN 保留 + urgent 分支护栏检查 | A-13 |

**铁律覆盖: 10/10**

---

## FR 覆盖矩阵

| FR | 核心断言 | 判定点 |
|----|---------|--------|
| FR-1 | migration 354 字段 + 状态迁移 | CP-01, CP-02 |
| FR-2 | migration 355 字段 + parked 迁移 | CP-03, CP-04 |
| FR-3 | POST /captures 201 + dedupe 200 + nature→status | CP-05, CP-06, CP-07 |
| FR-4 | pushCapture 双写 captures + atoms | CP-08 |
| FR-5 | urgent → task + Bark + 护栏保留 | CP-09, CP-10 |
| FR-6 | okr → notes strategic_input | CP-11 |
| FR-7 | aging 重试 + 超限转 parked + 计数 | CP-12, CP-13 |
| FR-8 | CRUD 列表/详情/reroute/drop/retry | CP-14, CP-15, CP-16 |
| FR-9 | /inbox Playwright 漏斗 + 列表 + 抽屉 | CP-17 |
| FR-10 | backfill 积压清零 | CP-18 |

**FR 覆盖: 10/10**

---

## E2E 验收

### 环境
- **target_environment**: mac_web
- **Playwright 基础 URL**: http://localhost:5174
- **Brain URL**: http://localhost:5221
- **运行方式**: `npx playwright test sprints/07200850-relay-07b2fd3b/tests/`

### E2E-1：新 learning 全链路可见
```bash
# Step 1: 写入新 capture
curl -s -X POST http://localhost:5221/api/brain/captures \
  -H "Content-Type: application/json" \
  -d '{"content":"测试新capture学习条目","source":"harness","nature":"learning","dedupe_key":"e2e-learning-001"}' | jq .

# 等待 ≤5 分钟（triage tick 运行）

# Step 2: 验证 captures 表
curl -s "http://localhost:5221/api/brain/captures?nature=learning" | jq '.items[] | select(.dedupe_key=="e2e-learning-001")'

# Step 3: 验证状态
# 期望: status IN ('clarified','done') AND atoms 非空

# Step 4: Playwright 截图
npx playwright test sprints/07200850-relay-07b2fd3b/tests/inbox-e2e.spec.ts --grep "E2E-1"
```

### E2E-2：urgent 路由产生真实 task + Bark
```bash
# Step 1: 插入 urgent atom
psql $DATABASE_URL -c "INSERT INTO capture_atoms (content, target_type, target_subtype, status) VALUES ('E2E紧急测试', 'issue', 'P0', 'pending_review') RETURNING id"

# Step 2: 触发 triage（等 tick 或手动调用）
curl -s -X POST http://localhost:5221/api/brain/debug/run-triage 2>/dev/null || true

# Step 3: 验证 task 创建
psql $DATABASE_URL -c "SELECT count(*) FROM tasks WHERE title LIKE '[紧急]%' AND created_at > now()-interval '5 min'"
# 期望: count ≥ 1

# Step 4: 验证 atom 状态
psql $DATABASE_URL -c "SELECT status, routed_to_table FROM capture_atoms WHERE content='E2E紧急测试' ORDER BY created_at DESC LIMIT 1"
# 期望: status='confirmed', routed_to_table='tasks'
```

### E2E-3：积压 32 条 pending_review 清零
```bash
# Step 1: 记录当前积压数
psql $DATABASE_URL -c "SELECT count(*) FROM capture_atoms WHERE status='pending_review'"

# Step 2: 运行 backfill
node packages/brain/src/scripts/backfill-pending-review.js

# Step 3: 验证清零
psql $DATABASE_URL -c "SELECT count(*) FROM capture_atoms WHERE status='pending_review'"
# 期望: 0

# Step 4: 验证 parked 增加
psql $DATABASE_URL -c "SELECT count(*) FROM capture_atoms WHERE status='parked'"
```

### E2E-4：Dashboard /inbox 页漏斗渲染（mac_web Playwright）
```bash
# 运行 Playwright 测试
npx playwright test sprints/07200850-relay-07b2fd3b/tests/inbox-e2e.spec.ts --grep "E2E-4"

# 手动验证步骤：
# 1. 确保 Dashboard 运行在 localhost:5174
# 2. 打开 http://localhost:5174/inbox
# 3. 截图保存到 sprints/07200850-relay-07b2fd3b/screenshots/inbox-funnel.png
# 4. 断言：页面含文字 "captured" 或 "clarified"
# 5. 断言：至少一个计数值 > 0
# 6. 点击第一行条目 → 抽屉出现（含 "nature" 或 "atoms"）
```

---

## 非功能需求验收

| NFR | 验收方式 |
|-----|---------|
| NFR-1: pending_review 兼容 | `grep -r "pending_review" packages/brain/src/capture-triage.js` 查询条件不变 |
| NFR-2: 幂等性 | A-06 dedupe 测试覆盖 |
| NFR-3: 非阻塞 | 代码审查：pushCapture 含 try/catch 吞错 |
| NFR-4: 保护系统不动 | `grep -r "PRODUCTION_SENSITIVE_PATTERN" packages/brain/src/` 仍存在 |
| NFR-5: 事务完整性 | 代码审查：urgent/okr 分支含 BEGIN/COMMIT |
| NFR-6: 账龄间隔 | `process.env.CECELIA_CAPTURE_AGING_INTERVAL_MS` 可覆盖 |
| NFR-7: Dashboard 性能 | GET /captures 默认 limit=50 |

---

## Test Contract

| Behavior | Test File | it() Name |
|---|---|---|
| BEHAVIOR-1: POST /api/brain/captures 幂等进箱 | `../../packages/brain/src/routes/__tests__/captures-api.test.ts` | `dedupe_key 重复` |
| BEHAVIOR-2: urgent→task+Bark | `../../packages/brain/src/routes/__tests__/capture-triage-routes.test.ts` | `urgent 路由后 atom 包含 routed_to_table` |
| BEHAVIOR-3: okr→notes | `../../packages/brain/src/routes/__tests__/capture-triage-routes.test.ts` | `okr 路由 atom → notes` |
| BEHAVIOR-4: aging重试 | `../../packages/brain/src/__tests__/capture-aging.test.ts` | `llm_failed atom → retry_count` |
| BEHAVIOR-5: /inbox漏斗渲染 | `../../packages/quality/e2e/inbox-e2e.spec.ts` | `漏斗磁贴存在且含计数` |
| BEHAVIOR-6: 积压清零 | `../../packages/brain/src/scripts/__tests__/backfill-pending-review.test.js` | `脚本文件可以加载` |
| BEHAVIOR-7: CRUD reroute/drop | `../../packages/brain/src/routes/__tests__/captures-api.test.ts` | `action:reroute` |

---

## 执行顺序（合同锁定）

```
Step 1: migration 354 + 355（FR-1, FR-2）
Step 2: POST /captures 端点（FR-3）
Step 3: pushCapture 改道（FR-4）
Step 4: urgent + okr 封死（FR-5, FR-6）
Step 5: capture-aging.js（FR-7）
Step 6: CRUD 扩展（FR-8）
Step 7: backfill 脚本（FR-10）
Step 8: Dashboard /inbox（FR-9）
Step 9: E2E 全链路验收
```
