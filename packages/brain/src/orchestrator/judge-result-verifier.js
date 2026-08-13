import { runJudgeGate } from '../harness-judge.js';

function evaluatorBrainResult(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    verdict: value.decision?.outcome ?? value.verdict ?? null,
    behavior_tests: Array.isArray(value.behavior_tests)
      ? value.behavior_tests
      : Array.isArray(value.checks)
        ? value.checks
        : [],
    judgments_written: value.judgments_written ?? value.decision?.judgments_written,
    summary: value.summary ?? null,
  };
}

export async function verifyJudgeCallbackResult({ attempt, result, dbPool }) {
  if (attempt?.role !== 'judge') return result;
  if (!['completed', 'completed_with_concerns'].includes(result?.status)) return result;

  const inputs = attempt.task_bundle?.inputs ?? {};
  const evaluator = evaluatorBrainResult(inputs.evaluator_result);
  const candidateHeadSha = inputs.candidate?.head_sha ?? null;
  const pr = inputs.pull_request ?? null;
  const targetHeadSha = pr?.head_sha ?? candidateHeadSha;
  const providerDecision = result.decision ?? {};
  const judged = await runJudgeGate({
    agentVerdict: evaluator?.verdict,
    agentFeedback: inputs.evaluator_result?.decision?.reason ?? null,
    brainResult: evaluator,
    transcript: inputs.evaluator_result?.transcript,
    sprintDir: inputs.sprint_dir,
    contractText: inputs.contract?.contract_content ?? null,
    prdText: inputs.contract?.prd_content ?? null,
    frozenContractArtifacts: inputs.artifacts,
    requiredCommandEvidence: inputs.required_command_evidence,
    taskId: inputs.task_id,
    instanceLabel: `fleet-judge-${String(attempt.id).slice(0, 8)}`,
    stageFacts: {
      current_stage: pr ? 'independent_judge' : 'local_candidate',
      pr_state: pr?.state ?? null,
      pr_merged: pr?.merged === true,
      head_sha: targetHeadSha,
      merge_gate_approved: false,
    },
  }, {
    strict: true,
    dbPool,
    judgeFn: async () => ({
      verdict: providerDecision.outcome ?? providerDecision.verdict,
      coverage: Array.isArray(providerDecision.coverage) ? providerDecision.coverage : [],
      feedback: providerDecision.reason ?? providerDecision.feedback ?? result.summary,
      failure_class: providerDecision.failure_class ?? null,
      failure_signature: providerDecision.failure_signature ?? null,
    }),
  });

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
    },
  };
}
