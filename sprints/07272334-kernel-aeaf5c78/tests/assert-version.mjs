import fs from 'node:fs';
import {
  RESULT_CONTRACT_VERSION,
  parseHarnessResult,
} from '../../../packages/brain/src/orchestrator/execution-contract.js';
import { resolveAction } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const pkg = JSON.parse(fs.readFileSync('packages/brain/package.json', 'utf8'));
const definition = fs.readFileSync('packages/brain/DEFINITION.md', 'utf8');
const definitionVersion = definition.match(/\*\*版本\*\*:\s*([0-9.]+)/)?.[1];
if (definitionVersion !== pkg.version) throw new Error('ARTIFACT_RED:definition_package_version_mismatch');
if (pkg.version === '1.267.95') throw new Error('ARTIFACT_RED:brain_version_not_incremented');
if (!definition.includes('Worker-local attempt result sink and feedback lineage')) {
  throw new Error('ARTIFACT_RED:definition_missing_result_sink_semantics');
}
if (RESULT_CONTRACT_VERSION !== '1.0') throw new Error('ARTIFACT_RED:HarnessResult_version_drift');

const reviewer = resolveAction('spawn:reviewer');
const canary = resolveAction('spawn:canary');
const judge = resolveAction('spawn:judge');
if (
  reviewer.expectedOutput !== 'harness-result/reviewer-v1'
  || canary.expectedOutput !== 'harness-result/canary-v1'
  || judge.expectedOutput !== 'harness-result/judge-v1'
) {
  throw new Error('ARTIFACT_RED:expectedOutput_semantics_drift');
}
parseHarnessResult({
  contract_version: '1.0',
  attempt_id: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  summary: '',
  artifacts: [],
  checks: [],
  decision: { outcome: 'CANARY_OK' },
  error: null,
  provider_metadata: { provider: 'codex' },
}, 'reporter', canary.expectedOutput);

console.log(`ARTIFACT_OK:Brain=${pkg.version}:HarnessResult=${RESULT_CONTRACT_VERSION}`);
