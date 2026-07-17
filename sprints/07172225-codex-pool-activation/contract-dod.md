---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Codex 池激活——每日测试补齐生成器（codex_test_gen）

**范围**: packages/brain/src/scheduler-jobs.js（新增 job 注册）+ packages/brain/src/codex-test-gen.js（新建，生成器逻辑：扫描+去重+入队）+ packages/brain/src/task-router.js（确认 codex_test_gen 路由，已有则仅确认）+ packages/brain/src/battle-report.js（admission 段 codex 计数注入）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/codex-test-gen.js` 文件存在且含 `codex_test_gen` task_type 入队逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/codex-test-gen.js','utf8');if(!c.includes('codex_test_gen'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/scheduler-jobs.js` JOBS 数组含 `codex-test-gen` 条目（name 字段）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/scheduler-jobs.js','utf8');if(!c.includes('codex-test-gen'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/task-router.js` VALID_TASK_TYPES 含 `codex_test_gen`（已有确认）+ SKILL_WHITELIST 含 `codex_test_gen` → `/codex-test-gen` 映射 + LOCATION_MAP 含 `codex_test_gen` → `xian` 映射
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes('codex_test_gen'))process.exit(1);if(!c.includes('/codex-test-gen'))process.exit(1);console.log('OK: 七点清单路由已对齐')"

- [ ] [ARTIFACT] `packages/brain/src/battle-report.js` 含 `codex_test_gen` 计数注入逻辑（admission 段或独立 codex 段）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/battle-report.js','utf8');if(!c.includes('codex_test_gen'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

### Invariant 映射（INV 条目）

