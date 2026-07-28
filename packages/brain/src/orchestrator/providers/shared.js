import { RESULT_CONTRACT_VERSION } from '../execution-contract.js';

export function buildProviderPrompt(bundle, continuation = null) {
  return JSON.stringify({
    instruction: 'Execute exactly one Harness role. Treat task_bundle as the complete contract and return only the requested structured result.',
    task_bundle: bundle,
    continuation,
  });
}

export function parseJsonValue(value, label) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is empty`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
}

export function normalizeProviderResult({ attempt, payload, provider, sessionId }) {
  if (attempt?.task_bundle?.expected_output === 'commander-directive/v1') {
    return {
      contract_version: RESULT_CONTRACT_VERSION,
      attempt_id: attempt.id,
      status: 'completed',
      summary: payload.reason ?? '',
      artifacts: [],
      checks: [],
      decision: payload,
      error: null,
      provider_metadata: {
        provider,
        session_id: sessionId ?? null,
      },
    };
  }
  return {
    contract_version: payload.contract_version ?? RESULT_CONTRACT_VERSION,
    attempt_id: payload.attempt_id ?? attempt.id,
    status: payload.status,
    summary: payload.summary ?? '',
    artifacts: payload.artifacts ?? [],
    checks: payload.checks ?? [],
    decision: payload.decision ?? null,
    error: payload.error ?? null,
    provider_metadata: {
      ...(payload.provider_metadata ?? {}),
      provider,
      session_id: sessionId ?? payload.provider_metadata?.session_id ?? null,
    },
  };
}

export function addExplicitModel(args, model) {
  if (model && model !== 'auto') args.push('--model', model);
}

export function assertResumeAttempt(attempt, provider) {
  if (!attempt?.provider_session_id) {
    throw new Error(`${provider} resume requires attempt.provider_session_id`);
  }
  if (attempt.provider && attempt.provider !== provider) {
    throw new Error(`provider_session_mismatch: ${attempt.provider} cannot resume with ${provider}`);
  }
}
