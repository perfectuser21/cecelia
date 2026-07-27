#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$REPO_ROOT"

: "${HARNESS_TEST_DATABASE_URL:?必须提供隔离 PostgreSQL 连接串}"
DB_NAME=$(psql -X -qAt "$HARNESS_TEST_DATABASE_URL" -c 'SELECT current_database()')
case "$DB_NAME" in
  *_test|preview_*) ;;
  *) echo "FAIL: 拒绝在非隔离数据库执行 db=$DB_NAME"; exit 1 ;;
esac

CASE_NAME=${1:-all}
case "$CASE_NAME" in
  all|unique-journey|history-and-backbone|cells-and-evidence|legacy-baseline|assertion-refs|endpoint-semantics|runtime-nonregression) ;;
  *) echo "FAIL: unknown case $CASE_NAME"; exit 2 ;;
esac

export DATABASE_URL="$HARNESS_TEST_DATABASE_URL"
IFS=$'\t' read -r DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD < <(
  node -e '
    const url = new URL(process.argv[1]);
    process.stdout.write([
      url.hostname,
      url.port || "5432",
      decodeURIComponent(url.pathname.slice(1)),
      decodeURIComponent(url.username),
      decodeURIComponent(url.password),
    ].join("\t") + "\n");
  ' "$HARNESS_TEST_DATABASE_URL"
)
export DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
export NODE_ENV=test
node packages/brain/src/migrate.js

# 隔离库 fixture：只在固定 Journey 不存在时建立六条真实历史锚。
psql -X -v ON_ERROR_STOP=1 "$HARNESS_TEST_DATABASE_URL" <<'SQL' >/dev/null
INSERT INTO journeys
  (id, name, journey_type, maturity, status, home, domain, trigger, endpoint, notion_id)
VALUES
  ('bb8cc561-b3ee-4fec-b74d-2255694bd963','Cecelia Harness Pipeline',
   'dev_pipeline','skeleton','active','factory','工厂',
   '一个任务要做（主理人开口/Brain自派）',
   '合格PR合并+账本格子变绿+handoff可查',
   '35ac40c2-ba63-81db-a6fb-f0c3cb4f1ad4')
ON CONFLICT (id) DO NOTHING;

INSERT INTO journey_steps
  (id, journey_id, name, step_number, status, backbone_version, notion_id)
VALUES
  ('c5bae104-da5e-483d-b5ea-c295c90a3f28','bb8cc561-b3ee-4fec-b74d-2255694bd963','Planner',1,'done','1.0','374c40c2-ba63-81a0-8f93-f138607751f5'),
  ('d6dcdfaf-4b98-4717-bbe3-522f03f70757','bb8cc561-b3ee-4fec-b74d-2255694bd963','GAN Proposer',2,'done','1.0','374c40c2-ba63-8140-bf6d-e45c61375a6b'),
  ('e2bd9263-87ef-4461-a1d5-5ff07a38b8a8','bb8cc561-b3ee-4fec-b74d-2255694bd963','GAN Reviewer',3,'done','1.0','374c40c2-ba63-8197-9aa6-ef9da511d853'),
  ('0cdadc1a-e3a0-46a1-8333-ebbc102883f7','bb8cc561-b3ee-4fec-b74d-2255694bd963','Generator',4,'done','1.0','374c40c2-ba63-8159-8ce3-e2f1bd34c5ec'),
  ('1a738e05-99a7-421c-a52d-c2bb80bf19be','bb8cc561-b3ee-4fec-b74d-2255694bd963','Evaluator',5,'done','1.0','374c40c2-ba63-8133-8795-f21ca8576508'),
  ('a6888ef3-2482-4655-8703-cf3b9f037cb9','bb8cc561-b3ee-4fec-b74d-2255694bd963','Final E2E',6,'done','1.0','374c40c2-ba63-8149-81f6-ea2909746d5d')
ON CONFLICT (id) DO NOTHING;
SQL

# 主迁移器以数字 version 记账；当前 main 已有另一份 365，因此本基线 SQL
# 作为可幂等投影显式重放两轮，避免同号迁移被 schema_version 误跳过。
psql -X -v ON_ERROR_STOP=1 "$HARNESS_TEST_DATABASE_URL" \
  -f packages/brain/migrations/365_kernel_harness_f1_baseline.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 "$HARNESS_TEST_DATABASE_URL" \
  -f packages/brain/migrations/365_kernel_harness_f1_baseline.sql >/dev/null

HARNESS_TEST_DATABASE_URL="$HARNESS_TEST_DATABASE_URL" \
  npx vitest run \
  sprints/07271239-kernel-harness-11-elements-baseline/tests/kernel-harness-f1-baseline.test.ts \
  --reporter=verbose

if [[ "$CASE_NAME" == "endpoint-semantics" || "$CASE_NAME" == "runtime-nonregression" || "$CASE_NAME" == "all" ]]; then
  PORT=$((23000 + RANDOM % 10000))
  PORT="$PORT" DATABASE_URL="$HARNESS_TEST_DATABASE_URL" node --input-type=module <<'NODE' &
import express from 'express';
import journeysRouter from './packages/brain/src/routes/journeys.js';
const app = express();
app.use(express.json());
app.use('/api/brain', journeysRouter);
app.listen(Number(process.env.PORT), '127.0.0.1');
NODE
  SERVER_PID=$!
  cleanup() {
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  }
  trap cleanup EXIT

  READY=0
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963" \
      > /tmp/kernel-harness-f1-endpoint.json; then
      READY=1
      break
    fi
    sleep 1
  done
  [[ "$READY" -eq 1 ]] || { echo "FAIL: Brain journeys route 未就绪"; exit 1; }
  jq -e '
    .id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"
    and (.endpoint | test("production verified"; "i"))
    and (.endpoint | test("rollback anchor"; "i"))
    and (.endpoint | test("report/learning"; "i"))
  ' /tmp/kernel-harness-f1-endpoint.json >/dev/null
  cleanup
  trap - EXIT
fi

if [[ "$CASE_NAME" == "runtime-nonregression" || "$CASE_NAME" == "all" ]]; then
  (
    cd packages/brain
    npx vitest run \
      src/__tests__/harness-promote-regression.test.js \
      src/__tests__/harness-completion-authority.test.js \
      src/__tests__/deploy-staging-guardrail.test.js \
      --reporter=verbose
  )
fi

echo "OK: kernel harness F1 baseline $CASE_NAME"
