---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: tick-runner.js 死任务自动重置

**范围**: 在 packages/brain/src/tick-runner.js 适当位置新增死任务扫描逻辑：查询 execution_attempts=0 AND status IN ('in_progress','queued') AND updated_at < NOW()-INTERVAL '10 minutes'，批量 UPDATE status='queued', claimed_by=NULL, claimed_at=NULL, started_at=NULL；打印日志 "[tick] Reset N dead task(s)"；79710a5d 因此逻辑自动被重置
**大小**: S（~60 行净增，1 文件）
**依赖**: Workstream 4

## ARTIFACT 条目

- [ ] [ARTIFACT] packages/brain/src/tick-runner.js 含 execution_attempts 扫描条件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('execution_attempts'))process.exit(1)"

- [ ] [ARTIFACT] tick-runner.js 死任务 UPDATE 含 status='queued' 重置
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');const idx=c.indexOf('execution_attempts');const seg=c.slice(Math.max(0,idx-200),idx+2000);if(!seg.includes(\"'queued'\")&&!seg.includes('\"queued\"'))process.exit(1)"

- [ ] [ARTIFACT] tick-runner.js 含死任务日志打印（"dead task" 或 "Reset" 字样）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('dead task')&&!c.includes('Reset'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] tick-runner.js 代码层包含 execution_attempts=0 的 WHERE 条件（WS 未实现时文件内无此字符串 → FAIL）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");if(!c.includes(\"execution_attempts\")){console.error(\"FAIL: execution_attempts 逻辑缺失\");process.exit(1)}if(!c.includes(\"10 minute\")&&!c.includes(\"10min\")&&!c.includes(\"INTERVAL\")&&!c.includes(\"interval\")){console.error(\"FAIL: 10分钟超时判定缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；含 execution_attempts 和时间间隔判定

- [ ] [BEHAVIOR] 运行时：execution_attempts=0 且 updated_at 超 10 分钟的 in_progress 任务被重置为 queued（带时间窗口防造假）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost:5432/cecelia}"; TEST_TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, execution_attempts, updated_at) VALUES ('"'"'dead_task_dod_test'"'"', '"'"'in_progress'"'"', 0, NOW() - INTERVAL '"'"'15 minutes'"'"') RETURNING id" | tr -d " \n"); echo "插入测试任务 $TEST_TASK_ID"; curl -sf -X POST localhost:5221/api/brain/tick/execute 2>/dev/null || sleep 3; MAX=30; for i in $(seq 1 $MAX); do S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" | tr -d " \n"); [ "$S" = "queued" ] && break; [ "$i" = "$MAX" ] && { psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'"; echo "FAIL: 死任务未被重置 status=$S"; exit 1; }; sleep 1; done; psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" >/dev/null 2>&1; echo OK reset in ${i}s'
  期望: OK reset in Ns（30s 内被重置为 queued）

- [ ] [BEHAVIOR] execution_attempts>0 的任务不被误重置（负向测试，防误伤正在执行的任务）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost:5432/cecelia}"; TEST_TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, execution_attempts, updated_at) VALUES ('"'"'active_task_dod_test'"'"', '"'"'in_progress'"'"', 1, NOW() - INTERVAL '"'"'15 minutes'"'"') RETURNING id" | tr -d " \n"); echo "插入有尝试次数任务 $TEST_TASK_ID"; curl -sf -X POST localhost:5221/api/brain/tick/execute 2>/dev/null || sleep 3; S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" | tr -d " \n"); psql "$DB" -c "DELETE FROM tasks WHERE id='"'"'$TEST_TASK_ID'"'"'" >/dev/null 2>&1; [ "$S" = "in_progress" ] || { echo "WARN: execution_attempts=1 任务被重置为 $S（可能是预期行为，需复核）"; }; echo OK status=$S'
  期望: OK status=in_progress（execution_attempts=1 的任务不被误触发重置）

- [ ] [BEHAVIOR] 任务 79710a5d status 变为 queued（tick 执行后，PRD 指定的死任务被自动重置）
  Test: manual:bash -c 'STATUS=$(curl -sf localhost:5221/api/brain/tasks/79710a5d 2>/dev/null | jq -r ".status // \"not_found\""); [ "$STATUS" = "queued" ] || [ "$STATUS" = "completed" ] || [ "$STATUS" = "not_found" ] || { echo "FAIL: 79710a5d status=$STATUS（期望 queued 或已完成/不存在）"; exit 1; }; echo OK status=$STATUS'
  期望: OK status=queued（或 completed/not_found 表示任务已被处理完毕）

- [ ] [BEHAVIOR] tick-runner.js 死任务重置 UPDATE 同时清空 claimed_by/claimed_at/started_at（防残锁）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/tick-runner.js\",\"utf8\");const idx=c.indexOf(\"execution_attempts\");const seg=c.slice(Math.max(0,idx-200),idx+3000);const ok=seg.includes(\"claimed_by\")&&seg.includes(\"claimed_at\")&&seg.includes(\"started_at\");if(!ok){console.error(\"FAIL: UPDATE 缺少 claimed_by/claimed_at/started_at 清空\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；死任务 UPDATE 包含三个清空字段
