---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness 失败可观测（terminal 必写 failure_class + 失败率计量 API）

**范围**: ①全量 terminal 写入点经单一受控枚举源写 result.failure_class+failure_detail；②机械闸（CI lint）防漏写回归；③GET /api/brain/harness/failure-stats?days=N 计量端点
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 受控枚举单一来源模块 failure-class.js 存在且导出 FAILURE_CLASSES/assertFailureClass/persistTerminalFailure/computeFailureStats
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/failure-class.js','utf8');if(!/FAILURE_CLASSES/.test(c)||!/assertFailureClass/.test(c)||!/persistTerminalFailure/.test(c)||!/computeFailureStats/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 机械闸 CI lint 脚本存在且扫描 terminal 写入点
  Test: node -e "const c=require('fs').readFileSync('scripts/lint-failure-class-writes.mjs','utf8');if(!/failure_class/.test(c))process.exit(1)"

- [ ] [ARTIFACT] failure-stats 路由注册在 routes/harness.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/failure-stats/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: terminal 失败经收敛写路径落库 result.failure_class 非 null
  动作: 经真实 persistTerminalFailure 把一条 harness_initiative 任务打成 terminal failed（failure_class=timeout）
  预期观察: tasks 表该任务 result->>'failure_class' = 'timeout'（非 null 且 ∈ 受控枚举）
  等待预算: 5s
  留证: psql SELECT 输出（含 timeout 行）
  Test: manual:bash -c 'TID=$(node -e '"'"'import("./packages/brain/src/orchestrator/failure-class.js").then(async m=>{const {default:pool}=await import("./packages/brain/src/db.js");const {rows}=await pool.query("INSERT INTO tasks(id,task_type,status,title,created_at) VALUES (gen_random_uuid(),\x27harness_initiative\x27,\x27in_progress\x27,\x27dod-b01\x27,NOW()) RETURNING id");await m.persistTerminalFailure(pool,rows[0].id,"timeout","dod b01");process.stdout.write(rows[0].id)})'"'"'); psql "$DB_URL" -tAc "SELECT result->>\x27failure_class\x27 FROM tasks WHERE id=\x27$TID\x27" | grep -qx timeout && echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 非法枚举值被 assert 拒绝（不接受自由文本）
  动作: 调用 assertFailureClass('free_text_bogus')
  预期观察: 抛错，进程以非零码退出前被 catch 判为拒绝成功
  等待预算: 0s
  留证: node 退出码
  Test: manual:bash -c 'node -e '"'"'import("./packages/brain/src/orchestrator/failure-class.js").then(m=>{try{m.assertFailureClass("free_text_bogus");process.exit(1)}catch(e){process.exit(0)}})'"'"' && echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 机械闸拦截 terminal 写入漏写 failure_class（干净树 exit 0，违规 fixture exit 1）
  动作: 先对干净树跑 lint，再注入一处「UPDATE tasks SET status='failed' 不写 failure_class」fixture 跑 lint
  预期观察: 干净树 exit 0；含违规写入 exit 1
  等待预算: 0s
  留证: 两次 lint 退出码
  Test: manual:bash -c 'node scripts/lint-failure-class-writes.mjs || exit 1; F=$(mktemp --suffix=.mjs); printf "export async function bad(p,i){await p.query(\"UPDATE tasks SET status=%s WHERE id=\$1\",[i]);}\n" "\x27failed\x27" > "$F"; if node scripts/lint-failure-class-writes.mjs --extra-scan "$F"; then rm -f "$F"; echo "FAIL: 违规未拦下"; exit 1; fi; rm -f "$F"; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: failure-stats 返回 200 且含 failure_rate 数值 + by_class 对象 + period_days
  动作: GET localhost:5221/api/brain/harness/failure-stats?days=7
  预期观察: HTTP 200，body.failure_rate 是 number，body.by_class 是 object，body.period_days == 7
  等待预算: 5s
  留证: curl 响应 JSON
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7"); echo "$RESP" | jq -e ".failure_rate|type==\"number\"" && echo "$RESP" | jq -e ".by_class|type==\"object\"" && echo "$RESP" | jq -e ".period_days==7" && echo OK'

- [ ] [BEHAVIOR] [L2] B-05: failure-stats 对脏 days 参数容错回落默认 7（不 500）
  动作: GET localhost:5221/api/brain/harness/failure-stats?days=abc
  预期观察: HTTP 200，period_days 回落为 7
  等待预算: 5s
  留证: curl 响应 JSON
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/harness/failure-stats?days=abc" | jq -e ".period_days==7" && echo OK'

- [ ] [BEHAVIOR] [L2] B-06: 本 sprint 新产生的 terminal harness 任务 result.failure_class IS NULL 计数=0（时间窗防历史冒充）
  动作: 记录基准时间戳 → 经收敛写路径新造一条 golden_path_proposal terminal failed → 统计基准后新造 terminal harness 任务中 failure_class IS NULL 条数
  预期观察: 时间窗内新产生的 terminal harness 任务无 failure_class IS NULL
  等待预算: 10s
  留证: psql count 输出 = 0
  Test: manual:bash -c 'T0=$(date -u +%Y-%m-%dT%H:%M:%SZ); sleep 1; TID=$(node -e '"'"'import("./packages/brain/src/orchestrator/failure-class.js").then(async m=>{const {default:pool}=await import("./packages/brain/src/db.js");const {rows}=await pool.query("INSERT INTO tasks(id,task_type,status,title,created_at) VALUES (gen_random_uuid(),\x27golden_path_proposal\x27,\x27in_progress\x27,\x27dod-b06\x27,NOW()) RETURNING id");await m.persistTerminalFailure(pool,rows[0].id,"runtime_crash","dod b06");await pool.query("UPDATE tasks SET status=\x27failed\x27 WHERE id=$1",[rows[0].id]);process.stdout.write(rows[0].id)})'"'"'); N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE task_type IN (\x27harness_initiative\x27,\x27golden_path_proposal\x27) AND status IN (\x27failed\x27,\x27blocked\x27,\x27cancelled\x27) AND created_at > \x27$T0\x27::timestamptz AND (result->>\x27failure_class\x27) IS NULL" | tr -d " "); [ "$N" = "0" ] && echo OK'

## INV 条目（历史约束三源 — 铁律映射）

- [ ] [BEHAVIOR] [L2] INV-1: 失败率口径真实接线（by_class 非恒空、failure_rate 分母=failed+done）
  动作: 经真实写路径造 terminal failed 记录后 GET failure-stats?days=7
  预期观察: by_class 计数总和 ≥1（非恒空子指标）且 0 ≤ failure_rate ≤ 1
  等待预算: 5s
  留证: curl 响应 + jq 断言输出
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7"); echo "$RESP" | jq -e "(.by_class|to_entries|map(.value)|add) >= 1" && echo "$RESP" | jq -e ".failure_rate>=0 and .failure_rate<=1" && echo OK'

- [ ] [BEHAVIOR] [L2] INV-2: 验证命令实跑确认 exit code 语义（负向断言真的会失败）
  动作: 对一条不存在的 task id 查 result.failure_class，断言其为空（证明 psql 断言非恒真）
  预期观察: 不存在 id 查得空结果，grep -qx timeout 失败 → 命令整体按预期 exit 非 0，反向 || echo 证明断言可失败
  等待预算: 0s
  留证: 退出码
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT result->>\x27failure_class\x27 FROM tasks WHERE id=\x2700000000-0000-0000-0000-000000000000\x27" | grep -qx timeout && { echo "FAIL: 断言恒真"; exit 1; } || echo OK'
