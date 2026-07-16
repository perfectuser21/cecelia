/**
 * harness-death-classifier.js
 * 死因分类器（刀A8-1）
 * 纯函数，无 import，无 async，无 fs/net/db
 *
 * @param {{ exitCode: number|null, stdoutTail: string|null, tmuxPane: string|null }} evidence
 * @returns {{ cause: string, action: string }}
 */
export function classifyDeath({ exitCode, stdoutTail, tmuxPane }) {
  const tail = (stdoutTail ?? '').toLowerCase();

  // 1. OOM: exitCode === 137
  if (exitCode === 137) {
    return { cause: 'oom', action: 'oom_upgrade' };
  }

  // 2. auth 错误
  if (
    tail.includes('401') ||
    tail.includes('403') ||
    tail.includes('unauthorized') ||
    tail.includes('invalid api key') ||
    tail.includes('credentials')
  ) {
    return { cause: 'auth', action: 'auth_retry' };
  }

  // 3. rate limit
  if (
    tail.includes('429') ||
    tail.includes('quota') ||
    tail.includes('rate limit') ||
    tail.includes('overloaded') ||
    tail.includes('too many requests')
  ) {
    return { cause: 'rate_limit', action: 'rate_limit_defer' };
  }

  // 4. interactive stuck（tmuxPane 含交互提示）
  if (
    /press enter|press esc|choose|select|\[y\/n\]/i.test(tmuxPane ?? '')
  ) {
    return { cause: 'interactive_stuck', action: 'kill_refire' };
  }

  // 5. CI_RED（watchdog 注入标记，大小写敏感）
  if ((stdoutTail ?? '').includes('CI_RED')) {
    return { cause: 'ci_red', action: 'ci_red_refire' };
  }

  // 6. GREEN_WAITING
  if ((stdoutTail ?? '').includes('GREEN_WAITING')) {
    return { cause: 'green_waiting_merge', action: 'await_merge' };
  }

  // 7. fallback
  return { cause: 'unknown', action: 'log_only' };
}
