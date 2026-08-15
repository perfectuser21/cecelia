function behaviorTestFromCheck(check) {
  if (
    !check
    || typeof check !== 'object'
    || Array.isArray(check)
    || typeof check.assertion_id !== 'string'
    || !Array.isArray(check.command_argv)
  ) return check;
  return {
    ...check,
    command: `required_assertion:${check.assertion_id} argv:${JSON.stringify(check.command_argv)}`,
    log_tail: typeof check.output_tail === 'string' ? check.output_tail : '',
  };
}

export function normalizeEvaluatorBrainResult(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.behavior_tests)) return value;
  return {
    verdict: value.decision?.outcome ?? value.verdict ?? null,
    behavior_tests: Array.isArray(value.checks)
      ? value.checks.map(behaviorTestFromCheck)
      : [],
    judgments_written: value.judgments_written ?? value.decision?.judgments_written,
    summary: value.summary ?? null,
    findings: Array.isArray(value.findings) ? value.findings : [],
    screenshots: Array.isArray(value.screenshots) ? value.screenshots : [],
    exploration_notes: Array.isArray(value.exploration_notes) ? value.exploration_notes : [],
  };
}
