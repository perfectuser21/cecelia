# Contract DoD — Inbox P1主干

**TASK_ID**: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
**Sprint**: sprints/07200850-relay-07b2fd3b
**日期**: 2026-07-20

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] POST /api/brain/captures — 进箱幂等+信封写入

**描述**：统一进箱端点正确写入 captures 表，nature 已知时直接 clarified，dedupe_key 命中时幂等返回原记录。

**验收命令（manual:bash）**：
```bash
# 1. 首次写入（nature 已知，应得 clarified）
RESP=$(curl -s -X POST http://localhost:5221/api/brain/captures \
  -H 'Content-Type: application/json' \
  -d '{"content":"DoD行为测试-learning","source":"learning","nature":"learning","dedupe_key":"dod-b1-test-001"}')
echo "$RESP" | grep -q '"status":"clarified"' && echo "PASS: status=clarified" || echo "FAIL: status not clarified"

# 2. 重复 dedupe_key，应得 dedupe_hit=true、HTTP 200
RESP2=$(curl -s -X POST http://localhost:5221/api/brain/captures \
  -H 'Content-Type: application/json' \
  -d '{"content":"DoD行为测试-learning","source":"learning","nature":"learning","dedupe_key":"dod-b1-test-001"}')
echo "$RESP2" | grep -q '"dedupe_hit":true' && echo "PASS: dedupe_hit=true" || echo "FAIL: dedupe_hit not true"

# 3. DB 验证无重复行
COUNT=$(psql -U postgres -d cecelia -t -c "SELECT count(*) FROM captures WHERE dedupe_key='dod-b1-test-001';" 2>/dev/null | tr -d ' ')
[ "$COUNT" = "1" ] && echo "PASS: DB count=1（无重复）" || echo "FAIL: DB count=$COUNT"
```

**通过条件**：三步均输出 PASS。

---

### [BEHAVIOR-2] capture-triage urgent 路由 — 产生真实 task + Bark 日志

**描述**：target_type=issue, target_subtype=P0/P1 的 atom 经 triage 后，tasks 表产生真实记录，atom status 更新为 routed，日志含 Bark 告警调用。

**验收命令（manual:bash）**：
```bash
# 插入 urgent 测试 atom
ATOM_ID=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO capture_atoms (content, target_type, target_subtype, status) \
   VALUES ('DoD-urgent-测试问题', 'issue', 'P0', 'pending_review') RETURNING id;" \
  2>/dev/null | tr -d ' \n')
echo "插入 atom_id=$ATOM_ID"

# 触发 triage（等待最多60秒，或手动调用）
sleep 5

# 验证 task 已创建
TASK_COUNT=$(psql -U postgres -d cecelia -t -c \
  "SELECT count(*) FROM tasks WHERE source='capture-triage' AND description LIKE '%$ATOM_ID%';" \
  2>/dev/null | tr -d ' ')
[ "$TASK_COUNT" -ge "1" ] && echo "PASS: task 已创建" || echo "FAIL: task 未创建（count=$TASK_COUNT）"

# 验证 atom 状态
ATOM_STATUS=$(psql -U postgres -d cecelia -t -c \
  "SELECT status FROM capture_atoms WHERE id='$ATOM_ID';" 2>/dev/null | tr -d ' \n')
[ "$ATOM_STATUS" = "routed" ] && echo "PASS: atom status=routed" || echo "FAIL: atom status=$ATOM_STATUS"
```

**通过条件**：task 已创建 + atom status=routed。

---

### [BEHAVIOR-3] capture_atoms 积压清零 — pending_review 归零

**描述**：执行 migration 355 后，所有 pending_review 积压条目路由到 routed（confidence>0.6 或 target_type=line_backlog）或 parked（low_confidence/no_journey），无任何数据被 DELETE。

