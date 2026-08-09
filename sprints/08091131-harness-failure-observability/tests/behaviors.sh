#!/bin/bash
# behaviors.sh — DoD [BEHAVIOR] 真执行断言分发（evaluator 原样跑，真 DB_URL + 真 helper，不 mock 被改的边）
# 用法: bash sprints/08091131-harness-failure-observability/tests/behaviors.sh <B01|B05|B06|B08>
# 依赖: DB 类断言需 $DB_URL（Fleet 注入 attempt 级库）；B06（机械闸自测）无需 DB
set -euo pipefail
GATE=packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs

case "${1:?behavior id required}" in
  B01)
    : "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
    TID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (id, task_type, status, title, created_at) VALUES (gen_random_uuid(),'harness_initiative','in_progress','b01-failclass', NOW()) RETURNING id" | tr -d ' ')
    [ -n "$TID" ] || { echo "FAIL: 插入测试任务失败"; exit 1; }
    DB_URL="$DB_URL" TID="$TID" node --input-type=module -e "import('pg').then(async({default:pg})=>{const pool=new pg.Pool({connectionString:process.env.DB_URL});const m=await import('./packages/brain/src/lib/harness-failure-class.js');await m.markHarnessTerminal(pool,{taskId:process.env.TID,status:'failed',failureClass:'invalid_gear',failureDetail:'b01 injected'});await pool.end();}).catch(e=>{console.error(e);process.exit(1)})"
    FC=$(psql "$DB_URL" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID'" | tr -d ' ')
    psql "$DB_URL" -tAc "DELETE FROM tasks WHERE id='$TID'" >/dev/null
    [ "$FC" = "invalid_gear" ] || { echo "FAIL: result.failure_class=$FC ≠ invalid_gear"; exit 1; }
    echo "OK B01 result.failure_class=$FC"
    ;;
  B05)
    : "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
    NULLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE task_type IN ('harness_initiative','golden_path_proposal') AND status IN ('failed','blocked','cancelled') AND completed_at > NOW() - interval '5 minutes' AND result->>'failure_class' IS NULL" | tr -d ' ')
    [ "$NULLS" = "0" ] || { echo "FAIL: 本轮新 terminal harness 任务 result.failure_class IS NULL 有 $NULLS 条"; exit 1; }
    echo "OK B05 null-class count=0"
    ;;
  B06)
    # 机械闸自测：脏 fixture（terminal 裸写无 failure_class）→ exit 1；干净 fixture → exit 0；真实树 → exit 0
    D=$(mktemp --suffix=.js); C=$(mktemp --suffix=.js)
    printf "%s\n" "await pool.query(\`UPDATE tasks SET status='failed' WHERE id=\$1\`,[id]);" > "$D"
    printf "%s\n" "await pool.query(\`UPDATE tasks SET status='failed', result=result||jsonb_build_object('failure_class','invalid_gear') WHERE id=\$1\`,[id]);" > "$C"
    set +e; node "$GATE" --fixture-files="$D"; DIRTY=$?; node "$GATE" --fixture-files="$C"; CLEAN=$?; node "$GATE"; REAL=$?; set -e
    rm -f "$D" "$C"
    [ "$DIRTY" -eq 1 ] || { echo "FAIL: 脏 fixture 未被拦（exit=$DIRTY，期望1）"; exit 1; }
    [ "$CLEAN" -eq 0 ] || { echo "FAIL: 干净 fixture 被误拦（exit=$CLEAN，期望0）"; exit 1; }
    [ "$REAL" -eq 0 ] || { echo "FAIL: 真实树仍有绕过 helper 的 harness terminal 裸写（exit=$REAL）"; exit 1; }
    echo "OK B06 gate dirty=1 clean=0 real=0"
    ;;
  B08)
    : "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
    TID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (id, task_type, status, title, created_at) VALUES (gen_random_uuid(),'harness_initiative','in_progress','b08-failclosed', NOW()) RETURNING id" | tr -d ' ')
    THREW=$(DB_URL="$DB_URL" TID="$TID" node --input-type=module -e "import('pg').then(async({default:pg})=>{const pool=new pg.Pool({connectionString:process.env.DB_URL});const m=await import('./packages/brain/src/lib/harness-failure-class.js');let t='no';try{await m.markHarnessTerminal(pool,{taskId:process.env.TID,status:'failed',failureClass:'__free_text__',failureDetail:'x'})}catch{t='yes'};await pool.end();process.stdout.write(t)}).catch(()=>{process.stdout.write('err')})")
    STILL=$(psql "$DB_URL" -tAc "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' ')
    psql "$DB_URL" -tAc "DELETE FROM tasks WHERE id='$TID'" >/dev/null
    [ "$THREW" = "yes" ] || { echo "FAIL: 非法枚举未抛错（got=$THREW）"; exit 1; }
    [ "$STILL" != "failed" ] || { echo "FAIL: 非法枚举竟落库为 failed"; exit 1; }
    echo "OK B08 fail-closed threw + not persisted"
    ;;
  *) echo "unknown behavior id: $1"; exit 2;;
esac
