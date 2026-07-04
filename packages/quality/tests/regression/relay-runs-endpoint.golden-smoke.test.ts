/**
 * Golden Smoke Test — relay-runs-endpoint
 *
 * 自动生成：harness-generator Step 2.5 沉淀（勿手动编辑，下次 Sprint 会覆盖）
 * 来源 Sprint : sprints/07041710-relay-runs-endpoint
 * 来源 PR     : (pending)
 * 生成时间    : 2026-07-04 09:25:00 CST
 * target_env  : local_api
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';

const TARGET_ENV = 'local_api' as const;
const CI_SKIP_ENVS = ['windows_cloud', 'windows_wechat'] as const;
const shouldSkip = (CI_SKIP_ENVS as readonly string[]).includes(TARGET_ENV);

interface RunResult { ok: boolean; stdout: string; stderr: string; status: number | null; }

function runBash(cmd: string, timeoutMs = 60_000): RunResult {
  const result = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, BRAIN_URL: process.env.BRAIN_URL ?? 'http://localhost:5221' },
  });
  return { ok: result.status === 0 && result.error == null, stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

function diag(r: RunResult): string {
  return `exit=${r.status}\n--- stdout ---\n${r.stdout.slice(-2000)}\n--- stderr ---\n${r.stderr.slice(-2000)}`;
}

describe.skipIf(shouldSkip)(`[golden-smoke] relay-runs-endpoint (${TARGET_ENV})`, () => {

  // ── Scenario 1: relay-runs-happy-path
  it('relay-runs-happy-path', { timeout: 90_000 }, () => {
    const r = runBash(`#!/bin/bash
set -e

DB="\${DB:-postgresql://localhost/cecelia}"
BRAIN="localhost:5221"

echo "=== Step 1: 端点可达，返回 200 + JSON 数组 ==="
RESP=\$(curl -sf "\$BRAIN/api/brain/orchestrator/relay-runs") || { echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }
echo "\$RESP" | jq -e 'type == "array"' || { echo "FAIL: body 不是 JSON 数组"; exit 1; }
echo "PASS: 端点可达"

echo "=== Step 2: 插入 v2 run 并验证出现在响应中 ==="
TEST_INIT_ID=\$(psql "\$DB" -t -c \
  "INSERT INTO initiatives (id, task_id, journey_id, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'running') RETURNING id" \
  2>/dev/null | tr -d ' \n') || true

if [ -z "\$TEST_INIT_ID" ]; then
  TEST_INIT_ID=\$(psql "\$DB" -t -c "SELECT gen_random_uuid()" | tr -d ' \n')
fi

TEST_RUN_ID=\$(psql "\$DB" -t -c \
  "INSERT INTO initiative_runs (initiative_id, phase, orchestrator_version, started_at)
   VALUES ('\$TEST_INIT_ID', 'A_planning', 'v2', NOW())
   RETURNING id" | tr -d ' \n')
[ -n "\$TEST_RUN_ID" ] || { echo "FAIL: 无法插入测试 v2 run（migration 312 是否已跑？）"; exit 1; }
echo "插入 test run: \$TEST_RUN_ID"

RESP=\$(curl -sf "\$BRAIN/api/brain/orchestrator/relay-runs")
echo "\$RESP" | jq -e --arg rid "\$TEST_RUN_ID" 'map(.id) | index(\$rid) != null' \
  || { echo "FAIL: 新插入的 v2 run 未出现在响应中"; psql "\$DB" -c "DELETE FROM initiative_runs WHERE id='\$TEST_RUN_ID'" > /dev/null 2>&1; exit 1; }
echo "PASS: v2 run 出现在响应数组中"

echo "=== Step 3: 每项含 PRD 必填字段 ==="
echo "\$RESP" | jq -e 'first | has("id") and has("initiative_id") and has("phase") and has("started_at")' \
  || { echo "FAIL: 响应项缺少必填字段（id/initiative_id/phase/started_at）"; exit 1; }
echo "PASS: 必填字段存在"

# 清理
psql "\$DB" -c "DELETE FROM initiative_runs WHERE id='\$TEST_RUN_ID'" > /dev/null 2>&1 || true

echo "✅ relay-runs Golden Path 验证通过"`, 80_000);
    expect(r.ok, diag(r)).toBe(true);
  });
});
