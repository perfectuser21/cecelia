import { evaluateDiffGate } from './diff-gate.js';
import { getActiveImpactContract } from './contract-store.js';
import { getGapById, transitionGapStatus } from './gap-store.js';
import { evaluateStructureGate } from './structure-gate.js';
import { canonicalAssertionArgv } from '../lib/gp-assertion-command.js';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function repoFromTask(task) {
  const payload = asObject(task?.payload);
  const raw = payload.base_repo ?? payload.repo ?? null;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const normalized = raw.trim().replace(/\.git$/, '');
  const githubMatch = normalized.match(/github\.com[/:]([^/]+\/[^/]+)$/);
  return githubMatch?.[1] ?? normalized;
}

function gateReceipt(stage, result, extra = {}) {
  return {
    stage,
    gate: result.gate,
    reason: result.reason ?? result.reason_code ?? null,
    retryable: result.retryable ?? false,
    contract_id: result.contract?.id ?? null,
    contract_hash: result.contract?.contract_hash ?? null,
    ...extra,
  };
}

function impactPolicy(run, activeContract) {
  if (activeContract) return 'required';
  return run?.impact_contract_policy ?? 'unknown';
}

function exemptReceipt(stage, run) {
  const policy = run?.impact_contract_policy;
  if (!['exempt', 'legacy_exempt'].includes(policy)) return null;
  return {
    gate: 'pass',
    stage,
    reason: 'impact_contract_not_managed',
    policy,
    policy_reason: run?.impact_contract_policy_reason ?? null,
  };
}

async function updateGapRevision(db, gapId, revision) {
  const result = await db.query(
    `UPDATE harness_gaps
     SET current_revision = $2, updated_at = NOW()
     WHERE id = $1 AND status IN ('fixing', 'verifying')
     RETURNING id`,
    [gapId, revision],
  );
  if (result.rows.length === 0) {
    const error = new Error(`repair gap is not writable: ${gapId}`);
    error.code = 'repair_gap_not_writable';
    throw error;
  }
}

async function repairContext(db, task, getGap) {
  const gapId = asObject(task?.payload).harness_gap_id;
  if (!gapId) return null;
  const gap = await getGap(db, gapId);
  if (!gap || gap.repair_task_id !== task?.id || !gap.source_task_id) {
    return { error: 'repair_gap_identity_mismatch', gapId };
  }
  return { gap, gapId, sourceTaskId: gap.source_task_id };
}

export function findCurrentDiffPassReceipt(decisionLog, headRevision, contractHash) {
  const rows = Array.isArray(decisionLog) ? [...decisionLog].reverse() : [];
  for (const row of rows) {
    const detail = asObject(row?.detail);
    const receipt = asObject(detail.impact_gate);
    if (
      receipt.stage === 'diff'
      && ['pass', 'extend'].includes(receipt.gate)
      && receipt.head_revision === headRevision
      && receipt.contract_hash === contractHash
    ) return receipt;
  }
  return null;
}

export async function verifyImpactMergeFence(db, {
  taskId,
  runId,
  headRevision,
  expectedContractHash,
}) {
  const active = await getActiveImpactContract(db, taskId);
  if (!active || active.contract_hash !== expectedContractHash || !SHA_PATTERN.test(headRevision ?? '')) {
    return { gate: 'blocked', reason: 'impact_contract_changed_before_merge' };
  }
  const assertions = active.contract_body?.required_assertions ?? [];
  if (assertions.length === 0) return { gate: 'pass', contract: active };
  const receiptResult = await db.query(
    `SELECT receipt.journey_step_link_id, receipt.assertion_revision,
            receipt.assertion_digest, receipt.assertion_ref_snapshot,
            receipt.command_argv,
            link.assertion_revision AS current_assertion_revision,
            link.assertion_ref AS current_assertion_ref
       FROM journey_assertion_receipts AS receipt
       JOIN journey_step_links AS link
         ON link.id = receipt.journey_step_link_id
       JOIN harness_attempts AS attempt
         ON attempt.id = receipt.harness_attempt_id
        AND attempt.run_id::text = receipt.run_id
        AND attempt.role = 'evaluator'
        AND attempt.status = 'completed'
        AND attempt.result->'decision'->>'outcome' IN ('PASS', 'FIXED')
      WHERE receipt.run_id = $1 AND receipt.source_sha = $2
        AND receipt.impact_contract_id = $3 AND receipt.impact_contract_hash = $4
        AND receipt.verdict = 'PASS' AND receipt.exit_code = 0
        AND receipt.synthetic = false
        AND receipt.executor_kind = 'brain_assertion_runner'`,
    [runId, headRevision, active.id, active.contract_hash],
  );
  const allCovered = assertions.every((assertion) => {
    const bindings = assertion.source_bindings ?? [{
      journey_step_link_id: assertion.journey_step_link_id,
      assertion_revision: assertion.assertion_revision,
      assertion_digest: assertion.assertion_digest,
    }];
    return bindings.every((binding) => receiptResult.rows.some((receipt) => (
      receipt.journey_step_link_id === binding.journey_step_link_id
      && Number(receipt.assertion_revision) === binding.assertion_revision
      && receipt.assertion_digest === binding.assertion_digest
      && receipt.assertion_ref_snapshot === assertion.assertion_id
      && Number(receipt.current_assertion_revision) === binding.assertion_revision
      && receipt.current_assertion_ref === assertion.assertion_id
      && JSON.stringify(receipt.command_argv)
        === JSON.stringify(canonicalAssertionArgv(assertion.assertion_id))
    )));
  });
  return allCovered
    ? { gate: 'pass', contract: active }
    : { gate: 'blocked', reason: 'impact_assertion_receipts_missing' };
}

