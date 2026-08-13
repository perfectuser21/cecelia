// Machine oracle for the "judge FAIL 裁决注入下轮 evaluator TaskBundle" sprint.
// Proposer-authored; imports the REAL buildInputs/buildBundle/enforceBundleSizeLimit
// (no mock of the changed edge). Each check exits 0 (PASS) or 1 (FAIL) so the
// evaluator can drive it from a single-line manual:bash command with real exit
// code semantics (dispatcher.js is pure in-memory — no DB/Brain server needed).
//
// Usage: node <this> <checkId>
//   b01 = judge FAIL -> inputs.judge_feedback has summary + failure_class + round
//   b02 = no judge verdict -> no judge_feedback field
//   b03 = latest judge PASS -> no judge_feedback field
//   b04 = 600KB summary -> whole bundle <= 256KB and summary truncated
//   b05 = credential in summary -> redacted ([REDACTED]) before landing in bundle
//   b06 = multiple judge FAIL -> only latest by hop; round === latest hop
import { __test__ } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const { buildInputs, buildBundle, ACTION_SPECS, enforceBundleSizeLimit } = __test__;
const SPEC = ACTION_SPECS['spawn:evaluator'];
const META = { logicalCycleId: 'lc', attemptKind: 'initial', workstreamKey: 'ws1' };
const MAX = 256 * 1024;

function ctxWith(decisionLog) {
  return {
    runId: 'run-1', hop: 9, taskId: 'task-1', worktreePath: '/tmp/wt',
    decision: { phase: 'evaluate' },
    observed: {
      task: { id: 'task-1', title: 't', description: 'd', payload: {}, metadata: {} },
      decisionLog,
      pr: { head_sha: 'abcdef1234567890abcdef1234567890abcdef12', head_ref: 'feat' },
    },
  };
}
const fail = (n) => (row) => ({ action: 'verdict:judge', hop: n, detail: { verdict: 'FAIL', ...row } });
function die(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`OK: ${msg}`); process.exit(0); }

const check = process.argv[2];

if (check === 'b01') {
  const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
    fail(5)({ failure_class: 'evidence_insufficient', feedback: 'missing: ffprobe stream output; DB row count with time window' }),
  ]), META);
  const jf = inputs.judge_feedback;
  if (!jf || typeof jf !== 'object') die('judge_feedback absent on judge FAIL');
  if (typeof jf.summary !== 'string' || !jf.summary.includes('ffprobe')) die(`summary missing named evidence: ${JSON.stringify(jf.summary)}`);
  if (jf.failure_class !== 'evidence_insufficient') die(`failure_class wrong: ${JSON.stringify(jf.failure_class)}`);
  if (!Number.isInteger(jf.round) || jf.round !== 5) die(`round wrong: ${JSON.stringify(jf.round)}`);
  ok('judge_feedback injected with summary + failure_class + round');
} else if (check === 'b02') {
  const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([]), META);
  if ('judge_feedback' in inputs) die('judge_feedback must be absent when no judge verdict');
  ok('no judge_feedback when run has no judge verdict');
} else if (check === 'b03') {
  const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
    { action: 'verdict:judge', hop: 6, detail: { verdict: 'PASS', failure_class: null, feedback: 'looks good' } },
  ]), META);
  if ('judge_feedback' in inputs) die('judge_feedback must be absent when latest judge verdict is PASS');
  ok('no judge_feedback when latest judge verdict is PASS');
} else if (check === 'b04') {
  const bundle = buildBundle('spawn:evaluator', SPEC, ctxWith([
    fail(5)({ failure_class: 'evidence_insufficient', feedback: 'HEAD '.repeat(120000) }),
  ]), 'att-1', 'harness-evaluator', META, { deferWorkspaceValidation: true });
  const enforced = enforceBundleSizeLimit(bundle);
  const bytes = Buffer.byteLength(JSON.stringify(enforced));
  if (bytes > MAX) die(`bundle ${bytes} > ${MAX}`);
  const jf = enforced.inputs.judge_feedback;
  if (!jf || typeof jf.summary !== 'string') die('judge_feedback missing after size enforcement');
  if (jf.summary.length > 4096) die(`summary not truncated: ${jf.summary.length} chars`);
  ok(`bundle ${bytes} <= ${MAX}; summary truncated to ${jf.summary.length} chars`);
} else if (check === 'b05') {
  const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
    fail(5)({ failure_class: 'evidence_insufficient', feedback: `missing token evidence ${secret} end` }),
  ]), META);
  const jf = inputs.judge_feedback;
  if (!jf || typeof jf.summary !== 'string') die('judge_feedback absent');
  if (jf.summary.includes(secret)) die('credential not redacted from summary');
  if (!jf.summary.includes('[REDACTED]')) die('expected [REDACTED] marker in summary');
  ok('credential redacted from judge_feedback.summary');
} else if (check === 'b06') {
  const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
    fail(3)({ failure_class: 'product_failure', feedback: 'older fail' }),
    fail(7)({ failure_class: 'evidence_insufficient', feedback: 'newest fail: missing latest evidence' }),
    fail(5)({ failure_class: 'evidence_invalid', feedback: 'middle fail' }),
  ]), META);
  const jf = inputs.judge_feedback;
  if (!jf) die('judge_feedback absent');
  if (jf.round !== 7) die(`expected latest hop 7, got ${jf.round}`);
  if (jf.failure_class !== 'evidence_insufficient') die(`expected latest failure_class, got ${jf.failure_class}`);
  if (!jf.summary.includes('newest')) die('summary is not the latest judge verdict');
  ok('only latest judge FAIL (by hop) injected');
} else {
  die(`unknown check: ${check}`);
}
