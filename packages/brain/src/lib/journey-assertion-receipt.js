import { createHash } from 'node:crypto';
import { classifyJourneyCellAssertion } from './journey-cell-assertion.js';

function normalizeAssertionRef(assertionRef) {
  return String(assertionRef ?? '').replace(/\r\n?/g, '\n').trim();
}

function receiptTime(receipt, field) {
  const value = receipt?.[field];
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function compareReceipts(left, right) {
  for (const field of ['completed_at', 'created_at']) {
    const difference = Date.parse(receiptTime(left, field) ?? 0)
      - Date.parse(receiptTime(right, field) ?? 0);
    if (difference) return difference;
  }
  const leftId = String(left.id ?? '');
  const rightId = String(right.id ?? '');
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function emptyVerification(state = 'never_run') {
  return {
    state,
    verified: false,
    last_verified: null,
    last_run_at: null,
    receipt_id: null,
    run_id: null,
    source_sha: null,
    machine_id: null,
    assertion_current: false,
  };
}

function hasScenarioEvidence(receipt) {
  if (receipt.verdict !== 'PASS') return true;
  return (
    Number(receipt.scenario_count) > 0
    && receipt.scenario_evidence
    && typeof receipt.scenario_evidence === 'object'
    && !Array.isArray(receipt.scenario_evidence)
    && Object.keys(receipt.scenario_evidence).length > 0
  );
}

export function assertionDigest(assertionRef) {
  return createHash('sha256')
    .update(normalizeAssertionRef(assertionRef))
    .digest('hex');
}

export function deriveAssertionVerification(cell = {}, receipts = []) {
  const classification = classifyJourneyCellAssertion(cell);
  const runnable = typeof cell.runnable === 'boolean'
    ? cell.runnable
    : classification.runnable;
  if (!runnable) return emptyVerification('not_executable');

  const digest = assertionDigest(cell.assertion_ref);
  const matches = receipts
    .filter(receipt => (
      String(receipt.assertion_revision) === String(cell.assertion_revision)
      && String(receipt.assertion_digest).toLowerCase() === digest
      && hasScenarioEvidence(receipt)
    ))
    .sort(compareReceipts);
  if (matches.length === 0) return emptyVerification();

  const latest = matches.at(-1);
  const latestPass = matches.filter(receipt => receipt.verdict === 'PASS').at(-1);
  return {
    state: latest.verdict === 'PASS' ? 'verified' : 'failed',
    verified: latest.verdict === 'PASS',
    last_verified: receiptTime(latestPass, 'completed_at'),
    last_run_at: receiptTime(latest, 'completed_at'),
    receipt_id: latest.id ?? null,
    run_id: latest.run_id ?? null,
    source_sha: latest.source_sha ?? null,
    machine_id: latest.machine_id ?? null,
    assertion_current: true,
  };
}

export function summarizeAssertionCoverage(cells = []) {
  const eligibleCells = cells.filter(cell => cell.runnable);
  const verified = eligibleCells.filter(
    cell => cell.verification?.verified === true,
  ).length;
  const failed = eligibleCells.filter(
    cell => cell.verification?.state === 'failed',
  ).length;
  const neverRun = eligibleCells.length - verified - failed;

  return {
    eligible: eligibleCells.length,
    verified,
    failed,
    never_run: neverRun,
    percent: eligibleCells.length === 0
      ? 0
      : Math.round((verified / eligibleCells.length) * 100),
  };
}
