#!/usr/bin/env bash
# c8a-harness-checkpoint-resume.sh
#
# 真实环境 smoke：harness-initiative graph 的 checkpoint/resume 在已部署 Brain 上是否真生效。
#
# 验证清单（对应 PRD task #3 + 集成测试 c8a-checkpoint-resume.integration.test.js）：
#   1. PostgresSaver setup 在生产 DB 已就绪（migration 244 / setup() 幂等）
#   2. 5 节点 graph 的 5 次 put 全部落到 checkpoints 表（thread_id 命中 ≥ 5 行）
#   3. Brain 进程被 kill+restart 后，checkpoints 行仍持久（DB 不丢）
#   4. 重启后新 PostgresSaver 实例 getTuple → 5 channel 全恢复（worktreePath /
#      plannerOutput / taskPlan / ganResult / result）
#   5. 同 thread_id 第二次走 saver.getTuple 仍命中（相当于 stub state 已含输出 →
#      节点幂等门会跳过 spawn — 在真实环境无 mock，只验 saver 侧的幂等读取语义）
#
# 与单测的差异：单测用 MemorySaver mock；smoke 验真 PostgresSaver + 真 pg + 真 docker restart。
#
# 退出码：0=PASS，非 0=FAIL（任何一步失败立刻 exit 1）。
# 跳过条件：cecelia-node-brain 容器不存在、psql 不在 PATH、DATABASE_URL 不可达 → exit 0 + 打印 SKIP。
set -euo pipefail

