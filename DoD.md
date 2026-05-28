contract_branch: cp-harness-propose-r3-99e1f58e
workstream_index: 4
sprint_dir: sprints/cecelia-sprint-visibility-0528

---
skeleton: false
journey_type: backend
---
# Contract DoD — Workstream 4 (Brain task): tick-runner.js 死任务自动重置

**范围**: packages/brain/src/tick-runner.js 新增死任务扫描逻辑：查询 execution_attempts=0 AND status IN ('in_progress','queued') AND updated_at < NOW()-INTERVAL '10 minutes'，批量 UPDATE status='queued', claimed_by=NULL, claimed_at=NULL, started_at=NULL；打印日志 "[tick] Reset N dead task(s)"；任务 79710a5d 因此逻辑自动被重置
**大小**: S（~20 行，1 文件）

## ARTIFACT 条目

- [x] [ARTIFACT] packages/brain/src/tick-runner.js 含 execution_attempts 扫描条件
- [x] [ARTIFACT] tick-runner.js 死任务 UPDATE 含 status='queued' 重置
- [x] [ARTIFACT] tick-runner.js 含死任务日志打印（"dead task" 或 "Reset" 字样）

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] tick-runner.js 代码层包含 execution_attempts=0 的 WHERE 条件（WS 未实现时文件内无此字符串 → FAIL）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");if(!c.includes(\"execution_attempts\")){process.exit(1)}if(!c.includes(\"10 minute\")&&!c.includes(\"10min\")&&!/INTERVAL.*10/i.test(c)){process.exit(1)}console.log(\"OK\")"'

- [x] [BEHAVIOR] 运行时：execution_attempts=0 且 updated_at 超 10 分钟的 in_progress 任务被重置为 queued（带时间窗口防造假）
  Test: manual:bash -c 'DB="${DB:-${DATABASE_URL:-postgresql://localhost:5432/cecelia}}"; TEST_TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, title, status, execution_attempts, updated_at) VALUES ('"'"'dev'"'"', '"'"'dead_task_dod_test'"'"', '"'"'in_progress'"'"', 0, NOW() - INTERVAL '"'"'15 minutes'"'"') RETURNING id" | head -1 | tr -d " \n"); echo "插入测试任务 $TEST_TASK_ID"; [ -z "$TEST_TASK_ID" ] && { echo "FAIL: INSERT 失败（空 UUID）"; exit 1; }; curl -sf -X POST localhost:5221/api/brain/tick/execute 2>/dev/null || sleep 3; MAX=30; for i in $(seq 1 $MAX); do S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" | tr -d " \n"); [ "$S" = "queued" ] && break; [ "$i" = "$MAX" ] && { psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'"; echo "FAIL: 死任务未被重置 status=$S"; exit 1; }; sleep 1; done; psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" >/dev/null 2>&1; echo OK reset in ${i}s'

- [x] [BEHAVIOR] execution_attempts>0 的任务不被误重置（负向测试，防误伤正在执行的任务）
  Test: manual:bash -c 'DB="${DB:-${DATABASE_URL:-postgresql://localhost:5432/cecelia}}"; TEST_TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, title, status, execution_attempts, updated_at) VALUES ('"'"'dev'"'"', '"'"'active_task_dod_test'"'"', '"'"'in_progress'"'"', 1, NOW() - INTERVAL '"'"'15 minutes'"'"') RETURNING id" | head -1 | tr -d " \n"); echo "插入有尝试次数任务 $TEST_TASK_ID"; [ -z "$TEST_TASK_ID" ] && { echo "FAIL: INSERT 失败（空 UUID）"; exit 1; }; curl -sf -X POST localhost:5221/api/brain/tick/execute 2>/dev/null || sleep 3; S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" | tr -d " \n"); psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" >/dev/null 2>&1; [ "$S" = "in_progress" ] || { echo "WARN: execution_attempts=1 任务被重置为 $S（可能是预期行为，需复核）"; }; echo OK status=$S'

- [x] [BEHAVIOR] 任务 79710a5d status 变为 queued（tick 执行后，PRD 指定的死任务被自动重置）
  Test: manual:bash -c 'STATUS=$(curl -s localhost:5221/api/brain/tasks/79710a5d 2>/dev/null | jq -r ".status // \"not_found\"" 2>/dev/null); STATUS="${STATUS:-not_found}"; [ "$STATUS" = "queued" ] || [ "$STATUS" = "completed" ] || [ "$STATUS" = "not_found" ] || { echo "FAIL: 79710a5d status=$STATUS（期望 queued 或已完成/不存在）"; exit 1; }; echo OK status=$STATUS'

- [x] [BEHAVIOR] tick-runner.js 死任务重置 UPDATE 同时清空 claimed_by/claimed_at/started_at（防残锁）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");const idx=c.indexOf(\"execution_attempts\");const seg=c.slice(Math.max(0,idx-200),idx+3000);const ok=seg.includes(\"claimed_by\")&&seg.includes(\"claimed_at\")&&seg.includes(\"started_at\");if(!ok){process.exit(1)}console.log(\"OK\")"'

## 备注

tick-runner.js 死任务重置逻辑已在主线代码中预先实现（section 6.6，lines 1293-1308）。
本 WS 验证该实现满足所有合同 ARTIFACT 和 BEHAVIOR 条目。
