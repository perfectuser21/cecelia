#!/usr/bin/env bash
# 生产前隔离候选是 brain-deploy.sh 的硬门；独立入口只允许固定 SHA 重验。
# 验证现行 YAML 接线，并实际执行失败不进生产、错 SHA/回执和有限预算回归。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
const workflow = yaml.load(fs.readFileSync('.github/workflows/auto-staging-deploy.yml', 'utf8'));
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'], '独立候选仅主动重验，不能恢复先生产后预发的自动链');
assert.equal(workflow.concurrency['cancel-in-progress'], false, '不能取消正在验收的候选');
assert.deepEqual(Object.keys(workflow.jobs), ['staging_deploy_and_smoke'], '不得追加生产发布 job');
assert.equal(workflow.jobs.staging_deploy_and_smoke['timeout-minutes'], 110, '外层预算必须容纳严格候选验证');
const steps = workflow.jobs.staging_deploy_and_smoke.steps;
const runs = steps.filter(step => typeof step.run === 'string');
assert.equal(runs.length, 2, '只允许请求候选和等待候选回执');
const [trigger, wait] = runs;
const checkout = steps.findIndex(step => step.uses === 'actions/checkout@v4');
assert.ok(checkout >= 0 && checkout < steps.indexOf(trigger), '先检出当前提交再执行候选请求');
assert.match(trigger.run, /jq -nc --arg sha "\$GITHUB_SHA" '\{staging:true,sha:\$sha\}'/, '请求必须明确 staging:true 并固定本次 SHA');
assert.match(trigger.run, /-X POST "\$BRAIN_URL\/api\/brain\/deploy"/, '必须调用真实候选入口');
assert.match(trigger.run, /-d "\$payload"/, '实际发送固定候选 payload');
assert.match(trigger.run, /STAGING_REQUEST_ID=\$\(jq -er \.request_id \/tmp\/staging-request\.json\)/, '必须从响应取得本次请求身份');
assert.match(trigger.run, />> "\$GITHUB_ENV"/, '请求身份传给后续等待');
assert.equal(wait.env.EXPECTED_SHA, '${{ github.sha }}', '等待必须绑定同 SHA');
assert.equal(wait.run.trim(), 'bash scripts/wait-for-staging.sh', '执行共享严格回执验证入口');
assert.equal(steps.some(step => String(step.uses || '').includes('deploy.yml')), false, '独立入口不得调用生产 workflow');
assert.doesNotMatch(trigger.run, /wait-for-production-sha|staging\s*:\s*false|promote/, '独立候选不得等待或晋级生产');
console.log('独立候选入口：固定 SHA、真实 staging 请求及请求身份传递通过');
JS

# 执行原脚本/YAML的行为验证；mock外部Docker/HTTP，保留原生产路径与完整拒绝断言。
cd "$ROOT_DIR/packages/brain"
npx --no-install vitest run --maxWorkers=1 --minWorkers=1 \
  src/__tests__/brain-staging-admission.test.js \
  src/__tests__/staging-request-receipt.test.js \
  src/__tests__/deployment-time-budget.test.js
printf '%s\n' '生产前隔离候选、同请求回执、有限预算与独立重验入口全部通过'