SMOKE_NAME="c8a-harness-checkpoint-resume"
log() { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL $*"; exit 1; }
skip() { log "SKIP $*"; exit 0; }

# ── 环境检测 ─────────────────────────────────────────────────────────────────
log "start"

if ! command -v docker >/dev/null 2>&1; then
  skip "docker 命令不存在（非 docker 部署机），smoke 暂只覆盖 docker 部署"
fi
if ! docker info >/dev/null 2>&1; then
  skip "docker daemon 不可达"
fi
if ! docker inspect cecelia-node-brain >/dev/null 2>&1; then
  skip "cecelia-node-brain 容器不存在（未部署）"
fi
if ! command -v psql >/dev/null 2>&1; then
  skip "psql 不在 PATH（需要 PostgreSQL client）"
fi

DB_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  skip "无法连接 DATABASE_URL=$DB_URL"
fi

# 唯一 thread_id：UTC 时间戳 + 进程 pid，避免并发污染、可重入清理
THREAD_ID="smoke-c8a-$(date -u +%Y%m%dT%H%M%S)-$$"
log "thread_id=$THREAD_ID"

# 失败时清理（trap 在 EXIT，正常退出时也跑）
cleanup() {
  log "cleanup checkpoints/checkpoint_blobs/checkpoint_writes for thread_id=$THREAD_ID"
  psql "$DB_URL" -c "DELETE FROM checkpoints WHERE thread_id='$THREAD_ID';"        >/dev/null 2>&1 || true
  psql "$DB_URL" -c "DELETE FROM checkpoint_blobs WHERE thread_id='$THREAD_ID';"   >/dev/null 2>&1 || true
  psql "$DB_URL" -c "DELETE FROM checkpoint_writes WHERE thread_id='$THREAD_ID';"  >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Step 1: 用 PostgresSaver 在 Brain 容器内 put 5 个 checkpoint（模拟 5 节点）──
# 第 5 个 checkpoint 含全 5 channel 的 value，对应 graph 跑完到 dbUpsertNode 的最终状态。
log "step1: PostgresSaver put 5 checkpoints (5 节点) inside cecelia-node-brain"

PUT_SCRIPT=$(cat <<'NODE_PUT'
const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
const threadId = process.env.SMOKE_THREAD_ID;
const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL);
(async () => {
  await saver.setup();

  // 5 节点 channel 累积写入：prep / planner / parsePrd / ganLoop / dbUpsert
  const cumulativeByStep = [
    { worktreePath: "/wt/smoke" },
    { worktreePath: "/wt/smoke", plannerOutput: "STUB OUT" },
    { worktreePath: "/wt/smoke", plannerOutput: "STUB OUT",
      taskPlan: { initiative_id: "smoke-init", tasks: [] } },
    { worktreePath: "/wt/smoke", plannerOutput: "STUB OUT",
      taskPlan: { initiative_id: "smoke-init", tasks: [] },
      ganResult: { contract_content: "C", rounds: 2, propose_branch: "b" } },
    { worktreePath: "/wt/smoke", plannerOutput: "STUB OUT",
      taskPlan: { initiative_id: "smoke-init", tasks: [] },
      ganResult: { contract_content: "C", rounds: 2, propose_branch: "b" },
      result: { contractId: "smoke-contract", runId: "smoke-run", success: true } },
  ];

  let parentId = null;
  let config = { configurable: { thread_id: threadId } };
  for (let i = 0; i < cumulativeByStep.length; i++) {
    const cv = cumulativeByStep[i];
    const checkpointId = `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`;
    const channelVersions = Object.fromEntries(Object.keys(cv).map(k => [k, i + 1]));
    const newVersions = Object.fromEntries(Object.keys(cv).map(k => [k, i + 1]));
    const checkpoint = {
      v: 1,
      id: checkpointId,
      ts: new Date().toISOString(),
      channel_values: cv,
      channel_versions: channelVersions,
      versions_seen: {},
      pending_sends: [],
    };
    const metadata = {
      source: i === 0 ? "input" : "loop",
      step: i,
      writes: null,
      parents: parentId ? { "": parentId } : {},
    };
    config = await saver.put(config, checkpoint, metadata, newVersions);
    parentId = checkpointId;
  }

  console.log("PUT_OK 5_checkpoints_written");
})().catch(e => { console.error("PUT_FAIL", e.stack || e.message); process.exit(2); });
NODE_PUT
)

PUT_OUT=$(docker exec -e "SMOKE_THREAD_ID=$THREAD_ID" cecelia-node-brain node -e "$PUT_SCRIPT" 2>&1)
echo "$PUT_OUT" | sed 's/^/  /'
echo "$PUT_OUT" | grep -q "PUT_OK 5_checkpoints_written" || fail "step1 PostgresSaver put 失败"

# ── Step 2: 验 checkpoints 表写入 ≥ 5 行 ─────────────────────────────────────
log "step2: 验 checkpoints 表写入 ≥ 5 行"
COUNT_BEFORE=$(psql "$DB_URL" -tAc "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID';")
log "checkpoints rows before restart = $COUNT_BEFORE"
[[ "$COUNT_BEFORE" -ge 5 ]] || fail "step2 checkpoints 行数不足（实际 $COUNT_BEFORE，期望 ≥ 5）"

# ── Step 3: docker restart cecelia-node-brain（模拟 Brain 进程死活重生）──────
log "step3: docker restart cecelia-node-brain"
docker restart cecelia-node-brain >/dev/null

# ── Step 4: 等 Brain healthy ─────────────────────────────────────────────────
log "step4: 等 Brain /api/brain/tick/status 200（最多 90s）"
HEALTHY=false
for i in $(seq 1 18); do
  if curl -sf http://localhost:5221/api/brain/tick/status >/dev/null 2>&1; then
    HEALTHY=true
    log "Brain 已 healthy（第 ${i} 次探测）"
    break
  fi
  sleep 5
done
[[ "$HEALTHY" == "true" ]] || fail "step4 Brain 重启 90s 内未 healthy"

# ── Step 5: 验 checkpoints 跨重启仍持久 ──────────────────────────────────────
log "step5: 验 checkpoints 跨 Brain 重启仍持久"
COUNT_AFTER=$(psql "$DB_URL" -tAc "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID';")
log "checkpoints rows after restart = $COUNT_AFTER"
[[ "$COUNT_AFTER" -ge 5 ]] || fail "step5 重启后 checkpoints 行丢失（实际 $COUNT_AFTER，期望 ≥ 5）"

# ── Step 6: 重启后新 PostgresSaver 实例 getTuple → 5 channel 全恢复 ──────────
log "step6: getTuple 验 5 channel 全恢复"

GET_SCRIPT=$(cat <<'NODE_GET'
const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
const threadId = process.env.SMOKE_THREAD_ID;
const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL);
(async () => {
  await saver.setup();
  const config = { configurable: { thread_id: threadId } };
  const tuple = await saver.getTuple(config);
  if (!tuple) { console.error("GET_FAIL no tuple"); process.exit(2); }
  const cv = tuple.checkpoint.channel_values || {};
  const expected = ["worktreePath", "plannerOutput", "taskPlan", "ganResult", "result"];
  const missing = expected.filter(k => !(k in cv));
  if (missing.length > 0) {
    console.error("GET_FAIL missing channels:", missing.join(","), "got:", Object.keys(cv).join(","));
    process.exit(3);
  }
  if (cv.worktreePath !== "/wt/smoke")            { console.error("GET_FAIL worktreePath wrong:", cv.worktreePath);   process.exit(4); }
  if (cv.plannerOutput !== "STUB OUT")            { console.error("GET_FAIL plannerOutput wrong:", cv.plannerOutput); process.exit(5); }
  if (cv.taskPlan?.initiative_id !== "smoke-init"){ console.error("GET_FAIL taskPlan wrong:", JSON.stringify(cv.taskPlan)); process.exit(6); }
  if (cv.ganResult?.rounds !== 2)                 { console.error("GET_FAIL ganResult wrong:", JSON.stringify(cv.ganResult)); process.exit(7); }
  if (cv.result?.contractId !== "smoke-contract") { console.error("GET_FAIL result wrong:", JSON.stringify(cv.result)); process.exit(8); }
  console.log("GET_OK 5_channels_recovered");
})().catch(e => { console.error("GET_FAIL", e.stack || e.message); process.exit(9); });
NODE_GET
)

GET_OUT=$(docker exec -e "SMOKE_THREAD_ID=$THREAD_ID" cecelia-node-brain node -e "$GET_SCRIPT" 2>&1)
echo "$GET_OUT" | sed 's/^/  /'
echo "$GET_OUT" | grep -q "GET_OK 5_channels_recovered" || fail "step6 getTuple 5 channel 验证失败"

# ── Step 7: 第二次读 → 仍命中（saver 侧幂等读取语义）─────────────────────────
log "step7: 第二次 getTuple 仍命中（saver 幂等读）"
GET_OUT_2=$(docker exec -e "SMOKE_THREAD_ID=$THREAD_ID" cecelia-node-brain node -e "$GET_SCRIPT" 2>&1)
echo "$GET_OUT_2" | grep -q "GET_OK 5_channels_recovered" || fail "step7 第二次 getTuple 验证失败"

log "PASS"
exit 0
