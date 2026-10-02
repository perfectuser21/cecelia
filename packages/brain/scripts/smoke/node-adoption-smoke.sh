#!/usr/bin/env bash
# 原机器身份合同的无副作用验收；真实PG并发/CAS在brain-integration执行。
set -euo pipefail
cd "$(dirname "$0")/../.."
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { registryIdentity, matchesAdoption } from './src/node-onboarding/registry-adoption.js';
import { validateEnrollment, buildOnboardingScript } from './src/node-onboarding/spec.js';
import { validateRequest } from '../../scripts/ops/node-onboarding.mjs';
const id='71d632df-252a-4991-ad6b-3647fbbea9f7';
const machine={id,name:'vps-hk',metadata:{public_ip:'192.0.2.42',services:['gateway']}};
const meta={id,adoption:registryIdentity(machine)};
assert.equal(matchesAdoption(machine,meta),true);
assert.equal(matchesAdoption({...machine,id:'different'},meta),false);
assert.equal(matchesAdoption({...machine,metadata:{...machine.metadata,public_ip:'192.0.2.43'}},meta),false);
const input={name:machine.name,address:machine.metadata.public_ip,ssh_user:'root',ssh_port:22,
 credential_ref:'op://CS/test/private key',host_key_fingerprint:`SHA256:${'a'.repeat(43)}`,role:'observer',region:'HK'};
assert.throws(()=>validateEnrollment({...input,machine_registry_id:id}));
const script=buildOnboardingScript(id,input);
assert.equal(validateRequest(JSON.parse(Buffer.from(script.env.TASK_ONBOARDING_REQUEST,'base64'))).id,id);
console.log('现有机器固定UUID与原受限SSH合同通过');
JS
