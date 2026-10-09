#!/usr/bin/env bash
# 接入参数跨 Brain/执行器的一致性与入口接线；不访问凭据、生产节点或数据库。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOnboardingScript, validateEnrollment } from './src/node-onboarding/spec.js';
import { validateRequest } from '../../scripts/ops/node-onboarding.mjs';
const id = '68d1b8de-435c-4edb-b674-d13fefde0fa2';
const input = { name: '1-node', address: '192.0.2.10', ssh_user: 'operator', ssh_port: 22,
  credential_ref: 'op://CS/test/private key', host_key_fingerprint: `SHA256:${'a'.repeat(43)}`,
  role: 'observer', region: 'CN' };
const script = buildOnboardingScript(id, input);
assert.equal(validateRequest(JSON.parse(Buffer.from(script.env.TASK_ONBOARDING_REQUEST, 'base64'))).name, input.name);
assert.throws(() => validateEnrollment({ ...input, cmd: 'anything' }));
const route = readFileSync('./src/routes/machines.js', 'utf8');
assert.ok(route.indexOf("router.use('/onboarding'") < route.indexOf("router.get('/:name'"));
assert.match(readFileSync('./src/scheduler-jobs.js', 'utf8'), /name: 'node-onboarding'.*runNodeOnboardingJob/);
console.log('节点接入跨层契约与入口接线通过');
JS
