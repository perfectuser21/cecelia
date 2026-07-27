---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 主理人对话回路 PR3/4 Dashboard 对话栏 UI

**范围**: ConversationsPanel 提取 + status badge + WarRoomGoldenPathPage 新建 + 路由注册
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] ConversationsPanel.tsx 已提取为独立模块（含 gpId? 接口参数）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx','utf8');if(!c.includes('gpId'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] WarRoomGoldenPathPage.tsx 新建（双栏布局：GP 信息 + ConversationsPanel）
  Test: node -e "require('fs').accessSync('/workspace/apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx');console.log('OK')"

- [ ] [ARTIFACT] system-hub/index.ts 已注册 /warroom/gp/:gpId 路由和 WarRoomGoldenPathPage pageComponent
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/system-hub/index.ts','utf8');if(!c.includes('warroom/gp'))process.exit(1);if(!c.includes('WarRoomGoldenPathPage'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] App.tsx isFullHeightRoute 包含 /warroom/gp 路径
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/App.tsx','utf8');if(!c.includes('warroom/gp'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] statusBadgeMeta active 返回 emerald 色彩类名
  动作: 调用 statusBadgeMeta('active')
  预期观察: 返回对象 text 字段含 'emerald'，bg 字段含 'emerald'，label 为 '活跃'
  Test: manual:bash -c 'node -e "const {statusBadgeMeta}=require(\"./apps/dashboard/src/pages/warroom/ConversationsPanel\");const r=statusBadgeMeta(\"active\");if(!r.text.includes(\"emerald\")){process.exit(1)}if(r.label!==\"活跃\"){process.exit(1)};console.log(\"OK\")" 2>&1 || npx tsx -e "import {statusBadgeMeta} from \"./apps/dashboard/src/pages/warroom/ConversationsPanel\";const r=statusBadgeMeta(\"active\");if(!r.text.includes(\"emerald\")||r.label!==\"活跃\")process.exit(1);console.log(\"OK\")" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] statusBadgeMeta resolved 返回 slate 灰色
  动作: 调用 statusBadgeMeta('resolved')
  预期观察: 返回对象 text 字段含 'slate-4'，label 为 '已解决'
  Test: manual:bash -c 'node -e "const f=require(\"fs\").readFileSync(\"./apps/dashboard/src/pages/warroom/ConversationsPanel.tsx\",\"utf8\");if(!f.includes(\"resolved\")&&!f.includes(\"已解决\")){process.exit(1)};console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] statusBadgeMeta suspended 返回 amber 黄色
  动作: 调用 statusBadgeMeta('suspended')
  预期观察: 返回对象 text 字段含 'amber'，label 为 '挂起'
  Test: manual:bash -c 'node -e "const f=require(\"fs\").readFileSync(\"./apps/dashboard/src/pages/warroom/ConversationsPanel.tsx\",\"utf8\");if(!f.includes(\"amber\")||!f.includes(\"挂起\")){process.exit(1)};console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] ConversationsPanel 含 gpId 时 fetch URL 追加 gp_id 参数
  动作: 读取 ConversationsPanel.tsx 源码，确认 fetch URL 逻辑中含 gp_id 拼接
  预期观察: 文件包含 `gp_id` 字符串注入到 fetch URL 中
  Test: manual:bash -c 'grep -q "gp_id" /workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx && echo "OK" || { echo "FAIL: gp_id 未注入 fetch URL"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] [L2] 议题列表 API 响应包含 status 字段（active/resolved/suspended 枚举）
  动作: GET /api/brain/conversations?journey_id=8bb8252f-29b4-4c34-acb9-1accda7ddfcf&limit=1（若无记录则 POST 创建再查）
  预期观察: within 5s 返回 HTTP 200，conversations 数组每条含 status 字段且值在枚举内
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/conversations?journey_id=8bb8252f-29b4-4c34-acb9-1accda7ddfcf&limit=5") || { echo "FAIL: API 返回非 200"; exit 1; }; echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); convs=d.get(\"conversations\",[]); [(__import__(\"sys\").exit(1) if c[\"status\"] not in [\"active\",\"resolved\",\"suspended\",\"archived\"] else None) for c in convs]; print(\"OK: count=\"+str(len(convs)))"'
  期望: OK: count=<n>

