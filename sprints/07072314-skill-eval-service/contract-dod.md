# DoD：Skill Evaluator 内部验收台（形态B）thin 贯穿

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
propose_round: 2

---

## [ARTIFACT] 产出物

[ARTIFACT-1] Brain 新增路由文件 `packages/brain/src/routes/eval.js`，实现 `POST /api/eval/upload` + `GET /api/eval/tasks/:id` 两个端点，集成进 `server.js`

[ARTIFACT-2] Brain tick 新增 `skill_eval` 任务派发逻辑（单 slot 串行，`MAX_CONCURRENT_SKILL_EVAL=1`），调用 `docker-executor.js` 以 `account2` 执行评估，含额度预检（5h<85% / 7d<90%）

[ARTIFACT-3] HK Caddy 配置段（`location /eval-api/`）：Basic Auth 验证 + `X-Eval-Proxy-Token` 注入 + 反向代理至 Brain；及 `/skill-eval/` 静态目录挂载（含最小上传表单 `index.html`）

[ARTIFACT-4] 最小上传页 `apps/dashboard/public/skill-eval/index.html`（或 HK 静态目录）：zip 拖拽表单 + skill_name/platform/line 必填 + 前端预校验（≤10MB/.zip 后缀/必填齐）+ 队列位次展示 + 5s 退避轮询 + "查看报告"按钮

[ARTIFACT-5] 报告 SSH 发布脚本/Brain 内联逻辑：评估完成后 rsync 至 HK `/data/docs/skill-evals/<task短码>-<名slug>/`，追加 `index.html` 条目，Brain 回写 `report_url` + `status=completed`；失败路径释放 slot + 飞书告警（10min 聚合）

---

## [BEHAVIOR] 行为验证

[BEHAVIOR] 无令牌直打 Brain 上传端点返回 403
Test: manual:bash
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
  http://localhost:5221/api/eval/upload)
[ "$CODE" = "403" ] || { echo "FAIL: 期望403,实得$CODE"; exit 1; }
echo "PASS"
```

[BEHAVIOR] 带正确令牌上传合法 zip 返回 200 含 task_id 和 position
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?需设置 EVAL_PROXY_TOKEN}"
RESP=$(curl -sf \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
  -F "skill_name=test-skill" -F "platform=claude" -F "line=Line00" \
  http://localhost:5221/api/eval/upload)
TASK_ID=$(echo "$RESP" | jq -r '.task_id')
POSITION=$(echo "$RESP" | jq -r '.position')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || { echo "FAIL: 无 task_id"; exit 1; }
[ -n "$POSITION" ] && [ "$POSITION" != "null" ] || { echo "FAIL: 无 position"; exit 1; }
# DB 时间窗验证
COUNT=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc "SELECT count(*) FROM tasks WHERE task_type='skill_eval' AND created_at > NOW() - interval '2 minutes'")
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无新建 skill_eval task"; exit 1; }
echo "PASS: task_id=$TASK_ID position=$POSITION"
```

[BEHAVIOR] 上传非 ZIP 文件（zip 魔数校验）返回 422
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?}"
echo "not a zip" > /tmp/fake.zip
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@/tmp/fake.zip" \
  -F "skill_name=fake" -F "platform=claude" -F "line=Line00" \
  http://localhost:5221/api/eval/upload)
[ "$CODE" = "422" ] || { echo "FAIL: 期望422,实得$CODE"; exit 1; }
echo "PASS"
```

[BEHAVIOR] GET /api/eval/tasks/:id 对已建任务返回结构含 status/report_url/failure_stage
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?}"
TASK_ID=$(curl -sf \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
  -F "skill_name=struct-test" -F "platform=claude" -F "line=Line00" \
  http://localhost:5221/api/eval/upload | jq -r '.task_id')
RESP=$(curl -sf "http://localhost:5221/api/eval/tasks/$TASK_ID")
echo "$RESP" | jq -e 'has("status") and has("report_url") and has("failure_stage")' > /dev/null \
  || { echo "FAIL: response 缺必要字段"; exit 1; }
STATUS=$(echo "$RESP" | jq -r '.status')
[[ "$STATUS" =~ ^(queued|in_progress|completed|failed)$ ]] \
  || { echo "FAIL: status 非法值 $STATUS"; exit 1; }
echo "PASS: status=$STATUS"
```

[BEHAVIOR] Brain tick 单 slot 串行：in_progress 状态的 skill_eval 任务最多 1 个
Test: manual:bash
```bash
COUNT=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc \
  "SELECT COUNT(*) FROM tasks WHERE task_type='skill_eval' AND status='in_progress'")
[ "$COUNT" -le 1 ] || { echo "FAIL: in_progress slot数=$COUNT,期望≤1"; exit 1; }
echo "PASS: in_progress=$COUNT"
```

[BEHAVIOR] 同一 zip 内容（SHA256 相同）二次上传命中去重，返回历史 task_id（dedup=true）
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?}"
UPLOAD() {
  curl -sf \
    -H "X-Eval-Proxy-Token: $TOKEN" \
    -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
    -F "skill_name=dedup-test" -F "platform=claude" -F "line=Line00" \
    http://localhost:5221/api/eval/upload
}
R1=$(UPLOAD); R2=$(UPLOAD)
TID1=$(echo "$R1" | jq -r '.task_id'); TID2=$(echo "$R2" | jq -r '.task_id')
DEDUP=$(echo "$R2" | jq -r '.dedup')
[ "$TID1" = "$TID2" ] || { echo "FAIL: 去重失效 tid1=$TID1 tid2=$TID2"; exit 1; }
[ "$DEDUP" = "true" ] || { echo "FAIL: dedup 字段非 true"; exit 1; }
echo "PASS: dedup=$DEDUP task_id=$TID1"
```

[BEHAVIOR] 评估完成后报告 SSH 发布 HK + 索引页含 task_id 条目（需 HK 环境）
Test: manual:bash
```bash
# [logic-done-pending] 需真实 HK 服务器 SSH 访问，CI 阶段 skip，Final E2E 执行
TASK_ID="${1:?需传入 task_id}"
ssh hk-vps "ls /data/docs/skill-evals/ | grep '$TASK_ID'" \
  || { echo "FAIL: HK 无该 task 目录"; exit 1; }
ssh hk-vps "grep '$TASK_ID' /data/docs/skill-evals/index.html" \
  || { echo "FAIL: 索引无该条目"; exit 1; }
echo "PASS: HK 目录+索引均有 $TASK_ID"
```

[BEHAVIOR] 评估完成报告永久可访问（report_url 持久有效）
Test: manual:bash
```bash
# [logic-done-pending] 需已完成的 task 和 HK 真实环境
TASK_ID="${COMPLETED_TASK_ID:?}"
REPORT_URL=$(curl -sf "http://localhost:5221/api/eval/tasks/$TASK_ID" | jq -r '.report_url')
[ -n "$REPORT_URL" ] && [ "$REPORT_URL" != "null" ] || { echo "FAIL: report_url 为空"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" -u "$DOCS_BASIC_AUTH" "$REPORT_URL")
[ "$CODE" = "200" ] || { echo "FAIL: report_url 返回 $CODE"; exit 1; }
echo "PASS: report_url=$REPORT_URL"
```
