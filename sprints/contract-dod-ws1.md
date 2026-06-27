---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: harness 内部线 staging→promote→:5211 贯通验证（Round 4）

**范围**: 从 initiative 点火到 :5211 可访问的全链路单次端到端验证；仅检查 Brain DB 状态 + :5211 存活，不修复新发现 bug  
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] apps/dashboard/index.html 含 harness-pipeline-verify 2026-06-27 注释行
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/index.html','utf8');if(!c.includes('harness-pipeline-verify 2026-06-27'))process.exit(1)"

---

## BEHAVIOR 条目（manual:bash 可执行命令，evaluator 直接跑）

> **接缝标注**：以下 BEHAVIOR 1/2/3/4/5/6 均属「接缝断言」（环境相关：Brain DB + 宿主 :5211）。  
> evaluator 运行时 pipeline 必须已完成；若 staging_e2e_results 无记录则视为接缝未验，标 logic-done-pending，不得标 done。

- [x] [BEHAVIOR] apps/dashboard/index.html 触点注释存在（Generator 添加后方为真红→真绿）
  Test: manual:bash -c 'grep -q "harness-pipeline-verify 2026-06-27" apps/dashboard/index.html || { echo "FAIL: 触点注释不存在"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] initiative 无 failed 任务（60分钟时间窗，验证无死代码干预通道阻断）
  Test: manual:bash -c '[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }; DB="${DB:-postgresql://localhost/cecelia}"; C=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE payload->>'"'"'initiative_id'"'"' = '"'"'$INITIATIVE_ID'"'"' AND status='"'"'failed'"'"' AND created_at > NOW() - interval '"'"'60 minutes'"'"'" | tr -d " "); [ "$C" = "0" ] || { echo "FAIL: $C 个 failed 任务"; exit 1; }; echo OK'
  期望: OK（failed 数 = 0）

- [x] [BEHAVIOR] staging_e2e_results.verdict=PASS（带60分钟时间窗防历史数据冒充）
  Test: manual:bash -c '[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }; DB="${DB:-postgresql://localhost/cecelia}"; V=$(psql "$DB" -t -c "SELECT verdict FROM staging_e2e_results WHERE initiative_id='"'"'$INITIATIVE_ID'"'"' AND created_at > NOW() - interval '"'"'60 minutes'"'"'" | tr -d " "); [ "$V" = "PASS" ] || { echo "FAIL: verdict=$V"; exit 1; }; echo OK'
  期望: OK（verdict=PASS）

- [x] [BEHAVIOR] staging_e2e_results.promote_status=auto_promoted（Slice9 复合闸 + auto promote 验收）
  Test: manual:bash -c '[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }; DB="${DB:-postgresql://localhost/cecelia}"; S=$(psql "$DB" -t -c "SELECT promote_status FROM staging_e2e_results WHERE initiative_id='"'"'$INITIATIVE_ID'"'"'" | tr -d " "); [ "$S" = "auto_promoted" ] || { echo "FAIL: promote_status=$S（期望 auto_promoted）"; exit 1; }; echo OK'
  期望: OK（promote_status=auto_promoted）

- [x] [BEHAVIOR] staging_e2e_results.tested_sha 非空（Slice9 SHA 锚定验收）
  Test: manual:bash -c '[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }; DB="${DB:-postgresql://localhost/cecelia}"; SHA=$(psql "$DB" -t -c "SELECT tested_sha FROM staging_e2e_results WHERE initiative_id='"'"'$INITIATIVE_ID'"'"'" | tr -d " "); [ -n "$SHA" ] && [ "$SHA" != "NULL" ] || { echo "FAIL: tested_sha 为空"; exit 1; }; echo "OK: tested_sha=$SHA"'
  期望: OK: tested_sha=<非空 git SHA>

- [x] [BEHAVIOR] localhost:5211 HTTP 200 + 响应体非空（dashboard 重起成功）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5211/); [ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }; SZ=$(curl -sf http://localhost:5211/ | wc -c | tr -d " "); [ "$SZ" -gt 0 ] || { echo "FAIL: 响应体为空"; exit 1; }; echo "OK: HTTP 200 ${SZ} bytes"'
  期望: OK: HTTP 200 <N> bytes

- [x] [BEHAVIOR] harness_report 任务 status=completed（Slice3 派报告验收，60分钟时间窗防历史数据冒充）
  Test: manual:bash -c '[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }; DB="${DB:-postgresql://localhost/cecelia}"; S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE task_type='"'"'harness_report'"'"' AND payload->>'"'"'initiative_id'"'"' = '"'"'$INITIATIVE_ID'"'"' AND created_at > NOW() - interval '"'"'60 minutes'"'"'" | tr -d " "); [ "$S" = "completed" ] || { echo "FAIL: harness_report status=$S"; exit 1; }; echo OK'
  期望: OK（status=completed）
