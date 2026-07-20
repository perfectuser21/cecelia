# Contract DoD — Inbox P1 主干
## 元信息
- **task_id**: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
- **轮次**: R1
- **生成时间**: 2026-07-20

---

## DoD 总则

所有条目必须在 PR 合并前全部为 ✅。**[BEHAVIOR] 条目**为用户可观察的行为断言，每条必须附 manual:bash 可执行命令。

---

## [BEHAVIOR] 行为断言条目

### [BEHAVIOR-1] captures 统一进箱端点正常工作

**描述**: POST /api/brain/captures 能正确写入 captures 表，返回 201，dedupe 幂等返回 200。

**manual:bash**:
```bash
# 验证进箱端点（首次写入）
RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/captures \
  -H "Content-Type: application/json" \
  -d '{"content":"DoD验证条目","source":"harness","nature":"learning","dedupe_key":"dod-behavior-1"}')
echo "首次写入 HTTP 状态码: $RESULT"
[ "$RESULT" = "201" ] && echo "PASS" || echo "FAIL: 期望 201，实际 $RESULT"

# 验证 dedupe 幂等性（重复写入同一 dedupe_key）
RESULT2=$(curl -s -X POST http://localhost:5221/api/brain/captures \
  -H "Content-Type: application/json" \
  -d '{"content":"DoD验证条目","source":"harness","nature":"learning","dedupe_key":"dod-behavior-1"}')
DEDUPE_HIT=$(echo "$RESULT2" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).dedupe_hit))")
echo "dedupe_hit: $DEDUPE_HIT"
[ "$DEDUPE_HIT" = "true" ] && echo "PASS" || echo "FAIL: 期望 dedupe_hit=true"
```

**判定标准**: 首次 POST → 201；重复 POST → 200 + dedupe_hit:true

---

### [BEHAVIOR-2] urgent 路由产生真实 task 而非死胡同

**描述**: capture_atom 分诊为 urgent 时，系统自动创建 P1 任务并发出 Bark 告警，atom 携带回链 routed_to_table='tasks'。

**manual:bash**:
```bash
# Step 1: 插入测试 atom
ATOM_ID=$(psql "$DATABASE_URL" -t -c "
  INSERT INTO capture_atoms (content, target_type, target_subtype, status)
  VALUES ('DoD-urgent-test', 'issue', 'P0', 'pending_review')
  RETURNING id" | tr -d ' ')
echo "插入 atom_id: $ATOM_ID"

# Step 2: 运行 triage（需等 tick 或手动触发）
echo "等待 triage 运行（最长 5 分钟），或手动触发..."

# Step 3: 验证 task 创建
TASK_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT count(*) FROM tasks
  WHERE title LIKE '[紧急]%' AND created_at > now()-interval '10 min'")
echo "新增紧急 task 数: $TASK_COUNT"
[ "$TASK_COUNT" -ge "1" ] && echo "PASS" || echo "FAIL: tasks 表未增加紧急任务"

# Step 4: 验证 atom 回链
psql "$DATABASE_URL" -c "
  SELECT status, routed_to_table, routed_to_id
  FROM capture_atoms WHERE id = '$ATOM_ID'"
```

**判定标准**: tasks 增加 title LIKE '[紧急]%' 记录；atom.routed_to_table='tasks'

---

### [BEHAVIOR-3] okr 路由写入 notes 表而非死胡同

**描述**: capture_atom 分诊为 okr 时，系统自动写入 notes 表（category='strategic_input'），atom 携带回链。

**manual:bash**:
```bash
# Step 1: 验证 notes 表 okr 路由写入
# 需先有一条 okr 路由的 atom（通过 triage 运行）
NOTE_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT count(*) FROM notes
  WHERE category = 'strategic_input'
  AND created_at > now()-interval '10 min'")
echo "近 10 分钟 strategic_input notes 数: $NOTE_COUNT"

# 验证 atom 回链
psql "$DATABASE_URL" -c "
  SELECT a.id, a.status, a.routed_to_table, a.routed_to_id
  FROM capture_atoms a
  WHERE a.routed_to_table = 'notes'
  ORDER BY a.created_at DESC LIMIT 5"

# 判断
[ "$NOTE_COUNT" -ge "1" ] && echo "PASS" || echo "FAIL: notes 表无 strategic_input 新条目（可能无 okr atom 触发）"
```

