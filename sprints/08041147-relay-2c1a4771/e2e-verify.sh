#!/bin/bash
set -euo pipefail

# DB_NAME 同源纪律（铁律）：写入侧 node(db-config.js: NODE_ENV=test → cecelia_test)
# 与校验侧 psql 同一库名变量派生，禁止两处各自默认值
TEST_DB_NAME="cecelia_test"
TEST_DB_URL="postgresql://localhost:5432/${TEST_DB_NAME}"

# 0. 环境预检（不可用 = 环境未就绪 = FAIL，禁止 exit 0 兜底）
psql "$TEST_DB_URL" -t -A -c "SELECT 1" >/dev/null || { echo "FAIL: ${TEST_DB_NAME} 不可达"; exit 1; }
curl -sf -m 5 localhost:5221/api/brain/health | jq -e '.status == "healthy"' >/dev/null || { echo "FAIL: Brain 不健康(环境未就绪)"; exit 1; }

# 1. 回归测试已毕业入 CI 且全绿（brain-integration job 同款入口，真 Postgres）
cd packages/brain
npx vitest run src/__tests__/integration/liveness-never-started.integration.test.js --config vitest.integration.config.js --reporter=verbose || { echo "FAIL: never_started 毕业回归测试未通过"; exit 1; }
cd ../..
node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('liveness-never-started.integration.test.js'))process.exit(1)" || { echo "FAIL: POSTGRES_INTEGRATION_TESTS 未登记，非永久入 CI"; exit 1; }

# 2. Golden Path 场景直验：注入「从未启动」任务（1dfa40f7 复现）
# fixture 标题带时间戳唯一化：learnings 以 content_hash（title+content 派生）去重，
# 固定标题会命中历史 is_latest 行跳写，导致步骤 6 学习行断言在复跑时假红
TID=$(psql "$TEST_DB_URL" -q -t -A -c "INSERT INTO tasks (title, task_type, status, payload, error_message, started_at) VALUES ('e2e-never-started 探针场景 '||extract(epoch from now())::bigint, 'dev', 'in_progress', '{\"failure_class\":\"missing_anchor\"}', 'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火', NULL) RETURNING id")
[ -n "$TID" ] || { echo "FAIL: fixture 注入失败"; exit 1; }
trap "psql \"$TEST_DB_URL\" -c \"DELETE FROM learnings WHERE task_id='$TID'\" >/dev/null 2>&1; psql \"$TEST_DB_URL\" -c \"DELETE FROM tasks WHERE id='$TID'\" >/dev/null 2>&1 || true" EXIT
rm -f "/tmp/cecelia-${TID}.log"

# 3. 真实两轮探针（suspect → confirmed dead），worktree 真代码 + 真 DB + 真 ps
cat > /tmp/e2e-never-started-probe.mjs <<MJS
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { probeTaskLiveness } = await import('$PWD/packages/brain/src/executor.js');
await probeTaskLiveness();
await probeTaskLiveness();
process.exit(0);
MJS
NODE_ENV=test node /tmp/e2e-never-started-probe.mjs || { echo "FAIL: 探针执行失败"; exit 1; }

# 4. 分类保真断言（时间窗防历史数据冒充：watchdog_kill.ts 须在 5 分钟内）
REASON=$(psql "$TEST_DB_URL" -t -A -c "SELECT payload->'watchdog_kill'->>'reason' FROM tasks WHERE id='$TID' AND (payload->'watchdog_kill'->>'ts')::timestamptz > NOW() - interval '5 minutes'")
[ "$REASON" = "never_started" ] || { echo "FAIL: watchdog_kill.reason=$REASON 期望 never_started"; exit 1; }

# 5. 已有 error_message / failure_class 不被覆盖（PRD 边界）
EM=$(psql "$TEST_DB_URL" -t -A -c "SELECT error_message FROM tasks WHERE id='$TID'")
echo "$EM" | grep -q 'S2锚点执法' || { echo "FAIL: error_message 被覆盖为 $EM"; exit 1; }
FC=$(psql "$TEST_DB_URL" -t -A -c "SELECT payload->>'failure_class' FROM tasks WHERE id='$TID'")
[ "$FC" = "missing_anchor" ] || { echo "FAIL: failure_class 被覆盖为 $FC"; exit 1; }

# 6. failure learning 文本真根因保真（PRD 行 20，r2 补：task_id 定位 + 5 分钟时间窗防历史冒充）
L=$(psql "$TEST_DB_URL" -t -A -c "SELECT title || ' ' || content FROM learnings WHERE task_id='$TID' AND trigger_event='watchdog_kill' AND created_at > NOW() - interval '5 minutes'")
[ -n "$L" ] || { echo "FAIL: 该任务无 watchdog_kill 失败学习行"; exit 1; }
echo "$L" | grep -q 'never_started' || { echo "FAIL: 学习文本缺真根因标签 never_started"; exit 1; }
if echo "$L" | grep -q 'liveness_dead'; then echo "FAIL: 学习文本仍含 liveness_dead 假标签"; exit 1; fi

# 7. 下游分类保真：never_started 文本不落 transient 环境重试假通道
node -e "import('./packages/brain/src/dev-failure-classifier.js').then(m=>{const r=m.classifyDevFailure({error:'[watchdog] liveness_probe_failed reason=never_started 进程从未启动'});if(r.class==='transient'){console.error('FAIL: never_started 误分类 transient');process.exit(1);}console.log('classifier class='+r.class);})" || { echo "FAIL: classifier 分类保真失败"; exit 1; }

# 8. 枚举硬编码全仓库复查（ASSUMPTION 兑现）
for f in $(grep -rln "process_disappeared" packages/brain/src --include="*.js" | grep -v __tests__); do grep -q "never_started" "$f" || { echo "FAIL: $f 引用 exit reason 枚举但缺 never_started"; exit 1; }; done

echo "OK Golden Path 验证通过: never_started 分类保真 + 字段不覆盖 + 学习文本真根因 + 回归护栏 + 永久入 CI"