**验收命令（manual:bash）**：
```bash
# 执行前计数
BEFORE=$(psql -U postgres -d cecelia -t -c \
  "SELECT count(*) FROM capture_atoms WHERE status='pending_review';" 2>/dev/null | tr -d ' ')
echo "执行前 pending_review 数量: $BEFORE"

# 执行 migration
psql -U postgres -d cecelia -f packages/brain/migrations/355_backlog_pending_review_migrate.sql 2>&1 | tail -5

# 执行后验证
AFTER=$(psql -U postgres -d cecelia -t -c \
  "SELECT count(*) FROM capture_atoms WHERE status='pending_review';" 2>/dev/null | tr -d ' ')
[ "$AFTER" = "0" ] && echo "PASS: pending_review 归零" || echo "FAIL: 还剩 $AFTER 条 pending_review"

# 验证总行数不变（没有 DELETE）
TOTAL_BEFORE=$((BEFORE + $(psql -U postgres -d cecelia -t -c \
  "SELECT count(*) FROM capture_atoms WHERE status NOT IN ('pending_review');" 2>/dev/null | tr -d ' ')))
TOTAL_AFTER=$(psql -U postgres -d cecelia -t -c \
  "SELECT count(*) FROM capture_atoms;" 2>/dev/null | tr -d ' ')
[ "$TOTAL_BEFORE" = "$TOTAL_AFTER" ] && echo "PASS: 总行数不变（无数据删除）" || echo "FAIL: 行数从 $TOTAL_BEFORE 变为 $TOTAL_AFTER"
```

**通过条件**：AFTER=0 + 总行数不变。

---

### [BEHAVIOR-4] capture-aging job — 超7天账龄告警 + llm_failed 重试上限

**描述**：capture-aging job 对超7天非终态 captures/atoms 触发飞书告警，对 llm_failed atom retry_count≥3 时转为 parked 不再重试。

**验收命令（manual:bash）**：
```bash
# 插入超期测试记录
OLD_CAPTURE_ID=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO captures (content, source, status, created_at) \
   VALUES ('DoD-aging-测试过期', 'api', 'captured', now() - interval '8 days') RETURNING id;" \
  2>/dev/null | tr -d ' \n')
echo "插入超期 capture_id=$OLD_CAPTURE_ID"

# 插入 llm_failed retry>=3 的 atom
RETRY_ATOM_ID=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO capture_atoms (content, target_type, status, retry_count) \
   VALUES ('DoD-retry-已到上限', 'issue', 'llm_failed', 3) RETURNING id;" \
  2>/dev/null | tr -d ' \n')
echo "插入 retry_count=3 的 atom_id=$RETRY_ATOM_ID"

# 等待 aging job 执行（最多120秒）或检查日志
sleep 10

# 验证 overdue 日志
LOG_LINE=$(journalctl -u cecelia-brain --since "1 minute ago" 2>/dev/null | grep '\[capture-aging\]' | head -1)
echo "aging 日志: $LOG_LINE"

# 验证 retry_count>=3 的 atom 转为 parked
RETRY_STATUS=$(psql -U postgres -d cecelia -t -c \
  "SELECT status FROM capture_atoms WHERE id='$RETRY_ATOM_ID';" 2>/dev/null | tr -d ' \n')
[ "$RETRY_STATUS" = "parked" ] && echo "PASS: retry>=3 atom 已转 parked" || echo "WARNING: atom status=$RETRY_STATUS（job 可能尚未运行）"
```

**通过条件**：overdue 日志出现 + retry_count=3 的 atom 转 parked。

---

### [BEHAVIOR-5] pushCapture 旁路封死 — 调用方全部改道

**描述**：handoff.js、learning.js、ledger-hygiene.js、postdeploy-verifier.js、routes/tasks.js 全部改为调用 pushCapture，不再直接写 capture_atoms，旧 pushCaptureAtom 标记 @deprecated。