**判定标准**: notes 表有 category='strategic_input' 记录；atom 含 routed_to_table='notes'

---

### [BEHAVIOR-4] capture-aging 账龄哨兵正确重试和转 parked

**描述**: aging 哨兵对 llm_failed atom 执行 ≤3 次重试，超限转 parked，返回计数指标。

**manual:bash**:
```bash
# Step 1: 插入 retry_count=0 的 llm_failed atom
ATOM_A=$(psql "$DATABASE_URL" -t -c "
  INSERT INTO capture_atoms (content, status, ai_reason, retry_count)
  VALUES ('aging-test-retry', 'pending_review', '[triage:llm_failed] test error', 0)
  RETURNING id" | tr -d ' ')
echo "测试 atom A (retry=0): $ATOM_A"

# Step 2: 插入 retry_count=3 的 llm_failed atom（应转 parked）
ATOM_B=$(psql "$DATABASE_URL" -t -c "
  INSERT INTO capture_atoms (content, status, ai_reason, retry_count)
  VALUES ('aging-test-max', 'pending_review', '[triage:llm_failed] max retry', 3)
  RETURNING id" | tr -d ' ')
echo "测试 atom B (retry=3): $ATOM_B"

# Step 3: 手动触发 aging（或等 tick）
node -e "
const { runCaptureAging } = require('./packages/brain/src/capture-aging.js');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
runCaptureAging(pool).then(r => { console.log('aging result:', r); pool.end(); });
"

# Step 4: 验证 atom A 重试
psql "$DATABASE_URL" -c "
  SELECT id, status, ai_reason, retry_count
  FROM capture_atoms WHERE id = '$ATOM_A'"
# 期望: retry_count=1, ai_reason=NULL

# Step 5: 验证 atom B 转 parked
psql "$DATABASE_URL" -c "
  SELECT id, status, ai_reason, retry_count
  FROM capture_atoms WHERE id = '$ATOM_B'"
# 期望: status='parked', ai_reason='[aging:max_retry_parked]'
```

**判定标准**: retry_count=0 atom → retry_count=1 + ai_reason=NULL；retry_count=3 atom → status='parked'

---

### [BEHAVIOR-5] Dashboard /inbox 页漏斗计数渲染正常

**描述**: mac_web Playwright 访问 /inbox 页，漏斗磁贴显示各阶段计数，列表展示条目，详情抽屉可打开。

**manual:bash**:
```bash
# 运行 Playwright E2E 测试
npx playwright test sprints/07200850-relay-07b2fd3b/tests/inbox-e2e.spec.ts \
  --reporter=line \
  --project=chromium

# 手动截图验证
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/inbox');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'sprints/07200850-relay-07b2fd3b/screenshots/inbox-funnel.png', fullPage: true });
  const content = await page.textContent('body');
  const hasCaptured = content.includes('captured') || content.includes('clarified');
  console.log('漏斗文字检查:', hasCaptured ? 'PASS' : 'FAIL');
  await browser.close();
})();
"
```

**判定标准**: 页面含"captured"或"clarified"文字；至少一个计数值 > 0；点击条目后抽屉出现

---

### [BEHAVIOR-6] 积压 pending_review atoms 全部离开积压状态

**描述**: 运行 backfill-pending-review.js 脚本后，capture_atoms 表中 status='pending_review' 的记录数为 0。

**manual:bash**:
```bash
# Step 1: 记录当前积压数
BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM capture_atoms WHERE status='pending_review'" | tr -d ' ')
echo "运行前 pending_review 数: $BEFORE"

# Step 2: 运行 backfill 脚本
node packages/brain/src/scripts/backfill-pending-review.js

# Step 3: 验证清零
AFTER=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM capture_atoms WHERE status='pending_review'" | tr -d ' ')
echo "运行后 pending_review 数: $AFTER"
[ "$AFTER" = "0" ] && echo "PASS" || echo "FAIL: 仍有 $AFTER 条 pending_review"

# Step 4: 查看去向
psql "$DATABASE_URL" -c "
  SELECT status, count(*) FROM capture_atoms
  WHERE target_type IN ('handoff','learning','issue')
  GROUP BY status ORDER BY count DESC"
```

**判定标准**: 运行后 pending_review count = 0

---

### [BEHAVIOR-7] captures CRUD API 支持 reroute 和 drop 操作

