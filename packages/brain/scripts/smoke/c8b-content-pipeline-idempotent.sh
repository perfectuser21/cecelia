#!/usr/bin/env bash
# C8b Content Pipeline Idempotent — real-env smoke
#
# 目标：验证 content-pipeline LangGraph workflow 的幂等门（resume skip）在已部署
#      Brain 上是否真生效 —— state 中已有节点 primary output 时不再 spawn docker。
#
# 自包含模式（CI 干净环境 / 本机皆可）：
#   1. 直插 PG 一条 stub content-pipeline task
#   2. 用 PostgresSaver.put 把 6 节点全部 primary output（research/copywrite/...）
#      和 verdict（copy_review_verdict=APPROVED, image_review_verdict=PASS）
#      种到 thread_id=task.id 的 checkpoint 上
#   3. POST /api/brain/pipelines/<id>/run-langgraph
#   4. 等 pipeline 跑完（所有节点都因 state 已含 primary 字段而 resume skip，
#      不会真 spawn docker — 这就是幂等门生效的标志）
#   5. 验 brain logs 里出现 ≥1 条 "[content-pipeline-graph] node=... resume skip" 行
#   6. cleanup: 删 stub task + 该 thread_id 的 checkpoint 系列
#
# 与 c8a 的差异：c8a 验 saver 侧（put/get）；c8b 验 graph 节点侧（resume skip 触发）。
# 与单测的差异：单测 mock graph；smoke 真起 brain HTTP + 真 PostgresSaver + 真 graph。
#
# 环境变量（自包含 / CI 复用）：
#   BRAIN_CONTAINER   默认 cecelia-node-brain（CI real-env-smoke 设 cecelia-brain-smoke）
#   BRAIN_URL         默认 http://localhost:5221
#   PG_CONTAINER      默认 cecelia-postgres；不存在时自动 fallback 走宿主 psql
#   DATABASE_URL      宿主 psql 用，默认 postgresql://cecelia@localhost:5432/cecelia
#                     CI 用 postgresql://cecelia:cecelia_test@localhost:5432/cecelia_test
#   CONTAINER_DATABASE_URL  容器内 PostgresSaver 用，默认同 DATABASE_URL
#   SMOKE_DESTRUCTIVE 默认 0（仅幂等门验证）；=1 才追加 docker kill+restart 续跑链路
#
# 退出码：0=PASS，1=FAIL。skip 路径走 0 + 打印 SKIP（缺 brain 容器或 DB 不可达）。
set -euo pipefail

SMOKE_NAME="c8b-content-pipeline-idempotent"
log() { echo "[smoke:$SMOKE_NAME] $*"; }
fail_msg() { log "FAIL $*"; FAILED=1; }
pass_msg() { log "PASS $*"; }
skip() { log "SKIP $*"; exit 0; }

# ── 参数化 ──────────────────────────────────────────────────────────────────
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-node-brain}"
PG_CONTAINER="${PG_CONTAINER:-cecelia-postgres}"
DB_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"
# CONTAINER_DATABASE_URL 显式注入用；不注入则用容器自身 DATABASE_URL/DB_*。
# 本机 docker brain 走 host.docker.internal，CI host network 走 localhost，二者不同。
CONTAINER_DB_URL="${CONTAINER_DATABASE_URL:-}"
SMOKE_DESTRUCTIVE="${SMOKE_DESTRUCTIVE:-0}"

log "start (BRAIN_CONTAINER=$BRAIN_CONTAINER PG_CONTAINER=$PG_CONTAINER BRAIN_URL=$BRAIN_URL DESTRUCTIVE=$SMOKE_DESTRUCTIVE)"

# ── 环境检测 ────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || skip "docker 未安装"
docker info >/dev/null 2>&1 || skip "docker daemon 不可达"
docker inspect "$BRAIN_CONTAINER" >/dev/null 2>&1 || skip "$BRAIN_CONTAINER 容器不存在（未部署）"
command -v psql >/dev/null 2>&1 || skip "psql 不在 PATH"
psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 || skip "无法连接 DATABASE_URL=$DB_URL"

# 等 brain HTTP healthy（前置 — 否则 run-langgraph 必失败）
HEALTHY=0
for i in $(seq 1 30); do
  if curl -sf "$BRAIN_URL/api/brain/tick/status" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 1
done
[ "$HEALTHY" = "1" ] || skip "Brain $BRAIN_URL 30s 内未 healthy — 跳过"

# PG 容器侧 fallback：有则容器内 psql，无则宿主 psql
PG_VIA_CONTAINER=0
if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  PG_VIA_CONTAINER=1
  log "pg 模式: docker exec $PG_CONTAINER psql"
else
  log "pg 模式: 宿主 psql (DATABASE_URL=$DB_URL)"
fi