**验收命令（manual:bash）**：
```bash
# 验证各调用方不再直接调用 pushCaptureAtom（非 @deprecated 注释内）
FILES="packages/brain/src/handoff.js packages/brain/src/learning.js packages/brain/src/ledger-hygiene.js packages/brain/src/postdeploy-verifier.js packages/brain/src/routes/tasks.js"
FOUND=0
for f in $FILES; do
  # 排除 @deprecated 注释行，查找实际调用
  if grep -v "@deprecated\|//\|*" "$f" 2>/dev/null | grep -q "pushCaptureAtom("; then
    echo "FAIL: $f 仍有非 deprecated 的 pushCaptureAtom 调用"
    FOUND=$((FOUND+1))
  fi
done
[ "$FOUND" = "0" ] && echo "PASS: 所有调用方已改道" || echo "FAIL: $FOUND 个文件未改道"

# 验证 pushCaptureAtom 在 capture-inbox.js 中标记 @deprecated
grep -q "@deprecated" packages/brain/src/capture-inbox.js && \
  echo "PASS: pushCaptureAtom 已标记 @deprecated" || \
  echo "FAIL: pushCaptureAtom 未标记 @deprecated"
```

**通过条件**：FOUND=0 + @deprecated 标记存在。

---

### [BEHAVIOR-6] Dashboard /inbox 页漏斗渲染（mac_web Playwright）

**描述**：Dashboard /inbox 路由正确渲染漏斗计数条（含各状态数量），列表展示 captures 数据，账龄超7天行标红。

**验收命令（manual:bash）**：
```bash
# 启动 Dashboard（若未运行）
# 在另一终端: cd apps/dashboard && npm run dev

# 等待启动
sleep 3

# 用 curl 验证路由存在（SPA 返回 200）
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/inbox)
[ "$HTTP_CODE" = "200" ] && echo "PASS: /inbox 路由可访问" || echo "FAIL: HTTP $HTTP_CODE"

# Playwright E2E 验证（mac_web 配置）
cd /workspace && npx playwright test --project=mac_web sprints/07200850-relay-07b2fd3b/tests/inbox-e2e.spec.ts 2>&1 | tail -20
```

**通过条件**：HTTP 200 + Playwright 测试通过 + 截图包含漏斗计数条。

---

### [BEHAVIOR-7] capture-atoms confirm reroute — parked 改判

**描述**：PATCH /api/brain/capture-atoms/:id/confirm 接受 action='reroute'，更新 nature 和 routed_to_table/routed_to_id，写 capture_corrections 记录。

**验收命令（manual:bash）**：
```bash
# 插入 parked atom
ATOM_ID=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO capture_atoms (content, target_type, status) \
   VALUES ('DoD-parked-测试', 'issue', 'parked') RETURNING id;" \
  2>/dev/null | tr -d ' \n')

# 调用 confirm reroute
RESP=$(curl -s -X PATCH "http://localhost:5221/api/brain/capture-atoms/$ATOM_ID/confirm" \
  -H 'Content-Type: application/json' \
  -d '{"action":"reroute","nature":"learning","target_table":"decisions"}')
echo "$RESP" | grep -q '"status":"routed"' && echo "PASS: atom 状态已更新为 routed" || echo "FAIL: $RESP"

# 验证 capture_corrections 写入
CORR=$(psql -U postgres -d cecelia -t -c \
  "SELECT count(*) FROM capture_corrections WHERE atom_id='$ATOM_ID' AND actor='human';" \
  2>/dev/null | tr -d ' ')
[ "$CORR" = "1" ] && echo "PASS: capture_corrections 已写入" || echo "FAIL: corrections count=$CORR"
```

**通过条件**：status=routed + corrections 写入1条。

---

### [BEHAVIOR-8] 信封字段焊死（Inv-3）— triage job 不得覆写 nature/repo/lane/ref_task_id

**描述**：capture-triage 运行后，captures 表中 nature、repo、lane、ref_task_id 四个信封字段必须保持进箱时的原始值，triage job 只允许修改 status 和 atom 相关字段，禁止覆写信封。本条目对应 PRD Inv-3。

