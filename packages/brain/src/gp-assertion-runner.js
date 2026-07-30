import { createHash } from 'node:crypto';
import { checkGpLedgerReadiness } from './gp-ledger-readiness.js';
import {
  assertionCommand,
  assertionRunnerError,
  canonicalRepoIdentity,
  defaultRepoClean,
  defaultSourceRepo,
  defaultSourceSha,
} from './lib/gp-assertion-command.js';
import {
  inFinalTransaction,
  normalizeContractState,
  sameContractState,
} from './lib/gp-assertion-finalization.js';
import {
  redactAndBoundOutput,
  scenarioEvidenceFromOutput,
} from './lib/gp-assertion-output.js';
import {
  findReceiptFromDb,
  inShortTransaction,
  loadAssertionCellFromDb,
  persistReceiptToDb,
  signedContractFromDb,
} from './lib/gp-assertion-repository.js';
import {
  buildTrustedExecutionRequest,
  verifyTrustedExecution,
} from './lib/gp-assertion-trusted-execution.js';
import {
  assertionDigest,
  deriveAssertionVerification,
} from './lib/journey-assertion-receipt.js';
import { createNodeAdmissionClient } from './orchestrator/fleet-node/node-admission-client.js';
import { getNodeProfile } from './orchestrator/fleet-node/node-profile.js';
import {
  resolveCanonicalMachineId,
} from './orchestrator/preflight/canonical-machine-id.js';

const SHA = /^[0-9a-f]{40}$/;

function fail(code, message = code) {
  throw assertionRunnerError(code, message);
}

function admitted(machineId, value) {
  return value?.machine_id === machineId
    && value.state === 'base_admitted'
    && value.base_admitted === true
    && value.dispatch_ready === true;
}

export async function runGpAssertion(options = {}) {
  const {
    pool, linkId, runId, repoRoot, trustedExecute,
    synthetic = false, dryRun = false,
    getMachineId = async () => resolveCanonicalMachineId(),
    getNodeProfile: profileFor = getNodeProfile,
    admissionClient = createNodeAdmissionClient(),
    checkReadiness = checkGpLedgerReadiness,
    loadAssertionCell = loadAssertionCellFromDb,
    findExistingReceipt = findReceiptFromDb,
    persistReceipt = persistReceiptToDb,
    getSignedContract = signedContractFromDb,
    buildCommand = assertionCommand,
    getSourceSha = defaultSourceSha,
    getSourceRepo = defaultSourceRepo,
    isRepoClean = defaultRepoClean,
  } = options;
  if (typeof trustedExecute !== 'function') {
    fail('ASSERTION_TRUSTED_RUNNER_UNAVAILABLE');
  }
  if (synthetic) fail('SYNTHETIC_FORBIDDEN');
  if (dryRun) fail('DRY_RUN_FORBIDDEN');

  let machineId;
  let profile;
  try {
    machineId = String(await getMachineId()).trim();
    profile = profileFor(machineId);
  } catch {
    fail('ASSERTION_RUNNER_NOT_ADMITTED');
  }
  const admission = await admissionClient.getAdmission(
    machineId,
    { forceFresh: true },
  );
  if (!admitted(machineId, admission)) fail('ASSERTION_RUNNER_NOT_ADMITTED');

  const frozen = await inShortTransaction(
    pool,
    'BEGIN ISOLATION LEVEL REPEATABLE READ',
    async (db) => {
      const duplicate = await findExistingReceipt(db, runId, linkId);
      if (duplicate) return { duplicate };
      if (!(await checkReadiness(db)).ready) fail('GP_LEDGER_NOT_READY');
      const cell = await loadAssertionCell(db, linkId, { lock: 'share' });
      const command = await buildCommand(cell.assertion_ref.trim(), repoRoot);
      const contract = normalizeContractState(
        await getSignedContract(db, cell.journey_id),
      );
      return { cell, command, contract };
    },
  );
  if (frozen.duplicate) {
    return { duplicate: true, receipt: frozen.duplicate };
  }

  const sourceSha = await getSourceSha(repoRoot);
  if (!SHA.test(sourceSha)) fail('INVALID_SOURCE_SHA');
  const sourceRepo = canonicalRepoIdentity(await getSourceRepo(repoRoot));
  if (!await isRepoClean(repoRoot)) fail('SOURCE_WORKTREE_DIRTY');
  const request = buildTrustedExecutionRequest({
    run_id: runId,
    journey_step_link_id: linkId,
    machine_id: machineId,
    expected_runner_digest: profile.runner_image_digest,
    source_repo: sourceRepo,
    source_sha: sourceSha,
    workspace_root: repoRoot,
    command: frozen.command,
    timeout_ms: 300_000,
  });
  const trusted = verifyTrustedExecution({
    request,
    admission,
    receipt: await trustedExecute(request),
  });
  const execution = trusted.execution;
  const evidence = scenarioEvidenceFromOutput(
    frozen.command.options.evidenceKind,
    execution.stdout,
    execution.stderr,
  );
  if (execution.exitCode === 0 && evidence.scenarioCount <= 0) {
    fail('ASSERTION_ZERO_SCENARIOS');
  }
  if (
    await getSourceSha(repoRoot) !== sourceSha
    || canonicalRepoIdentity(await getSourceRepo(repoRoot)) !== sourceRepo
    || !await isRepoClean(repoRoot)
  ) return { status: 'conflict', receipt: null };

  return inFinalTransaction(pool, async (db) => {
    const current = await loadAssertionCell(db, linkId, { lock: 'update' });
    const currentContract = await getSignedContract(
      db,
      current.journey_id,
      { lock: 'share' },
    );
    if (
      String(current.assertion_revision) !== String(frozen.cell.assertion_revision)
      || assertionDigest(current.assertion_ref)
        !== assertionDigest(frozen.cell.assertion_ref)
      || !sameContractState(frozen.contract, currentContract)
    ) return { status: 'conflict', receipt: null };
    const duplicate = await findExistingReceipt(db, runId, linkId);
    if (duplicate) return { duplicate: true, receipt: duplicate };
    const outputTail = redactAndBoundOutput(execution.stdout, execution.stderr);
    const draft = {
      journey_step_link_id: linkId, run_id: runId,
      assertion_revision: frozen.cell.assertion_revision,
      assertion_ref_snapshot: frozen.cell.assertion_ref.trim(),
      assertion_digest: assertionDigest(frozen.cell.assertion_ref),
      source_repo: sourceRepo, source_sha: sourceSha,
      gp_contract_id: frozen.contract.id, gp_contract_hash: frozen.contract.hash,
      command_argv: [frozen.command.executable, ...frozen.command.argv],
      scenario_count: evidence.scenarioCount,
      scenario_evidence: {
        ...evidence.scenarioEvidence,
        ...trusted.scenario_evidence,
      },
      verdict: execution.exitCode === 0 ? 'PASS' : 'FAIL',
      exit_code: execution.exitCode,
      started_at: execution.startedAt, completed_at: execution.completedAt,
      machine_id: machineId,
      output_digest: createHash('sha256').update(outputTail).digest('hex'),
      output_tail: outputTail,
    };
    const saved = await persistReceipt(draft, db);
    if (!saved) {
      const winner = await findExistingReceipt(db, runId, linkId);
      return winner
        ? { duplicate: true, receipt: winner }
        : { status: 'conflict', receipt: null };
    }
    return {
      status: 'recorded',
      receipt: saved,
      verification: deriveAssertionVerification(current, [saved]),
    };
  });
}
