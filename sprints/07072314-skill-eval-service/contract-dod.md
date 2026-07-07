# DoD：Skill Evaluator 内部验收台（形态B）thin 贯穿

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
propose_round: 1

---

## [ARTIFACT] 产出物

[ARTIFACT-1] Brain 新增路由文件 `packages/brain/src/routes/eval.js`，实现 `POST /api/eval/upload` + `GET /api/eval/tasks/:id` 两个端点，集成进 `server.js`

[ARTIFACT-2] Brain tick 新增 `skill_eval` 任务派发逻辑（单 slot 串行，`MAX_CONCURRENT_SKILL_EVAL=1`），调用 `docker-executor.js` 以 `account2` 执行评估，含额度预检（5h<85% / 7d<90%）

[ARTIFACT-3] HK Caddy 配置段（`location /eval-api/`）：Basic Auth 验证 + `X-Eval-Proxy-Token` 注入 + 反向代理至 Brain；及 `/skill-eval/` 静态目录挂载（含最小上传表单 `index.html`）

[ARTIFACT-4] 最小上传页 `apps/dashboard/public/skill-eval/index.html`（或 HK 静态目录）：zip 拖拽表单 + skill_name/platform/line 必填 + 前端预校验（≤10MB/.zip 后缀/必填齐）+ 队列位次展示 + 5s 退避轮询 + "查看报告"按钮

[ARTIFACT-5] 报告 SSH 发布脚本/Brain 内联逻辑：评估完成后 rsync 至 HK `/data/docs/skill-evals/<task短码>-<名slug>/`，追加 `index.html` 条目，Brain 回写 `report_url` + `status=completed`；失败路径释放 slot + 飞书告警（10min 聚合）

---

## [BEHAVIOR] 行为验证

[BEHAVIOR-1] 无令牌直打 Brain 上传端点返回 403
Test: manual:bash
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
  http://localhost:5221/api/eval/upload)
[ "$CODE" = "403" ] && echo "PASS" || echo "FAIL (got $CODE)"
```

[BEHAVIOR-2] 带正确令牌上传合法 zip 返回 200 含 task_id 和 position
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?需设置 EVAL_PROXY_TOKEN}"
RESP=$(curl -sf \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
  -F "skill_name=test-skill" -F "platform=claude" -F "line=Line00" \
  http://localhost:5221/api/eval/upload)
echo "$RESP" | jq -e '.task_id' && echo "$RESP" | jq -e '.position' && echo "PASS" || echo "FAIL"
```

[BEHAVIOR-3] 上传非 ZIP 文件（zip 魔数校验）返回 422
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?}"
echo "not a zip" > /tmp/fake.zip
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@/tmp/fake.zip" \
  -F "skill_name=fake" -F "platform=claude" -F "line=Line00" \
  http://localhost:5221/api/eval/upload)
[ "$CODE" = "422" ] && echo "PASS" || echo "FAIL (got $CODE)"
```

[BEHAVIOR-4] GET /api/eval/tasks/:id 对已建任务返回结构含 status/report_url/failure_stage
Test: manual:bash
```bash
TOKEN="${EVAL_PROXY_TOKEN:?}"
TASK_ID=$(curl -sf \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@sprints/07072314-skill-eval-service/tests/fixtures/valid-skill.zip" \
  -F "skill_name=dod-test" -F "platform=claude" -F "line=Line00" \
  http://localhost:5221/api/eval/upload | jq -r '.task_id')
RESP=$(curl -sf "http://localhost:5221/api/eval/tasks/$TASK_ID")
echo "$RESP" | jq -e '.status' && \
echo "$RESP" | jq 'has("report_url")' | grep -q true && \
echo "$RESP" | jq 'has("failure_stage")' | grep -q true && \
echo "PASS" || echo "FAIL"
```

[BEHAVIOR-5] Brain tick 单 slot 串行：in_progress 状态的 skill_eval 任务最多 1 个
Test: manual:bash
```bash
COUNT=$(psql $DATABASE_URL -At -c \
  "SELECT COUNT(*) FROM tasks WHERE task_type='skill_eval' AND status='in_progress'")
[ "$COUNT" -le "1" ] && echo "PASS (in_progress=$COUNT)" || echo "FAIL (in_progress=$COUNT, expected ≤1)"
```

[BEHAVIOR-6] 同一 zip 内容（SHA256 相同）二次上传命中去重，返回历史 task_id（dedup=true）
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
[ "$TID1" = "$TID2" ] && [ "$DEDUP" = "true" ] && echo "PASS" || echo "FAIL (tid1=$TID1 tid2=$TID2 dedup=$DEDUP)"
```

[BEHAVIOR-7] 评估完成后报告 SSH 发布 HK + 索引页含 task_id 条目（需 HK 环境）
Test: manual:bash
```bash
# 需在能 SSH 到 HK 服务器且 Brain 已配置 SSH key 的环境下执行
TASK_ID="${1:?需传入 task_id}"
ssh hk-vps "ls /data/docs/skill-evals/ | grep $TASK_ID" && echo "PASS:dir-exists" || echo "FAIL:dir-missing"
ssh hk-vps "grep '$TASK_ID' /data/docs/skill-evals/index.html" && echo "PASS:index-entry" || echo "FAIL:index-missing"
```
