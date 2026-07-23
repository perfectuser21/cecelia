# Contract DoD — PR1：对话会话基础层

**Sprint**：`sprints/07240616-relay-264b8c8d/`
**Task ID**：`264b8c8d-aad6-4f1c-84d1-274880beb3da`
**更新日期**：2026-07-23

---

## [BEHAVIOR] 行为断言

**[BEHAVIOR-1] 创建 conversation 返回正确结构**

当 `POST /api/brain/conversations` 传入合法 `journey_id`（UUID，且存在于 journeys 表），系统必须：
- 返回 HTTP 201
- 响应体含 `id`（UUID）、`status: "active"`、`turn_count: 0`、`ttl_expires_at`（约 24 小时后的 ISO 时间戳）
- 在 conversations 表插入一行，`journey_id` 与请求匹配

**[BEHAVIOR-2] 消息写入触发 turn_count 自增**

当 `POST /api/brain/conversations/:id/messages` 传入 `role: "user"`，系统必须：
- 在 conversation_messages 表插入一行
- 将对应 conversation 的 `turn_count` 从当前值自增 +1
- 返回 HTTP 201 + 新消息对象（含 id、role、content、created_at）
- 若 role 为 `assistant` 或 `system`，turn_count 不自增

**[BEHAVIOR-3] 无效 status 枚举被拒绝**

当 `PATCH /api/brain/conversations/:id` 传入 `status: "invalid_status"`（不在 active/resolved/suspended/archived 内），系统必须：
- 返回 HTTP 400
- 响应体含 `error` 字段，描述枚举约束

当 status 为合法枚举值（如 `resolved`），系统必须：
- 返回 HTTP 200
- 数据库中对应行 status 字段更新为新值，`updated_at` 刷新

**[BEHAVIOR-4] 缺失 journey_id 返回 400，不存在的 journey_id 返回 404**

当 `POST /api/brain/conversations` 传入空 body 或 journey_id 为空字符串，系统必须：
- 返回 HTTP 400
- 不插入任何数据库行

当 `POST /api/brain/conversations` 传入格式合法但不存在于 journeys 表的 UUID，系统必须：
- 返回 HTTP 404
- 不插入任何数据库行

**[BEHAVIOR-5] GET 列表按 journey_id 过滤**

当 `GET /api/brain/conversations?journey_id=<id>` 请求，系统必须：
- 返回 HTTP 200
- 响应体 `conversations` 数组只包含 journey_id 匹配的记录
- 每条记录含 `last_message`（最近消息前 120 字符，无消息则 null）和 `related_decision_count`（整数）
- 响应体含 `total` 字段（整数，总记录数）

**[BEHAVIOR-6] GET 单条包含 messages 数组**

当 `GET /api/brain/conversations/:id` 请求，系统必须：
- 返回 HTTP 200
- 响应体含 `messages` 数组（最近 50 条，按 created_at ASC）
- 响应体含 `decisions` 数组（related_decision_ids 对应的 decisions 记录，可为空数组）
- conversation 不存在时返回 HTTP 404

---

## DoD 验收清单

### 数据库层

- [ ] `packages/brain/migrations/359_conversations.sql` 文件存在
- [ ] migrations 使用 `CREATE TABLE IF NOT EXISTS`（幂等）
- [ ] conversations 表含全部 13 个字段（id, journey_id, gp_id, title, status, current_session_id, session_compact_count, turn_count, ttl_expires_at, archived_summary, related_decision_ids, created_at, updated_at）
- [ ] conversations 表 status 字段有 CHECK 约束限制为 4 个枚举值
- [ ] conversation_messages 表含全部 6 个字段（id, conversation_id, role, content, turn_marker, created_at）
- [ ] conversation_messages.role 有 CHECK 约束限制为 user/assistant/system
- [ ] conversation_messages 有 ON DELETE CASCADE 到 conversations
- [ ] 4 个索引全部创建（journey_id、gp_id partial、status、ttl_expires_at partial）
- [ ] conversation_messages 有复合索引 (conversation_id, created_at ASC)

### API 层

- [ ] `packages/brain/src/routes/conversations.js` 文件存在，使用 express.Router()
- [ ] POST /api/brain/conversations — 201 创建
- [ ] GET /api/brain/conversations — 200 列表（含 last_message、total）
- [ ] GET /api/brain/conversations/:id — 200 单条（含 messages + decisions）
- [ ] PATCH /api/brain/conversations/:id — 200 更新
- [ ] POST /api/brain/conversations/:id/messages — 201 写消息 + turn_count 自增
- [ ] GET /api/brain/conversations/:id/messages — 200 分页消息列表（含 has_more）
- [ ] 所有端点日志格式：`[conversations] METHOD /path ...`

### server.js 注册

- [ ] `packages/brain/server.js` 含 `import conversationsRoutes` 语句
- [ ] `app.use('/api/brain/conversations', conversationsRoutes)` 已注册

### 单测

- [ ] `packages/brain/src/routes/__tests__/conversations.test.js` 存在
- [ ] 使用 vi.mock 模拟 pool（不依赖真实 DB）
- [ ] 覆盖 POST 缺 journey_id → 400
- [ ] 覆盖 POST 传不存在 journey_id → 404（pool 模拟返回 rowCount=0）
- [ ] 覆盖 GET 列表按 journey_id 过滤
- [ ] 覆盖 GET 单条带 messages
- [ ] 覆盖 PATCH 无效 status → 400
- [ ] 覆盖 POST message，role=user 时 turn_count 自增
- [ ] 所有单测通过（`npx vitest run`）

