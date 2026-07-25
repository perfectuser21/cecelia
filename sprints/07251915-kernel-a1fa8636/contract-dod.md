---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel telemetry：逻辑轮次与耗时账本

**范围**: additive migration、attempt-store lineage 与时间账本、orphan 收口、task 聚合 telemetry API、4-run fixture、最小 dispatcher metadata 接线
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] additive migration 定义 telemetry 所需字段与索引
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/357_harness_provider_attempts.sql','utf8');['logical_cycle_id','attempt_kind','retry_of_attempt_id','restart_reason','workstream_key'].forEach((k)=>{if(!c.includes(k))process.exit(1);});"

- [ ] [ARTIFACT] attempt-store 暴露 lineage/收口相关写入路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/attempt-store.js','utf8');['logical_cycle_id','attempt_kind','retry_of_attempt_id','restart_reason','workstream_key'].forEach((k)=>{if(!c.includes(k))process.exit(1);});"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] migration 360 adds lineage telemetry columns to harness_attempts
  动作: 在真实 PostgreSQL 上执行 migration 后查询 `information_schema.columns`
  预期观察: `harness_attempts` 可读到 `logical_cycle_id`、`attempt_kind`、`retry_of_attempt_id`、`restart_reason`、`workstream_key`
  验证命令: Test: manual:bash
    psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name='harness_attempts'
      AND column_name IN ('logical_cycle_id','attempt_kind','retry_of_attempt_id','restart_reason','workstream_key')
    ORDER BY column_name;
    " | tr '\n' ',' | grep -q 'attempt_kind,logical_cycle_id,restart_reason,retry_of_attempt_id,workstream_key,'