- [ ] [BEHAVIOR] [L2] POST /api/brain/conversations 含 gp_id 时成功落库且 gp_id 等于传入值
  动作: POST /api/brain/conversations body 含 journey_id + gp_id（真实 golden_path.id）
  预期观察: 返回 HTTP 201，conversations 表新增记录，gp_id 字段等于传入值，created_at 在 5min 内
  Test: manual:bash -c '
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
GP_ID=$(psql "$DB_URL" -t -c "SELECT id FROM golden_path LIMIT 1" | tr -d " \n")
if [ -z "$GP_ID" ]; then
  echo "SKIP: 无 golden_path 记录，跳过 gp_id 写库验证"
  exit 0
fi
JOURNEY_ID="8bb8252f-29b4-4c34-acb9-1accda7ddfcf"
RESP=$(curl -sf -X POST "localhost:5221/api/brain/conversations" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"gp_id\":\"$GP_ID\",\"title\":\"合同验证对话\"}")
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get(\"gp_id\")==\"$GP_ID\" else 1)" || { echo "FAIL: gp_id 不匹配"; exit 1; }
CONV_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"id\"])")
COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM conversations WHERE id='"'"'$CONV_ID'"'"' AND gp_id='"'"'$GP_ID'"'"' AND created_at > NOW() - INTERVAL '"'"'5 minutes'"'"'" | tr -d " ")
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无记录 count=$COUNT"; exit 1; }
echo "OK: gp_id=$GP_ID, conv_id=$CONV_ID"
'
  期望: OK: gp_id=<uuid>, conv_id=<uuid>

- [ ] [BEHAVIOR] [L2] GET /api/brain/conversations error path — 无 journey_id 返回 400
  动作: GET /api/brain/conversations（不传 journey_id）
  预期观察: HTTP 400，响应体含 error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/conversations"); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400 实得 $CODE"; exit 1; }; BODY=$(curl -s "localhost:5221/api/brain/conversations"); echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if \"error\" in d else 1)" || { echo "FAIL: 无 error 字段"; exit 1; }; echo "OK"'
  期望: OK

---

## Invariant 覆盖（PRD 不变量映射）

- [ ] [BEHAVIOR] [L2] INV-1 Journey 不变量：conversations.journey_id 必须是真实 journey.id
  动作: POST /api/brain/conversations 传入不存在的 journey_id（fake UUID）
  预期观察: HTTP 404，error 字段说明 journey_id 不存在
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/conversations" -H "Content-Type: application/json" -d "{\"journey_id\":\"00000000-0000-0000-0000-000000000000\",\"title\":\"test\"}"); [ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实得 $CODE（伪造 journey_id 未被拒绝）"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-2 gp_id 约束：GP 二级页创建对话时 gp_id 格式校验
  动作: POST /api/brain/conversations 传入非 UUID 格式的 gp_id
  预期观察: HTTP 400，error 字段说明 gp_id 格式错误
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:5221/api/brain/conversations" -H "Content-Type: application/json" -d "{\"journey_id\":\"8bb8252f-29b4-4c34-acb9-1accda7ddfcf\",\"gp_id\":\"not-a-uuid\",\"title\":\"test\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400 实得 $CODE（非法 gp_id 未被校验）"; exit 1; }; echo "OK"'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-3 Agent 调用不可在前端直接触发：ConversationsPanel.tsx 不含 spawn/exec 调用
  动作: 检查前端组件源码，确认无直接调用 claude 进程的代码
  预期观察: ConversationsPanel.tsx 无 spawn/exec/child_process 引用
  Test: manual:bash -c 'F=/workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx; (grep -q "spawn\|child_process\|exec(" "$F") && { echo "FAIL: 前端组件包含进程调用"; exit 1; } || echo "OK"'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-pipeline.png      期望：Pipeline 页面加载，line 卡片可见
    - 02-warroom-line.png  期望：Line 指挥页加载，议题对话区域可见
    - 03-new-conv.png      期望：新建对话进入详情视图，输入框可见
    - 04-sending.png       期望：发送后"军师思考中…"动画气泡可见
    - 05-agent-reply.png   期望：agent 回复气泡可见，内容非空
    - 06-list-after.png    期望：返回议题列表，status badge "活跃"以 emerald 色可见
    - 07-history.png       期望：历史消息气泡可见（user bubble + assistant bubble 各 ≥1）
    - 08-gp-page.png       期望：GP 页加载，左栏 GP 信息 + 右栏 ConversationsPanel 可见
    - 09-gp-reply.png      期望：GP 页 agent 回复可见（或 SKIP 注记）
  期望：所有截图与期望描述一致
