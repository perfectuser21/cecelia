function normalizedCommand(value) {
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * 对账任务声明的 required_command_evidence 与 Evaluator 的结构化执行证据。
 * 声明存在时必须是非空字符串数组，且每条命令都要逐字匹配一条 exit_code=0、
 * log_tail 非空的 behavior_test；禁止用摘要或相似命令代替。
 */
export function reconcileRequiredCommandEvidence(required, behaviorTests) {
  if (required === undefined || required === null) {
    return { provided: false, valid: false, complete: false, missing: [] };
  }
  if (!Array.isArray(required) || required.length === 0) {
    return {
      provided: true,
      valid: false,
      complete: false,
      missing: [],
      invalidReason: 'required_command_evidence 必须是非空字符串数组',
    };
  }

  const commands = required.map(normalizedCommand);
  if (commands.some((command) => !command)) {
    return {
      provided: true,
      valid: false,
      complete: false,
      missing: [],
      invalidReason: 'required_command_evidence 只能包含非空字符串',
    };
  }

  const successfulCommands = new Set(
    (Array.isArray(behaviorTests) ? behaviorTests : [])
      .filter((item) => item?.exit_code === 0 && String(item?.log_tail ?? '').trim())
      .map((item) => normalizedCommand(item?.command))
      .filter(Boolean),
  );
  const missing = commands.filter((command) => !successfulCommands.has(command));
  return {
    provided: true,
    valid: true,
    complete: missing.length === 0,
    missing,
  };
}
