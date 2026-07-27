import {
  addExplicitModel,
  assertResumeAttempt,
  buildProviderPrompt,
  normalizeProviderResult,
  parseJsonValue,
} from './shared.js';

const DEFAULT_RESULT_SCHEMA = { type: 'object' };

function invocation({ bundle, execution = {}, sessionId = null, continuation = null }) {
  const prompt = buildProviderPrompt(bundle, continuation);
  const cwd = bundle?.inputs?.execution_surface === 'fleet-worker'
    ? '/workspace'
    : execution.cwd ?? bundle?.inputs?.worktree_path;
  const args = [
    '-p', prompt,
    '--cwd', cwd,
    '--always-approve',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(execution.resultSchema ?? DEFAULT_RESULT_SCHEMA),
  ];
  if (sessionId) args.push('--resume', sessionId);
  else args.push('--session-id', bundle.attempt_id);
  addExplicitModel(args, execution.model);

  return Object.freeze({
    provider: 'grok',
    command: execution.command ?? 'grok',
    args,
    cwd,
    env: execution.grokHome ? { GROK_HOME: execution.grokHome } : {},
    stdin: prompt,
    output: { format: 'json' },
  });
}

export const grokAdapter = Object.freeze({
  name: 'grok',
  capabilities: Object.freeze(['structured_output', 'resume', 'json_schema', 'skills_inline']),

  start({ bundle, execution = {} }) {
    return invocation({ bundle, execution });
  },

  resume({ attempt, input, execution = {} }) {
    assertResumeAttempt(attempt, 'grok');
    return invocation({
      bundle: attempt.task_bundle,
      execution,
      sessionId: attempt.provider_session_id,
      continuation: input,
    });
  },

  inspect({ attempt }) {
    return { supported: false, provider: 'grok', attempt_id: attempt?.id };
  },

  cancel({ attempt }) {
    return { supported: false, provider: 'grok', attempt_id: attempt?.id };
  },

  normalizeResult({ attempt, raw }) {
    const wrapper = parseJsonValue(raw?.stdout, 'Grok stdout');
    const candidate = wrapper.structuredOutput ?? wrapper.structured_output ?? wrapper.result ?? wrapper;
    const payload = typeof candidate === 'string'
      ? parseJsonValue(candidate, 'Grok result')
      : candidate;
    return normalizeProviderResult({
      attempt,
      payload,
      provider: 'grok',
      sessionId: wrapper.sessionId ?? wrapper.session_id ?? wrapper.session?.id,
    });
  },
});