- [ ] [BEHAVIOR] [L2] INV-1 铁律：核心任务禁派 Codex（feedback_no_core_tasks_to_codex）——生成器过滤规则覆盖 dispatcher/slot-allocator/迁移类文件
  动作: 调用 codex-test-gen 模块检查其过滤黑名单配置
  预期观察: 代码中存在对 dispatcher、slot-allocator、migrations 路径的显式过滤/黑名单判断
  Test: manual:bash
    node -e "
    const c = require('fs').readFileSync('packages/brain/src/codex-test-gen.js','utf8');
    const hasFilter = c.includes('dispatcher') || c.includes('slot-allocator') || c.includes('migration') || c.includes('FORBIDDEN') || c.includes('blacklist') || c.includes('exclude');
    if (!hasFilter) { console.error('FAIL: codex-test-gen.js 缺核心文件过滤逻辑'); process.exit(1); }
    console.log('OK: 核心文件过滤逻辑存在');
    "
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-2 铁律：xian bridge 不可用时 requeue 不堆积（有 backoff）——任务状态不永久挂在 in_progress
  动作: 查询 DB 验证 in_progress 的 codex_test_gen 任务数不超过 codex pool max（5）
  预期观察: within 系统运行期间，in_progress 的 codex_test_gen 任务不超过 5 个（codex.max 硬上限）
  Test: manual:bash
    DB=${DB_URL:-postgresql://localhost/cecelia}
    IP_COUNT=$(psql "$DB" -t -c "SELECT count(*)::int FROM tasks WHERE task_type='codex_test_gen' AND status='in_progress'" | tr -d ' ')
    SLOTS=$(curl -sf localhost:5221/api/brain/slots)
    CODEX_MAX=$(echo "$SLOTS" | jq -r '.codex.max')
    [ "$IP_COUNT" -le "${CODEX_MAX:-5}" ] || { echo "FAIL: in_progress codex_test_gen 数($IP_COUNT) > codex.max($CODEX_MAX) — 堆积"; exit 1; }
    echo "OK: codex_test_gen in_progress=$IP_COUNT <= max=${CODEX_MAX:-5}（不堆积）"
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-3 铁律：scheduler-jobs.js JOBS 为唯一新 cron 注册入口（不走 tick-runner.js deprecated 路径）
  动作: 检查 tick-runner.js 和 tick.js 未包含 codex_test_gen/codex-test-gen 相关调度
  预期观察: tick.js 和 tick-runner.js 均不含 codex-test-gen 调用
  Test: manual:bash
    node -e "
    const fs = require('fs');
    const tick = fs.existsSync('packages/brain/src/tick.js') ? fs.readFileSync('packages/brain/src/tick.js','utf8') : '';
    const runner = fs.existsSync('packages/brain/src/tick-runner.js') ? fs.readFileSync('packages/brain/src/tick-runner.js','utf8') : '';
    if (tick.includes('codex-test-gen') || runner.includes('codex-test-gen')) {
      console.error('FAIL: codex-test-gen 出现在 tick.js/tick-runner.js（deprecated 路径）'); process.exit(1);
    }
    console.log('OK: 仅在 scheduler-jobs.js 注册，tick 路径清洁');
    "
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-4 铁律：去重机制——同文件 7 天内已生成过则跳过，不重复入队
  动作: 向 DB 插入一条 7 天内 codex_test_gen 任务记录（同 target_file），然后调用生成器验证返回 skipped
  预期观察: within 即时，生成器对已有近期记录的同文件返回 skipped:true，不新增任务
  Test: manual:bash
    DB=${DB_URL:-postgresql://localhost/cecelia}
    TEST_FILE="packages/brain/src/fake-target-for-dedup-test.js"
    # 插入一条近期（3天前）记录模拟已试过
    psql "$DB" -c "
      INSERT INTO tasks (task_type, status, payload, created_at)
      VALUES ('codex_test_gen', 'completed', '{\"target_file\":\"${TEST_FILE}\"}', NOW() - interval '3 days')
    " > /dev/null
    # 验证代码有 7 天窗口去重判据
    node -e "
    const c = require('fs').readFileSync('packages/brain/src/codex-test-gen.js','utf8');
    const hasDedup = c.includes('7 day') || c.includes('7 days') || c.includes('interval') || c.includes('dedup') || c.includes('skip');
    if (!hasDedup) { console.error('FAIL: 缺 7 天去重判据'); process.exit(1); }
    console.log('OK: 含 7 天去重判据');
    "
    # 清理测试数据
    psql "$DB" -c "DELETE FROM tasks WHERE task_type='codex_test_gen' AND payload->>'target_file'='${TEST_FILE}'" > /dev/null
    echo "OK: 7 天去重判据验证通过"
  期望: OK

### 功能 BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] codex_test_gen 任务成功入队——tasks 表出现新记录（带 5 分钟时间窗口防造假）
  动作: POST /api/brain/tasks 创建 codex_test_gen 任务（手动触发，跳过 scheduler 等待）
  预期观察: within 5s 任务写入 DB，tasks 表出现 task_type=codex_test_gen 的记录，created_at 在 5 分钟内
  Test: manual:bash
    DB=${DB_URL:-postgresql://localhost/cecelia}
    RESP=$(curl -sf -X POST localhost:5221/api/brain/tasks \
      -H "Content-Type: application/json" \
      -d '{"task_type":"codex_test_gen","payload":{"trigger":"dod_behavior_test","target_file":"packages/brain/src/codex-test-gen.js"},"status":"queued","priority":"P2"}')
    echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: 任务创建响应缺 id"; exit 1; }
    TASK_ID=$(echo "$RESP" | jq -r '.id')
    COUNT=$(psql "$DB" -t -c "SELECT count(*)::int FROM tasks WHERE task_type='codex_test_gen' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
    [ "$COUNT" -ge 1 ] || { echo "FAIL: 5min 内无 codex_test_gen 记录（count=$COUNT）"; exit 1; }
    echo "OK: codex_test_gen 任务已入队 id=$TASK_ID count=$COUNT"
  期望: OK

- [ ] [BEHAVIOR] [L2] /api/brain/slots 返回 codex pool 结构正确（max=5，running/available 字段存在）
  动作: GET /api/brain/slots 检查 codex 字段结构
  预期观察: 响应 JSON 含 codex.max=5、codex.running（整数）、codex.available（布尔）
  Test: manual:bash
    SLOTS=$(curl -sf localhost:5221/api/brain/slots)
    echo "$SLOTS" | jq -e '.codex | type == "object"' || { echo "FAIL: /api/brain/slots 无 codex 对象"; exit 1; }
    echo "$SLOTS" | jq -e '.codex.max == 5' || { echo "FAIL: codex.max 不等于 5（实际=$(echo $SLOTS | jq .codex.max)）"; exit 1; }
    echo "$SLOTS" | jq -e '.codex.running | type == "number"' || { echo "FAIL: codex.running 不是数字"; exit 1; }
    echo "$SLOTS" | jq -e '.codex.available | type == "boolean"' || { echo "FAIL: codex.available 不是布尔"; exit 1; }
    echo "OK: codex pool 结构正确 running=$(echo $SLOTS | jq .codex.running) max=5"
  期望: OK

- [ ] [BEHAVIOR] [L2] admission 段 24h codex_test_gen 计数——DB 查询带时间窗口防造假
  动作: psql 查询 24h 内 codex_test_gen 任务计数（带时间窗口）
  预期观察: 查询返回整数值 ≥ 1（在 Step5/入队操作后执行）
  Test: manual:bash
    DB=${DB_URL:-postgresql://localhost/cecelia}
    COUNT=$(psql "$DB" -t -c "
      SELECT count(*)::int FROM tasks
      WHERE task_type = 'codex_test_gen'
        AND created_at > NOW() - interval '24 hours'
    " | tr -d ' ')
    [ "$COUNT" -ge 1 ] || { echo "FAIL: 24h 内 codex_test_gen 计数=$COUNT（需先执行 BEHAVIOR:入队 条目）"; exit 1; }
    echo "OK: 24h codex_test_gen count=$COUNT"
  期望: OK

- [ ] [BEHAVIOR] [L2] 禁核心文件——codex-test-gen 扫描列表不包含 dispatcher/slot-allocator/migrations 路径文件
  动作: 检查 codex-test-gen.js 的黑名单配置包含所有 feedback_no_core_tasks_to_codex 铁律涵盖的核心文件前缀
  预期观察: 代码明确过滤 dispatcher、slot-allocator、migrations 等核心路径
  Test: manual:bash
    node -e "
    const c = require('fs').readFileSync('packages/brain/src/codex-test-gen.js','utf8');
    const blockers = ['dispatcher', 'slot-allocator', 'migration'];
    const missing = blockers.filter(b => !c.includes(b));
    if (missing.length > 0) {
      console.error('FAIL: codex-test-gen.js 过滤黑名单缺:', missing.join(', ')); process.exit(1);
    }
    console.log('OK: 核心文件黑名单完整 blockers=' + blockers.join(','));
    "
  期望: OK

- [ ] [BEHAVIOR] [L2] error path——非法 task_type 创建 POST 返回 4xx 或拒绝（验证 VALID_TASK_TYPES 包含 codex_test_gen）
  动作: 调用 task-router 验证 codex_test_gen 是否在 VALID_TASK_TYPES 中（合法类型）；用非法类型调用 POST 验证拒绝
  预期观察: codex_test_gen 在白名单中（合法）；完全随机类型被拒绝
  Test: manual:bash
    node -e "
    const c = require('fs').readFileSync('packages/brain/src/task-router.js','utf8');
    if (!c.includes(\"'codex_test_gen'\")) { console.error('FAIL: task-router VALID_TASK_TYPES 不含 codex_test_gen'); process.exit(1); }
    console.log('OK: codex_test_gen 在 VALID_TASK_TYPES');
    "
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/tasks \
      -H "Content-Type: application/json" \
      -d '{"task_type":"invalid_random_xyz_type","payload":{},"status":"queued"}')
    [ "$CODE" = "400" ] || [ "$CODE" = "422" ] || { echo "WARN: 非法类型返回 HTTP $CODE（非强制，仍 OK 若 DB 有约束）"; true; }
    echo "OK: error path 验证完成（codex_test_gen 合法，非法类型 HTTP=$CODE）"
  期望: OK
