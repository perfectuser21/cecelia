import {
  addExplicitModel,
  assertResumeAttempt,
  buildProviderPrompt,
  normalizeProviderResult,
  parseJsonValue,
} from './shared.js';

const DEFAULT_RESULT_SCHEMA = { type: 'object' };

function invocation({ bundle, execution = {}, sessionId = null, continuation = null }) {
  const args = ['-p', '--output-format', 'json'];
  if (sessionId) args.push('--resume', sessionId);
  else args.push('--session-id', bundle.attempt_id);
  addExplicitModel(args, execution.model);
  args.push('--json-schema', JSON.stringify(execution.resultSchema ?? DEFAULT_RESULT_SCHEMA));

  return Object.freeze({
    provider: 'claude',
    command: execution.command ?? 'claude',
    args,
    cwd: execution.cwd ?? bundle?.inputs?.worktree_path,
    env: execution.claudeHome ? { CLAUDE_CONFIG_DIR: execution.claudeHome } : {},
    stdin: buildProviderPrompt(bundle, continuation),
    output: { format: 'json' },
  });
}

export const claudeAdapter = Object.freeze({
  name: 'claude',
  capabilities: Object.freeze(['structured_output', 'resume', 'skills_inline']),

  start({ bundle, execution = {} }) {
    return invocation({ bundle, execution });
  },

  resume({ attempt, input, execution = {} }) {
    assertResumeAttempt(attempt, 'claude');
    return invocation({
      bundle: attempt.task_bundle,
      execution,
      sessionId: attempt.provider_session_id,
      continuation: input,
    });
  },

  inspect({ attempt }) {
    return { supported: false, provider: 'claude', attempt_id: attempt?.id };
  },

  cancel({ attempt }) {
    return { supported: false, provider: 'claude', attempt_id: attempt?.id };
  },

  normalizeResult({ attempt, raw }) {
    const wrapper = parseJsonValue(raw?.stdout, 'Claude stdout');
    const payload = parseJsonValue(wrapper.structured_output ?? wrapper.result, 'Claude result');
    return normalizeProviderResult({
      attempt,
      payload,
      provider: 'claude',
      sessionId: wrapper.session_id,
    });
  },
});
