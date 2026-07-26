import {
  addExplicitModel,
  assertResumeAttempt,
  buildProviderPrompt,
  normalizeProviderResult,
  parseJsonValue,
} from './shared.js';

export const CANARY_NO_TOOL_ARGS = Object.freeze([
  '--ignore-user-config',
  '--ignore-rules',
  '--ephemeral',
  '--disable', 'shell_tool',
  '--disable', 'unified_exec',
  '--disable', 'code_mode_host',
  '--disable', 'browser_use',
  '--disable', 'browser_use_external',
  '--disable', 'browser_use_full_cdp_access',
  '--disable', 'apps',
  '--disable', 'enable_mcp_apps',
  '--disable', 'plugins',
  '--disable', 'image_generation',
  '--disable', 'standalone_web_search',
]);

function outputPaths(bundle, execution) {
  const attemptId = bundle?.attempt_id ?? 'attempt';
  return {
    schemaPath: execution.resultSchemaPath ?? `/tmp/harness-${attemptId}.schema.json`,
    resultPath: execution.resultPath ?? `/tmp/harness-${attemptId}.result.json`,
  };
}

function commonArgs(args, execution, paths) {
  if (execution.canary === true) args.push(...CANARY_NO_TOOL_ARGS);
  args.push(
    '--json',
    '--output-schema', paths.schemaPath,
    '--output-last-message', paths.resultPath,
  );
  if (execution.skipGitRepoCheck !== false) args.push('--skip-git-repo-check');
  addExplicitModel(args, execution.model);
  args.push('-');
}

function invocation({ bundle, execution = {}, sessionId = null, continuation = null }) {
  const paths = outputPaths(bundle, execution);
  const args = sessionId ? ['exec', 'resume', sessionId] : ['exec'];
  commonArgs(args, execution, paths);
  return Object.freeze({
    provider: 'codex',
    canary: execution.canary === true,
    command: execution.command ?? 'codex',
    args,
    cwd: execution.cwd ?? bundle?.inputs?.worktree_path,
    env: execution.codexHome ? { CODEX_HOME: execution.codexHome } : {},
    stdin: buildProviderPrompt(bundle, continuation),
    output: {
      format: 'jsonl',
      result_path: paths.resultPath,
      schema_path: paths.schemaPath,
    },
  });
}

export function readCodexThreadId(stdout) {
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'thread.started' && (event.thread_id || event.thread?.id)) {
        return event.thread_id ?? event.thread.id;
      }
    } catch {
      // Raw diagnostic lines are retained as evidence but are not protocol events.
    }
  }
  return null;
}

export const codexAdapter = Object.freeze({
  name: 'codex',
  capabilities: Object.freeze([
    'structured_output',
    'resume',
    'json_events',
    'output_schema',
    'skills_inline',
  ]),

  start({ bundle, execution = {} }) {
    return invocation({ bundle, execution });
  },

  resume({ attempt, input, execution = {} }) {
    assertResumeAttempt(attempt, 'codex');
    return invocation({
      bundle: attempt.task_bundle,
      execution,
      sessionId: attempt.provider_session_id,
      continuation: input,
    });
  },

  inspect({ attempt }) {
    return { supported: false, provider: 'codex', attempt_id: attempt?.id };
  },

  cancel({ attempt }) {
    return { supported: false, provider: 'codex', attempt_id: attempt?.id };
  },

  normalizeResult({ attempt, raw }) {
    const payload = parseJsonValue(raw?.lastMessage, 'Codex last message');
    return normalizeProviderResult({
      attempt,
      payload,
      provider: 'codex',
      sessionId: readCodexThreadId(raw?.stdout),
    });
  },
});