**描述**: PATCH /api/brain/capture-atoms/:id/confirm 支持 action:reroute（清 ai_reason）和 action:drop（转 dropped）。

**manual:bash**:
```bash
# 获取一个 parked atom 的 id
ATOM_ID=$(psql "$DATABASE_URL" -t -c "
  SELECT id FROM capture_atoms WHERE status='parked' LIMIT 1" | tr -d ' ')
echo "测试 atom_id: $ATOM_ID"

# 测试 reroute（清 ai_reason）
REROUTE=$(curl -s -X PATCH "http://localhost:5221/api/brain/capture-atoms/$ATOM_ID/confirm" \
  -H "Content-Type: application/json" \
  -d '{"action":"reroute","nature":"learning"}')
echo "reroute 响应: $REROUTE"

# 验证 ai_reason 被清空
AI_REASON=$(psql "$DATABASE_URL" -t -c "
  SELECT ai_reason FROM capture_atoms WHERE id = '$ATOM_ID'" | tr -d ' ')
echo "ai_reason 清除后: '$AI_REASON'"
[ -z "$AI_REASON" ] && echo "PASS" || echo "FAIL: ai_reason 未清空"

# 测试 drop
ATOM_ID2=$(psql "$DATABASE_URL" -t -c "
  SELECT id FROM capture_atoms WHERE status='parked' AND id != '$ATOM_ID' LIMIT 1" | tr -d ' ')
curl -s -X PATCH "http://localhost:5221/api/brain/capture-atoms/$ATOM_ID2/confirm" \
  -H "Content-Type: application/json" \
  -d '{"action":"drop"}'

STATUS=$(psql "$DATABASE_URL" -t -c "
  SELECT status FROM capture_atoms WHERE id = '$ATOM_ID2'" | tr -d ' ')
[ "$STATUS" = "dropped" ] && echo "drop PASS" || echo "drop FAIL: status=$STATUS"
```

**判定标准**: reroute 后 ai_reason=NULL；drop 后 status='dropped'

---

## 代码质量 DoD

- [ ] `packages/brain/migrations/354_captures_envelope_fields.sql` 存在且可执行
- [ ] `packages/brain/migrations/355_capture_atoms_envelope_fields.sql` 存在且可执行
- [ ] `packages/brain/src/routes/captures.js` 存在，挂载到 routes.js
- [ ] `packages/brain/src/capture-inbox.js` 含 `pushCapture` 函数
- [ ] `packages/brain/src/capture-triage.js` urgent 分支建 task，okr 分支写 notes
- [ ] `packages/brain/src/capture-aging.js` 存在，含 `runCaptureAging` 导出
- [ ] `packages/brain/src/scheduler-jobs.js` 注册 `capture-aging` job
- [ ] `apps/dashboard/src/pages/InboxPage.tsx` 存在
- [ ] `apps/dashboard/src/App.tsx` 挂载 `/inbox` 路由
- [ ] `packages/brain/src/scripts/backfill-pending-review.js` 存在
- [ ] 所有新文件有对应测试骨架（sprints/07200850-relay-07b2fd3b/tests/）
- [ ] `grep -r "pushCaptureAtom" packages/brain/src/routes/` 无直接写 atoms 的旁路（handoff/learning/issue 调用点已改）
- [ ] `grep -r "PRODUCTION_SENSITIVE_PATTERN" packages/brain/src/` 仍存在

## CI DoD

- [ ] brain-ci.yml 通过（migration 不破坏现有测试）
- [ ] workspace-ci.yml 通过（Dashboard 构建无 TS 错误）
- [ ] E2E-4 Playwright 截图保存到 `sprints/07200850-relay-07b2fd3b/screenshots/inbox-funnel.png`

## 铁律 DoD

- [ ] I-1: captures 是唯一进箱入口（无旁路写 atoms 绕过 captures）
- [ ] I-2: 三个新 job（urgent task 创建/okr notes 写入/aging 哨兵）均有明确消费方
- [ ] I-4: aging job 返回 {overdue_captures, overdue_atoms, retried, parked_by_aging} 计数
- [ ] I-6: urgent/okr 路由均写 routed_to_table + routed_to_id
- [ ] I-8: urgent→tasks, okr→notes，无路由死胡同
- [ ] I-10: PRODUCTION_SENSITIVE_PATTERN 护栏在 urgent 分支保留