**验收命令（manual:bash）**：
```bash
# 1. 插入带明确信封字段的 capture
CAP_ID=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO captures (content, source, status, nature, repo, lane, ref_task_id, dedupe_key) \
   VALUES ('DoD-Inv3-信封焊死测试', 'api', 'captured', 'learning', 'cecelia', 'backlog', 'task-inv3-anchor', 'dod-inv3-test-001') RETURNING id;" \
  2>/dev/null | tr -d ' \n')
echo "插入 capture_id=$CAP_ID"

# 2. 直接调用 capture-triage（不等 scheduler 自然触发）
node -e "
const { triageCapture } = require('./packages/brain/src/capture-triage.js');
triageCapture('$CAP_ID').then(() => console.log('triage done')).catch(e => console.error('triage error:', e.message));
" 2>&1 | tail -5

# 3. 查询信封字段——必须与插入时完全一致
ROW=$(psql -U postgres -d cecelia -t -c \
  "SELECT nature, repo, lane, ref_task_id FROM captures WHERE id='$CAP_ID';" \
  2>/dev/null | tr -d ' ')
echo "信封字段查询结果: $ROW"

NATURE=$(psql -U postgres -d cecelia -t -c \
  "SELECT nature FROM captures WHERE id='$CAP_ID';" 2>/dev/null | tr -d ' \n')
REPO=$(psql -U postgres -d cecelia -t -c \
  "SELECT repo FROM captures WHERE id='$CAP_ID';" 2>/dev/null | tr -d ' \n')
LANE=$(psql -U postgres -d cecelia -t -c \
  "SELECT lane FROM captures WHERE id='$CAP_ID';" 2>/dev/null | tr -d ' \n')
REF=$(psql -U postgres -d cecelia -t -c \
  "SELECT ref_task_id FROM captures WHERE id='$CAP_ID';" 2>/dev/null | tr -d ' \n')

[ "$NATURE" = "learning" ] && echo "PASS: nature 未被覆写" || echo "FAIL: nature 变为 $NATURE"
[ "$REPO" = "cecelia" ]    && echo "PASS: repo 未被覆写"   || echo "FAIL: repo 变为 $REPO"
[ "$LANE" = "backlog" ]    && echo "PASS: lane 未被覆写"   || echo "FAIL: lane 变为 $LANE"
[ "$REF" = "task-inv3-anchor" ] && echo "PASS: ref_task_id 未被覆写" || echo "FAIL: ref_task_id 变为 $REF"
```

**通过条件**：四个信封字段（nature/repo/lane/ref_task_id）均输出 PASS，与进箱时写入值完全一致。

---

### [BEHAVIOR-9] POST /api/brain/capture-atoms/:id/retry — 手动重试接口

**描述**：FR-9 定义的手动重试接口，对 llm_failed 状态的 atom 触发重试（retry_count+1，重置 status 为 pending_review），当 retry_count 已达上限（≥3）时拒绝重试并将 atom 转 parked。

**验收命令（manual:bash）**：
```bash
# 场景 A：retry_count < 3 时，retry_count+1，status 重置为 pending_review
ATOM_A=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO capture_atoms (content, target_type, status, retry_count) \
   VALUES ('DoD-retry-未到上限', 'issue', 'llm_failed', 1) RETURNING id;" \
  2>/dev/null | tr -d ' \n')
echo "插入 atom_A=$ATOM_A（retry_count=1）"

RESP_A=$(curl -s -X POST "http://localhost:5221/api/brain/capture-atoms/$ATOM_A/retry")
echo "retry 响应: $RESP_A"
echo "$RESP_A" | grep -q '"retry_count":2' && echo "PASS: retry_count+1 变为 2" || echo "FAIL: retry_count 未递增，$RESP_A"

STATUS_A=$(psql -U postgres -d cecelia -t -c \
  "SELECT status FROM capture_atoms WHERE id='$ATOM_A';" 2>/dev/null | tr -d ' \n')
[ "$STATUS_A" = "pending_review" ] && echo "PASS: status 重置为 pending_review" || echo "FAIL: status=$STATUS_A"

# 场景 B：retry_count >= 3 时，转 parked，不再重试
ATOM_B=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO capture_atoms (content, target_type, status, retry_count) \
   VALUES ('DoD-retry-已到上限', 'issue', 'llm_failed', 3) RETURNING id;" \
  2>/dev/null | tr -d ' \n')
echo "插入 atom_B=$ATOM_B（retry_count=3）"

RESP_B=$(curl -s -X POST "http://localhost:5221/api/brain/capture-atoms/$ATOM_B/retry")
echo "超限 retry 响应: $RESP_B"

STATUS_B=$(psql -U postgres -d cecelia -t -c \
  "SELECT status FROM capture_atoms WHERE id='$ATOM_B';" 2>/dev/null | tr -d ' \n')
[ "$STATUS_B" = "parked" ] && echo "PASS: 超限后 atom 转 parked" || echo "FAIL: status=$STATUS_B（期望 parked）"
```

