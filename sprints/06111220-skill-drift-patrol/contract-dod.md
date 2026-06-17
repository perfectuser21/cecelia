---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: skill-drift 巡检告警（smoke 注册 + 日巡消费者）

**范围**: packages/brain/ 后端巡检模块（patrol cron + DB 落库 + patrol-history API + smoke 更新）
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/scripts/smoke/skill-drift-smoke.sh` 存在且含 `snapshot_version` 非 null 断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/skill-drift-smoke.sh','utf8');if(!c.includes('snapshot_version'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/cron/skill-drift-patrol.js` 存在且含 `raise` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/cron/skill-drift-patrol.js','utf8');if(!c.includes(\"raise('P1'\"))&&!c.includes('raise(\"P1\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/tick-runner.js` 含 skill-drift-patrol 模块导入
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('skill-drift-patrol'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `/patrol-history` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('patrol-history'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] DB migration 文件存在（`packages/brain/migrations/301_skill_drift_alerts.sql` 或更高编号）
  Test: bash -c 'f=$(find packages/brain/migrations -name "*skill_drift*" -type f 2>/dev/null | head -1); [ -n "$f" ] && echo "OK: $f" || { echo FAIL; exit 1; }'

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] smoke 脚本 exit 0（Brain 健康无漂移时）
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/skill-drift-smoke.sh && echo OK || exit 1'
  期望: exit 0，输出含 "FAIL: 0"

- [ ] [BEHAVIOR] smoke 脚本含 snapshot_version 非 null 检测（PRD 边界：任一 null → FAIL）
  Test: manual:bash -c 'grep -q "snapshot_version" packages/brain/scripts/smoke/skill-drift-smoke.sh && echo OK || { echo "FAIL: 缺 snapshot_version 断言"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] `GET /api/brain/harness/skill-drift/patrol-history` 返回 HTTP 200 + alerts 数组
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift/patrol-history); echo "$RESP" | jq -e ".alerts | type == \"array\"" && echo "$RESP" | jq -e "keys == [\"alerts\"]" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `GET /api/brain/harness/skill-drift/patrol-history` schema 完整性（id + skill_name + ssot_version + snapshot_version + drift_date + detected_at，空列表时跳过字段检查）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift/patrol-history); LEN=$(echo "$RESP" | jq ".alerts | length"); if [ "$LEN" -gt 0 ]; then echo "$RESP" | jq -e ".alerts[0] | has(\"id\") and has(\"skill_name\") and has(\"ssot_version\") and has(\"snapshot_version\") and has(\"drift_date\") and has(\"detected_at\")" || exit 1; fi; echo OK'
  期望: OK（有记录时全部 6 字段齐全）

- [ ] [BEHAVIOR] `patrol-history` 禁用字段不出现（`alert_id`, `name`, `date`, `time` — 全部 4 个禁用名）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/harness/skill-drift/patrol-history); LEN=$(echo "$RESP" | jq ".alerts | length"); if [ "$LEN" -gt 0 ]; then echo "$RESP" | jq -e ".alerts[0] | has(\"alert_id\") | not" || exit 1; echo "$RESP" | jq -e ".alerts[0] | has(\"name\") | not" || exit 1; echo "$RESP" | jq -e ".alerts[0] | has(\"date\") | not" || exit 1; echo "$RESP" | jq -e ".alerts[0] | has(\"time\") | not" || exit 1; fi; echo OK'
  期望: OK（4 个禁用字段均未出现）

- [ ] [BEHAVIOR] 制造漂移 → 触发巡检 → `skill_drift_alerts` 写入记录（带时间窗口防造假）
  Test: manual:bash -c 'SNAP="packages/workflows/skills/harness-planner/SKILL.md"; ORIG=$(grep -m1 "^version:" "$SNAP" | sed "s/version: *//"); sed -i "s/^version:.*/version: 9999.0.0-dod-test/" "$SNAP"; curl -s -o /dev/null -X POST localhost:5221/api/brain/harness/skill-drift/patrol-trigger 2>/dev/null || true; sleep 5; COUNT=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM skill_drift_alerts WHERE skill_name='"'"'harness-planner'"'"' AND detected_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); sed -i "s/^version:.*/version: $ORIG/" "$SNAP"; [ "$COUNT" -ge 1 ] && echo OK || { echo "FAIL count=$COUNT"; exit 1; }'
  期望: OK（count ≥ 1，5 分钟内写入）

- [ ] [BEHAVIOR] 同一 skill + drift_date 重复触发不新增记录（按日去重）
  Test: manual:bash -c 'BEFORE=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM skill_drift_alerts WHERE drift_date = CURRENT_DATE" | tr -d " "); curl -s -o /dev/null -X POST localhost:5221/api/brain/harness/skill-drift/patrol-trigger 2>/dev/null || true; sleep 3; AFTER=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM skill_drift_alerts WHERE drift_date = CURRENT_DATE" | tr -d " "); [ "$AFTER" -eq "$BEFORE" ] && echo "OK dedup BEFORE=$BEFORE AFTER=$AFTER" || { echo "FAIL 重复新增 BEFORE=$BEFORE AFTER=$AFTER"; exit 1; }'
  期望: OK（无新增）

- [ ] [BEHAVIOR] error path — `patrol-history` 非 GET 方法返回 4xx
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/harness/skill-drift/patrol-history); [ "$CODE" = "404" ] || [ "$CODE" = "405" ] || [ "$CODE" = "400" ] || { echo "FAIL: POST 返回 $CODE"; exit 1; }; echo OK'
  期望: OK（POST → 非 200）