run_psql() {
  if [ "$PG_VIA_CONTAINER" = "1" ]; then
    docker exec "$PG_CONTAINER" psql -U "${PG_USER:-cecelia}" -d "${PG_DB:-cecelia}" "$@"
  else
    psql "$DB_URL" "$@"
  fi
}

FAILED=0
STUB_TASK_ID=""
THREAD_ID=""

cleanup() {
  echo ""
  log "cleanup"
  if [ -n "$STUB_TASK_ID" ]; then
    run_psql -c "DELETE FROM tasks WHERE id = '$STUB_TASK_ID';" >/dev/null 2>&1 \
      || log "cleanup tasks 失败（容忍） task=$STUB_TASK_ID"
  fi
  if [ -n "$THREAD_ID" ]; then
    psql "$DB_URL" -c "DELETE FROM checkpoints WHERE thread_id='$THREAD_ID';"        >/dev/null 2>&1 || true
    psql "$DB_URL" -c "DELETE FROM checkpoint_blobs WHERE thread_id='$THREAD_ID';"   >/dev/null 2>&1 || true
    psql "$DB_URL" -c "DELETE FROM checkpoint_writes WHERE thread_id='$THREAD_ID';"  >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ── Step 1: 创 stub content-pipeline task ───────────────────────────────────
log "step1: 创 stub content-pipeline task (PG INSERT)"
STUB_KEYWORD="smoke-c8b-$(date -u +%Y%m%dT%H%M%S)-$$"
STUB_TASK_ID="$(run_psql -t -A -c \
  "INSERT INTO tasks (task_type, title, status, priority, payload, created_at)
   VALUES ('content-pipeline', '[smoke] $STUB_KEYWORD', 'queued', 'P3',
           jsonb_build_object('keyword', '$STUB_KEYWORD', 'output_dir', '/tmp/smoke-$STUB_KEYWORD', 'smoke_test', true),
           NOW())
   RETURNING id;" 2>/dev/null | head -n1 | tr -d '[:space:]')"
[ -n "$STUB_TASK_ID" ] || fail_msg "stub task 创建失败"
[ "$FAILED" -eq 0 ] || exit 1
THREAD_ID="$STUB_TASK_ID"
log "stub task id=${STUB_TASK_ID} thread_id 同"

# ── Step 2: 容器内 PostgresSaver.put 全 6 节点 primary output + verdict ─────
log "step2: 在 $BRAIN_CONTAINER 内 PostgresSaver.put 种全字段 checkpoint"

PUT_SCRIPT=$(cat <<'NODE_PUT'
const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
const threadId = process.env.SMOKE_THREAD_ID;
function resolveDbUrl() {
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const h = process.env.DB_HOST, u = process.env.DB_USER, p = process.env.DB_PASSWORD,
        n = process.env.DB_NAME, port = process.env.DB_PORT || "5432";
  if (h && u && n) {
    const auth = p ? `${u}:${encodeURIComponent(p)}` : u;
    return `postgresql://${auth}@${h}:${port}/${n}`;
  }
  return null;
}
const dbUrl = resolveDbUrl();
if (!dbUrl) { console.error("PUT_FAIL no DATABASE_URL / DB_* in container env"); process.exit(2); }
const saver = PostgresSaver.fromConnString(dbUrl);
(async () => {
  await saver.setup();
  // 6 节点 primary outputs（见 content-pipeline.graph.js NODE_CONFIGS）+ 2 verdicts
  // 全部写到 channel_values，下次 graph 走任何节点都会被 resume skip
  const cv = {
    keyword: "smoke-c8b",
    output_dir: "/tmp/smoke-c8b",
    findings_path: "/tmp/smoke-c8b/findings.md",
    copy_path: "/tmp/smoke-c8b/copy.md",
    article_path: "/tmp/smoke-c8b/article.md",
    copy_review_feedback: "ok",
    copy_review_verdict: "APPROVED",
    person_data_path: "/tmp/smoke-c8b/person-data.json",
    cards_dir: "/tmp/smoke-c8b/cards",
    image_review_feedback: "ok",
    image_review_verdict: "PASS",
    manifest_path: "/tmp/smoke-c8b/manifest.json",
    nas_url: "stub://smoke",
  };
  const channelVersions = Object.fromEntries(Object.keys(cv).map(k => [k, 1]));
  const checkpoint = {
    v: 1,
    id: "00000000-0000-0000-0000-000000000001",
    ts: new Date().toISOString(),
    channel_values: cv,
    channel_versions: channelVersions,
    versions_seen: {},
    pending_sends: [],
  };
  const metadata = { source: "input", step: 0, writes: null, parents: {} };
  const config = { configurable: { thread_id: threadId } };
  await saver.put(config, checkpoint, metadata, channelVersions);
  console.log("PUT_OK seeded_all_fields");
})().catch(e => { console.error("PUT_FAIL", e.stack || e.message); process.exit(2); });
NODE_PUT
)

PUT_OUT=$(
  if [ -n "$CONTAINER_DB_URL" ]; then
    docker exec -e "SMOKE_THREAD_ID=$THREAD_ID" -e "SMOKE_DATABASE_URL=$CONTAINER_DB_URL" \
      "$BRAIN_CONTAINER" node -e "$PUT_SCRIPT" 2>&1
  else
    docker exec -e "SMOKE_THREAD_ID=$THREAD_ID" \
      "$BRAIN_CONTAINER" node -e "$PUT_SCRIPT" 2>&1
  fi
)
echo "$PUT_OUT" | sed 's/^/  /'
if ! echo "$PUT_OUT" | grep -q "PUT_OK seeded_all_fields"; then
  fail_msg "step2 PostgresSaver put 种 checkpoint 失败"
  exit 1
fi
pass_msg "checkpoint 种入完成"

# 验 PG 真有 checkpoint 行
CP_ROWS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM checkpoints WHERE thread_id='$THREAD_ID';" | tr -d '[:space:]')
[ "${CP_ROWS:-0}" -ge 1 ] || { fail_msg "step2 checkpoints 表无种入行"; exit 1; }
log "checkpoints rows=$CP_ROWS"

# ── Step 3 (可选): 破坏式 docker kill+restart ───────────────────────────────
if [ "$SMOKE_DESTRUCTIVE" = "1" ]; then
  log "step3 (destructive): docker kill + start $BRAIN_CONTAINER"
  docker kill "$BRAIN_CONTAINER" >/dev/null 2>&1 || true
  docker start "$BRAIN_CONTAINER" >/dev/null
  HEALTHY=0
  for i in $(seq 1 60); do
    if curl -sf "$BRAIN_URL/api/brain/tick/status" >/dev/null 2>&1; then HEALTHY=1; break; fi
    sleep 1
  done
  [ "$HEALTHY" = "1" ] || { fail_msg "step3 brain 60s 内未 healthy"; exit 1; }
  pass_msg "brain 已重启 healthy"
else
  log "step3: SMOKE_DESTRUCTIVE=0 跳过 docker kill"
fi

# ── Step 4: POST run-langgraph 触发 graph 跑（应全节点 resume skip）────────
log "step4: POST $BRAIN_URL/api/brain/pipelines/$STUB_TASK_ID/run-langgraph"
LOG_MARK_TIME=$(date -u +%s)
HTTP=$(curl -sS -o /tmp/smoke-c8b-run.json -w '%{http_code}' \
  -X POST "$BRAIN_URL/api/brain/pipelines/$STUB_TASK_ID/run-langgraph" \
  -H 'Content-Type: application/json' -d '{}' || echo "000")

if [ "$HTTP" = "503" ] && grep -q "LANGGRAPH_DISABLED" /tmp/smoke-c8b-run.json 2>/dev/null; then
  cat /tmp/smoke-c8b-run.json | sed 's/^/  /'
  skip "CONTENT_PIPELINE_LANGGRAPH_ENABLED 显式关闭 — 此 smoke 不适用"
fi
if [ "$HTTP" != "202" ] && [ "$HTTP" != "200" ]; then
  fail_msg "step4 run-langgraph HTTP=$HTTP"
  cat /tmp/smoke-c8b-run.json 2>/dev/null | sed 's/^/  /' || true
  exit 1
fi
pass_msg "run-langgraph 返回 $HTTP"

# ── Step 5: 等 graph 跑完 + 验 docker logs 出现 resume skip ─────────────────
log "step5: 等 ≤30s graph 走完 + 抓 brain logs 找 'resume skip'"
RESUME_LINES=""
for i in $(seq 1 30); do
  sleep 1
  # 从 mark 起取 +60s 滚动窗口（防 log 太老被丢）
  SINCE_S=$(( $(date -u +%s) - LOG_MARK_TIME + 60 ))
  RESUME_LINES=$(docker logs --since "${SINCE_S}s" "$BRAIN_CONTAINER" 2>&1 \
    | grep -F 'content-pipeline-graph' \
    | grep -F "task=$STUB_TASK_ID" \
    | grep -F 'resume skip' || true)
  if [ -n "$RESUME_LINES" ]; then break; fi
done

if [ -n "$RESUME_LINES" ]; then
  N=$(echo "$RESUME_LINES" | wc -l | tr -d ' ')
  pass_msg "找到 ${N} 条 'resume skip' 日志 task=${STUB_TASK_ID}"
  echo "$RESUME_LINES" | head -6 | sed 's/^/    /'
else
  fail_msg "30s 内未找到 'resume skip' 日志 task=${STUB_TASK_ID}"
  echo "  近 60s content-pipeline-graph 日志（参考）:"
  docker logs --since "60s" "$BRAIN_CONTAINER" 2>&1 \
    | grep -F 'content-pipeline-graph' | tail -20 | sed 's/^/    /' || true
fi

# ── 收尾 ────────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -eq 0 ]; then
  log "PASS"
  exit 0
else
  log "FAILED"
  exit 1
fi