export function createHarnessImpactGates({
  db,
  getActiveContract = getActiveImpactContract,
  getGap = getGapById,
  transitionGap = transitionGapStatus,
  updateGapRevision: updateRevision = updateGapRevision,
  structureGate = evaluateStructureGate,
  diffGate = evaluateDiffGate,
  readChangedFiles,
  verifyMergeFence = verifyImpactMergeFence,
} = {}) {
  return Object.freeze({
    async beforeGenerate({ task, run }) {
      const payload = asObject(task?.payload);
      const repair = await repairContext(db, task, getGap);
      if (repair?.error) {
        return gateReceipt('structure', { gate: 'blocked', reason: repair.error });
      }
      const taskId = repair?.sourceTaskId ?? task?.id;
      const active = await getActiveContract(db, taskId);
      const exemption = repair ? null : exemptReceipt('structure', run);
      if (!active && exemption) return exemption;
      if (!active) {
        return gateReceipt('structure', {
          gate: 'blocked',
          reason: 'impact_contract_declaration_missing',
          retryable: false,
        });
      }
      if (impactPolicy(run, active) !== 'required') {
        return gateReceipt('structure', {
          gate: 'blocked',
          reason: 'impact_contract_policy_unknown',
          retryable: false,
        });
      }
      const repo = active.repo ?? repoFromTask(task);
      const baseRevision = active.base_revision;
      if (!taskId || !payload.change_kind || !repo || !SHA_PATTERN.test(baseRevision ?? '')) {
        return gateReceipt('structure', {
          gate: 'blocked',
          reason: 'impact_contract_context_missing',
          retryable: false,
        }, { base_revision: baseRevision ?? null });
      }
      const priorBody = asObject(active?.contract_body);
      const contract = {
        ...priorBody,
        task_id: taskId,
        change_kind: active.change_kind ?? payload.change_kind,
        repo,
        base_revision: baseRevision,
        head_revision: active.head_revision ?? null,
        affected_capabilities: priorBody.affected_capabilities ?? [],
        required_assertions: priorBody.required_assertions ?? [],
      };
      const result = await structureGate({
        db,
        task: { ...task, id: taskId, change_kind: contract.change_kind },
        contract,
      });
      if (repair && result.gate === 'pass' && repair.gap.status === 'assigned') {
        await transitionGap(db, repair.gapId, 'fixing', {
          actor: repair.gap.owner ?? 'cecelia-brain',
          idempotencyKey: `fix-started:${repair.gapId}:${active.contract_hash}`,
          detail: { repair_task_id: task.id },
        });
      }
      return gateReceipt('structure', result, {
        base_revision: baseRevision,
        ...(repair ? {
          source_task_id: repair.sourceTaskId,
          harness_gap_id: repair.gapId,
        } : {}),
      });
    },

    async beforeEvaluate({ task, pr, run }) {
      const repair = await repairContext(db, task, getGap);
      if (repair?.error) {
        return gateReceipt('diff', { gate: 'blocked', reason: repair.error });
      }
      const taskId = repair?.sourceTaskId ?? task?.id;
      const active = await getActiveContract(db, taskId);
      const exemption = repair ? null : exemptReceipt('diff', run);
      if (!active && exemption) return exemption;
      const headRevision = pr?.head_sha;
      if (!active || !SHA_PATTERN.test(headRevision ?? '')) {
        return gateReceipt('diff', {
          gate: 'impact_unknown',
          reason: active ? 'head_revision_missing' : 'contract_missing',
          retryable: false,
        }, { head_revision: headRevision ?? null });
      }
      let changedFiles;
      try {
        changedFiles = await readChangedFiles(active.base_revision, headRevision, active.repo);
      } catch {
        return gateReceipt('diff', {
          gate: 'impact_unknown',
          reason: 'git_diff_unavailable',
          retryable: true,
        }, { head_revision: headRevision, contract_hash: active.contract_hash });
      }
      const result = await diffGate({
        db,
        taskId,
        repo: active.repo,
        headRevision,
        changedFiles,
      });
      if (repair && ['pass', 'extend'].includes(result.gate)) {
        await updateRevision(db, repair.gapId, headRevision);
        if (repair.gap.status === 'fixing') {
          await transitionGap(db, repair.gapId, 'verifying', {
            actor: repair.gap.owner ?? 'cecelia-brain',
            idempotencyKey: `verification-started:${repair.gapId}:${headRevision}`,
            detail: { repair_task_id: task.id, source_task_id: repair.sourceTaskId },
          });
        }
      }
      return gateReceipt('diff', result, {
        head_revision: headRevision,
        contract_id: result.contract?.id ?? active.id,
        contract_hash: result.contract?.contract_hash ?? active.contract_hash,
        repo: result.contract?.repo ?? active.repo,
        added_nodes: result.added_nodes ?? [],
        added_assertions: result.added_assertions ?? [],
        required_assertions: result.required_assertions
          ?? result.contract?.contract_body?.required_assertions
          ?? [],
        ...(repair ? {
          source_task_id: repair.sourceTaskId,
          harness_gap_id: repair.gapId,
        } : {}),
      });
    },

    async beforeMerge({ task, pr, decisionLog, run }) {
      const repair = await repairContext(db, task, getGap);
      if (repair?.error) {
        return { gate: 'blocked', stage: 'merge', reason: repair.error, retryable: false };
      }
      const taskId = repair?.sourceTaskId ?? task?.id;
      let active = await getActiveContract(db, taskId);
      const exemption = repair ? null : exemptReceipt('merge', run);
      if (!active && exemption) return exemption;
      if (active) {
        let changedFiles;
        try {
          changedFiles = await readChangedFiles(
            active.base_revision,
            pr?.head_sha,
            active.repo,
          );
        } catch {
          return {
            gate: 'blocked', stage: 'merge', reason: 'git_diff_unavailable', retryable: true,
          };
        }
        const refreshed = await diffGate({
          db,
          taskId,
          repo: active.repo,
          headRevision: pr?.head_sha,
          changedFiles,
        });
        if (!['pass', 'extend'].includes(refreshed.gate)) {
          return {
            gate: 'blocked',
            stage: 'merge',
            reason: refreshed.reason ?? refreshed.reason_code ?? 'impact_merge_revalidation_failed',
            retryable: refreshed.retryable ?? false,
          };
        }
        active = refreshed.contract ?? await getActiveContract(db, taskId);
      }
      const receipt = active
        ? findCurrentDiffPassReceipt(decisionLog, pr?.head_sha, active.contract_hash)
        : null;
      if (!receipt) {
        return { gate: 'blocked', stage: 'merge', reason: 'impact_diff_receipt_missing', retryable: false };
      }
      const fence = await verifyMergeFence(db, {
        taskId,
        runId: run?.id,
        headRevision: pr?.head_sha,
        expectedContractHash: active.contract_hash,
      });
      return fence.gate === 'pass'
        ? {
            gate: 'pass', stage: 'merge', contract_id: active.id,
            contract_hash: active.contract_hash, head_revision: pr.head_sha,
            ...(repair ? {
              source_task_id: repair.sourceTaskId,
              harness_gap_id: repair.gapId,
            } : {}),
          }
        : { ...fence, stage: 'merge', retryable: false };
    },
  });
}