- [ ] [BEHAVIOR] [L2] GET /api/brain/harness/tasks/:task_id/attempt-telemetry 返回 telemetry schema
  动作: 调用 `GET /api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true`
  预期观察: 返回 200，且 `task_id`、`run_count`、`logical_cycle_count`、`totals.*`、`role_metrics`、`attempts[].derived` 都存在
  验证命令: Test: manual:bash
    RESP=$(curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true")
    echo "$RESP" | jq -e '
      .task_id == "'"${TEST_TASK_ID}"'"
      and (.run_count | type == "number")
      and (.logical_cycle_count | type == "number")
      and (.totals.active_time_ms | type == "number")
      and (.totals.wall_time_ms | type == "number")
      and (.totals.wait_time_ms | type == "number")
      and (.totals.retry_count | type == "number")
      and (.totals.recovery_count | type == "number")
      and (.totals.invalid_count | type == "number")
      and (.role_metrics | type == "array")
      and (.attempts | type == "array")
      and (all(.attempts[]?; has("logical_cycle_id") and has("attempt_kind") and has("retry_of_attempt_id") and has("restart_reason") and has("workstream_key") and has("started_at") and has("completed_at") and has("derived")))
    ' >/dev/null

- [ ] [BEHAVIOR] [L2] GET /api/brain/harness/tasks/:task_id/attempt-telemetry response keys 精确等于 telemetry 合同 keys
  动作: 再次读取 telemetry JSON 顶层 keys
  预期观察: 顶层 keys 精确等于 `["attempts","logical_cycle_count","role_metrics","run_count","task_id","totals"]`
  验证命令: Test: manual:bash
    curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true" \
      | jq -e 'keys == ["attempts","logical_cycle_count","role_metrics","run_count","task_id","totals"]' >/dev/null

- [ ] [BEHAVIOR] [L2] GET /api/brain/harness/tasks/:task_id/attempt-telemetry 禁用字段名不存在
  动作: 读取 telemetry JSON 并检查禁用字段名
  预期观察: 顶层不出现 `attempt_count`、`cycle_id`、`kind`、`time_ms`、`run_total`
  验证命令: Test: manual:bash
    RESP=$(curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true")
    echo "$RESP" | jq -e 'has("attempt_count") | not' >/dev/null
    echo "$RESP" | jq -e 'has("cycle_id") | not' >/dev/null
    echo "$RESP" | jq -e 'has("kind") | not' >/dev/null
    echo "$RESP" | jq -e 'has("time_ms") | not' >/dev/null
    echo "$RESP" | jq -e 'has("run_total") | not' >/dev/null

- [ ] [BEHAVIOR] [L2] expired running attempt is resumed or structurally closed instead of hanging forever
  动作: 用 fixture 造一个已过 lease 的 `running` attempt，并触发 watchdog/reconcile
  预期观察: within 60s 新增 `resume|recovery` attempt，或旧 attempt 进入结构化终态且有 `completed_at`
  验证命令: Test: manual:bash
    DEADLINE=$((SECONDS + 60))
    until psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
    SELECT COUNT(*)
    FROM harness_attempts
    WHERE run_id='${TEST_RUN_ID}'
      AND created_at > NOW() - interval '5 minutes'
      AND (
        attempt_kind IN ('resume','recovery')
        OR (
          id='${ORPHAN_ATTEMPT_ID}'
          AND status IN ('failed','cancelled','blocked','needs_context')
          AND completed_at IS NOT NULL
        )
      );
    " | grep -q '^[1-9]'; do
      [ $SECONDS -lt $DEADLINE ] || { echo 'FAIL: timeout after 60s'; exit 1; }
      sleep 2
    done
    echo "OK: within 60s orphan 被收口"

- [ ] [BEHAVIOR] [L2] fixture 4-run raw counts 还原为 logical cycle 与损耗
  动作: 调用 fixture task 的 telemetry API
  预期观察: `run_count=4`、`logical_cycle_count=2`，并分离 `retry_count`、`recovery_count`、`invalid_count`
  验证命令: Test: manual:bash
    curl -sf "http://localhost:5221/api/brain/harness/tasks/${FIXTURE_TASK_ID}/attempt-telemetry?include_attempts=true" \
      | jq -e '
        .run_count == 4
        and .logical_cycle_count == 2
        and .totals.retry_count == 2
        and .totals.recovery_count == 1
        and .totals.invalid_count == 1
      ' >/dev/null

- [ ] [BEHAVIOR] [L2] invalid task id returns 404 with error string
  动作: 调用不存在的 task telemetry 路由
  预期观察: 返回 404，body 含 `error` 字段且为 string；404 不能当作“端点存在即可”
  验证命令: Test: manual:bash
    CODE=$(curl -s -o /tmp/kernel-telemetry-404.json -w "%{http_code}" "http://localhost:5221/api/brain/harness/tasks/00000000-0000-4000-8000-000000000000/attempt-telemetry")
    [ "$CODE" = "404" ] || exit 1
    jq -e '.error | type == "string"' /tmp/kernel-telemetry-404.json >/dev/null

## Invariant 条目

- [ ] [BEHAVIOR] [L2] INV-1 长等 attempt 仍保持 lease/heartbeat 时不得被当作 orphan 回收
  动作: 构造 heartbeat 新鲜的 running attempt 并触发 watchdog
  预期观察: 旧 attempt 不会被终结，也不会出现第二个同 run/hop attempt
  验证命令: Test: manual:bash
    psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
    SELECT COUNT(*)
    FROM harness_attempts
    WHERE run_id='${LIVE_RUN_ID}'
      AND created_at > NOW() - interval '5 minutes'
      AND status IN ('failed','cancelled')
    " | grep -q '^0$'

- [ ] [BEHAVIOR] [L2] INV-2 watchdog_overdue 恢复链路可追溯
  动作: 查询 recovery/resume attempt lineage
  预期观察: `retry_of_attempt_id` 或 `restart_reason` 能指回原 orphan attempt
  验证命令: Test: manual:bash
    psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
    SELECT COUNT(*)
    FROM harness_attempts
    WHERE run_id='${TEST_RUN_ID}'
      AND created_at > NOW() - interval '5 minutes'
      AND attempt_kind IN ('resume','recovery')
      AND (
        retry_of_attempt_id='${ORPHAN_ATTEMPT_ID}'
        OR restart_reason IS NOT NULL
      );
    " | grep -q '^[1-9]'

- [ ] [BEHAVIOR] [L2] INV-3 lease/heartbeat/orphan 时间关系被显式覆盖
  动作: 执行 PG 集成测试
  预期观察: kernel wiring / attempt-store 相关回归通过
  验证命令: Test: manual:bash
    npx vitest run packages/brain/src/orchestrator/__tests__/attempt-store.test.js packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot

- [ ] [BEHAVIOR] [L2] INV-4 多轮扫描场景不因重启丢失 streak
  动作: 执行 kernel wiring PG 集成回归
  预期观察: persisted BLOCKED/NEEDS_CONTEXT streak 与 poll restart 相关用例继续通过
  验证命令: Test: manual:bash
    npx vitest run packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot

- [ ] [BEHAVIOR] [L2] INV-5 orphan 收口失败不能被 try/catch 静默吞掉
  动作: 触发 orphan 收口异常路径并查看结构化终态
  预期观察: 失败时 attempt 进入 `failed|blocked|needs_context`，不返回 `null` 假成功
  验证命令: Test: manual:bash
    psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "
    SELECT COUNT(*)
    FROM harness_attempts
    WHERE run_id='${FAILED_RECOVERY_RUN_ID}'
      AND created_at > NOW() - interval '5 minutes'
      AND status IN ('failed','blocked','needs_context');
    " | grep -q '^[1-9]'

- [ ] [BEHAVIOR] [L2] INV-6 真实 PostgreSQL 接缝完成真验
  动作: 执行 migration 与 PG integration tests
  预期观察: 真实 PG Red→Green 通过；未真验不得标 done
  验证命令: Test: manual:bash
    npx vitest run packages/brain/src/__tests__/migration-357-harness-attempts.test.js packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js --reporter=dot

- [ ] [BEHAVIOR] [L2] INV-7 lease 秒数与时间窗口来自现有常量或显式约束
  动作: 查询代码与测试中的 lease 使用
  预期观察: 不出现无来源魔法值覆盖关键判定
  验证命令: Test: manual:bash
    node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/attempt-store.js','utf8'); if(/leaseSeconds/.test(c) && !/999999/.test(c)) process.exit(0); process.exit(1);"

- [ ] [BEHAVIOR] [L2] INV-8 telemetry 查询保持 task 作用域，不跨租户混读
  动作: 对指定 task_id 调 telemetry API
  预期观察: 返回的 `task_id` 与请求一致，不混入其它 task 的 run
  验证命令: Test: manual:bash
    curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true" \
      | jq -e '.task_id == "'"${TEST_TASK_ID}"'"' >/dev/null

- [ ] [BEHAVIOR] [L2] INV-9 telemetry 与错误日志不泄露 secrets 或 callback token
  动作: 调 telemetry API 并抽查 attempt 字段
  预期观察: 返回 payload 不含 `callback_secret_hash` 明文或 bearer token
  验证命令: Test: manual:bash
    curl -sf "http://localhost:5221/api/brain/harness/tasks/${TEST_TASK_ID}/attempt-telemetry?include_attempts=true" \
      | jq -e 'tostring | contains("callback_secret_hash") | not' >/dev/null