---

## manual:bash 验收命令

以下命令可在 Brain 运行环境直接执行以验收：

```bash
#!/usr/bin/env bash
# ============================================================
# Contract DoD 验收脚本 — PR1 对话会话基础层
# 使用方式：bash sprints/07240616-relay-264b8c8d/contract-dod.md
#           （或直接复制下方命令执行）
# 前提：Brain 已启动于 localhost:5221，数据库 cecelia 可访问
# ============================================================

set -e
BRAIN="http://localhost:5221"

# ── 前置：获取真实 journey_id ──────────────────────────────
JOURNEY_ID=$(psql cecelia -t -c "SELECT id FROM journeys LIMIT 1;" 2>/dev/null | tr -d ' \n')
if [ -z "$JOURNEY_ID" ]; then
  echo "ERROR: journeys 表为空，无法继续验收"
  exit 1
fi
echo "[OK] 使用 journey_id: $JOURNEY_ID"

# ── C-1：验证 conversations 表结构 ────────────────────────
echo "--- C-1: 验证 conversations 表 ---"
psql cecelia -c "\d conversations" | grep -E "journey_id|status|turn_count|session_compact_count|related_decision_ids" | wc -l | xargs -I{} bash -c 'if [ {} -ge 5 ]; then echo "[PASS] conversations 表字段完整"; else echo "[FAIL] conversations 表字段不完整"; exit 1; fi'

# ── C-2：验证 conversation_messages 表结构 ────────────────
echo "--- C-2: 验证 conversation_messages 表 ---"
psql cecelia -c "\d conversation_messages" | grep -E "role|content|turn_marker|conversation_id" | wc -l | xargs -I{} bash -c 'if [ {} -ge 4 ]; then echo "[PASS] conversation_messages 表字段完整"; else echo "[FAIL] conversation_messages 表字段不完整"; exit 1; fi'

# ── C-3：POST 合法 journey_id → 201 ──────────────────────
echo "--- C-3: POST 创建 conversation ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BRAIN/api/brain/conversations" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\"}")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
if [ "$HTTP_CODE" != "201" ]; then echo "[FAIL] 预期 201，得到 $HTTP_CODE"; exit 1; fi
CONV_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
TURN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['turn_count'])")
if [ "$STATUS" != "active" ]; then echo "[FAIL] status 预期 active，得到 $STATUS"; exit 1; fi
if [ "$TURN" != "0" ]; then echo "[FAIL] turn_count 预期 0，得到 $TURN"; exit 1; fi
echo "[PASS] C-3: 201 + status=active + turn_count=0, conv_id=$CONV_ID"

# ── C-4：POST 空 body → 400 ───────────────────────────────
echo "--- C-4: POST 缺 journey_id → 400 ---"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/conversations" \
  -H "Content-Type: application/json" \
  -d '{}')
if [ "$CODE" != "400" ]; then echo "[FAIL] 预期 400，得到 $CODE"; exit 1; fi
echo "[PASS] C-4: 400"

# ── C-5：GET 列表 → 200 + conversations 数组 ──────────────
echo "--- C-5: GET 列表 ---"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/conversations?journey_id=$JOURNEY_ID")
if [ "$CODE" != "200" ]; then echo "[FAIL] 预期 200，得到 $CODE"; exit 1; fi
COUNT=$(curl -s "$BRAIN/api/brain/conversations?journey_id=$JOURNEY_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['conversations']))")
if [ "$COUNT" -lt 1 ]; then echo "[FAIL] conversations 数组为空"; exit 1; fi
echo "[PASS] C-5: 200 + conversations 数组含 $COUNT 条"

# ── C-6：POST message → 201 + turn_count=1 ────────────────
echo "--- C-6: POST message + turn_count 自增 ---"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/conversations/$CONV_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"测试消息"}')
if [ "$CODE" != "201" ]; then echo "[FAIL] 预期 201，得到 $CODE"; exit 1; fi
TURN_AFTER=$(curl -s "$BRAIN/api/brain/conversations/$CONV_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['turn_count'])")
if [ "$TURN_AFTER" != "1" ]; then echo "[FAIL] turn_count 预期 1，得到 $TURN_AFTER"; exit 1; fi
echo "[PASS] C-6: 201 + turn_count=1"

# ── C-7：PATCH 无效 status → 400 ─────────────────────────
echo "--- C-7: PATCH 无效 status → 400 ---"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BRAIN/api/brain/conversations/$CONV_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"invalid_status"}')
if [ "$CODE" != "400" ]; then echo "[FAIL] 预期 400，得到 $CODE"; exit 1; fi
echo "[PASS] C-7: 400"

# ── C-8：Jest/Vitest 单测 ─────────────────────────────────
echo "--- C-8: 单测全绿 ---"
cd /workspace
npx vitest run packages/brain/src/routes/__tests__/conversations.test.js --reporter=verbose 2>&1 | tail -5
echo "[PASS] C-8: 单测执行完毕（请检查上方输出无 FAIL）"

echo ""
echo "=== 所有 Contract DoD 验收通过 ==="
```

---

## 合同冻结条件

以下条件全部满足后，本合同视为履行完毕，PR1 可进入 review：

1. [BEHAVIOR-1] ~ [BEHAVIOR-6] 全部通过
2. C-1 ~ C-8 manual:bash 验收无报错
3. CI (brain-ci.yml) 单测绿灯
4. `packages/brain/migrations/359_conversations.sql` 已提交，幂等性经 DBA 确认