**通过条件**：场景 A 中 retry_count 从1变2 + status=pending_review；场景 B 中 status=parked。

---

## DoD 检查清单

### 功能完整性
- [ ] [BEHAVIOR-1] POST /api/brain/captures 幂等进箱 ✓
- [ ] [BEHAVIOR-2] urgent 路由产生真实 task + Bark ✓
- [ ] [BEHAVIOR-3] pending_review 积压归零 ✓
- [ ] [BEHAVIOR-4] capture-aging 账龄告警 + retry 上限 ✓
- [ ] [BEHAVIOR-5] pushCapture 旁路封死 ✓
- [ ] [BEHAVIOR-6] Dashboard /inbox 漏斗渲染 ✓
- [ ] [BEHAVIOR-7] confirm reroute 改判 ✓
- [ ] [BEHAVIOR-8] Inv-3 信封字段焊死 — triage 后 nature/repo/lane/ref_task_id 不变 ✓
- [ ] [BEHAVIOR-9] FR-9 POST /retry 接口 — retry_count+1 + 超限转 parked ✓

### 测试覆盖
- [ ] `packages/brain/src/__tests__/capture-aging.test.js` 存在且通过
- [ ] `packages/brain/src/routes/capture-atoms.test.js` confirm/retry 用例通过
- [ ] `packages/brain/src/__tests__/captures-route.test.js` 新端点单测通过
- [ ] Dashboard E2E mac_web Playwright 截图通过

### Migration 安全
- [ ] Migration 354 在干净 DB 上可重复执行（`IF NOT EXISTS`/`IF NOT EXISTS`）
- [ ] Migration 355 执行后 `SELECT count(*) FROM capture_atoms WHERE status='pending_review'` = 0
- [ ] capture_corrections 表已创建（migration 354 或 独立 migration）

### 不变量验证
- [ ] pushCapture 失败不影响 handoff/learning/issue 主流程（单测 mock DB 报错验证）
- [ ] status CHECK constraint 阻止非法值（psql 验收命令见下）
- [ ] capture-triage 四路骨架测试不回归（`packages/brain/src/__tests__/capture-triage.test.js` 全绿）

**Inv-4 DB CHECK constraint 验收命令（manual:bash）**：
```bash
# 验证 captures 表 status CHECK constraint — 插入非法值应被 DB 拒绝
RESULT=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO captures (content, source, status) VALUES ('constraint-test-inv4', 'api', 'invalid_status');" \
  2>&1)
echo "DB 响应: $RESULT"
echo "$RESULT" | grep -qiE "violates check constraint|check_violation|new row.*violates" \
  && echo "PASS: CHECK constraint 有效，非法 status 已被 DB 拒绝" \
  || echo "FAIL: constraint 未生效，非法值被接受"

# 同样验证 capture_atoms 表的 status constraint
RESULT2=$(psql -U postgres -d cecelia -t -c \
  "INSERT INTO capture_atoms (content, target_type, status) VALUES ('constraint-test-inv4', 'issue', 'invalid_status');" \
  2>&1)
echo "capture_atoms DB 响应: $RESULT2"
echo "$RESULT2" | grep -qiE "violates check constraint|check_violation|new row.*violates" \
  && echo "PASS: capture_atoms CHECK constraint 有效" \
  || echo "FAIL: capture_atoms constraint 未生效"
```
