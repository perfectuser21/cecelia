import { runJudgeGate } from '../harness-judge.js';
import { parseJudgeDecision } from './execution-contract.js';
import { normalizeEvaluatorBrainResult } from './evaluator-brain-result.js';

function normalizeEvaluatorPassVerdict(verdict) {
  return ['PASS', 'FIXED', 'PASS_WITH_CONCERNS'].includes(verdict)
    ? 'PASS'
    : verdict;
}

function requireJudgeProviderOutcome(decision) {
  const outcome = decision?.outcome ?? decision?.verdict;
  if (!['PASS', 'FAIL'].includes(outcome)) {
    const error = new Error('judge_provider_outcome_invalid');
    error.status = 409;
    throw error;
  }
  return outcome;
}

export async function verifyJudgeCallbackResult({ attempt, result, dbPool }) {
  if (attempt?.role !== 'judge') return result;
  if (!['completed', 'completed_with_concerns'].includes(result?.status)) return result;

  const inputs = attempt.task_bundle?.inputs ?? {};
  const evaluator = normalizeEvaluatorBrainResult(inputs.evaluator_result);
  const candidateHeadSha = inputs.candidate?.head_sha ?? null;
  const pr = inputs.pull_request ?? null;
  const unpublishedCandidate = candidateHeadSha != null
    && candidateHeadSha !== pr?.head_sha;
  const targetHeadSha = unpublishedCandidate ? candidateHeadSha : pr?.head_sha ?? candidateHeadSha;
  const providerDecision = parseJudgeDecision(result.decision ?? {});
  const providerOutcome = requireJudgeProviderOutcome(providerDecision);
  const judged = await runJudgeGate({
    agentVerdict: normalizeEvaluatorPassVerdict(evaluator?.verdict),
    agentFeedback: inputs.evaluator_result?.decision?.reason ?? null,
    brainResult: evaluator,
    transcript: inputs.evaluator_result?.transcript,
    sprintDir: inputs.sprint_dir,
    contractText: inputs.contract?.contract_content ?? null,
    prdText: inputs.contract?.prd_content ?? null,
    frozenContractArtifacts: inputs.artifacts,
    requiredCommandEvidence: inputs.required_command_evidence,
    verificationStage: inputs.verification_stage,
    taskId: inputs.task_id,
    instanceLabel: `fleet-judge-${String(attempt.id).slice(0, 8)}`,
    stageFacts: {
      current_stage: pr && !unpublishedCandidate ? 'independent_judge' : 'local_candidate',
      pr_state: pr && !unpublishedCandidate ? pr.state ?? null : null,
      pr_merged: pr && !unpublishedCandidate ? pr.merged === true : false,
      head_sha: targetHeadSha,
      merge_gate_approved: false,
    },
  }, {
    strict: true,
    dbPool,
    judgeFn: async () => ({
      verdict: providerOutcome,
      coverage: Array.isArray(providerDecision.coverage) ? providerDecision.coverage : [],
      feedback: providerDecision.reason ?? providerDecision.feedback ?? result.summary,
      failure_class: providerDecision.failure_class ?? null,
      failure_signature: providerDecision.failure_signature ?? null,
    }),
  });

  if (judged.judged !== true) {
    const error = new Error('independent_judge_not_completed');
    error.status = 409;
    error.cause = judged.judgeError ?? judged.feedback ?? null;
    throw error;
  }

  return {
    ...result,
    summary: judged.feedback ?? result.summary,
    decision: {
      outcome: judged.verdict,
      reason: judged.feedback ?? 'server-verified independent judge verdict',
      ...(judged.failure_class == null ? {} : { failure_class: judged.failure_class }),
      ...(judged.failure_signature == null
        ? {}
        : { failure_signature: judged.failure_signature }),
      ...(Array.isArray(judged.coverage) ? { coverage: judged.coverage } : {}),
    },
  };
}
