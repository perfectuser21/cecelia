/**
 * Dev Failure Classifier
 *
 * 对 dev 任务失败进行智能分类，决定是否可以自动重试。
 *
 * 分类体系（针对 dev 任务场景）：
 *   transient  - 网络超时、CI flaky、rate limit → 可重试
 *   code_error - 编译错误、测试失败 → 可重试（带反馈）
 *   auth       - 权限不足、token 过期 → 不重试，需人工
 *   resource   - 磁盘满、内存不足 → 不重试，需告警
 *
 * 纯函数，无 DB 依赖，100% 单元可测。
 */

/* global console */

// ============================================================
// 失败类别
// ============================================================

export const DEV_FAILURE_CLASS = {
  TRANSIENT: 'transient',
  CODE_ERROR: 'code_error',
  AUTH: 'auth',
  RESOURCE: 'resource',
};

// ============================================================
// 分类规则（按优先级顺序，先匹配先生效）
// ============================================================

const CLASSIFICATION_RULES = [
  // AUTH：权限 / 认证 → 不重试（最高优先级，避免被误判为 transient）
  {
    class: DEV_FAILURE_CLASS.AUTH,
    retryable: false,
    patterns: [
      /permission\s+denied/i,
      /unauthorized/i,
      /authentication\s+failed/i,
      /token\s+expired/i,
      /token\s+invalid/i,
      /access\s+denied/i,
      /forbidden/i,
      /invalid\s+credentials/i,
      /ssh\s+auth\s+fail/i,
      /bad\s+credentials/i,
      /403/,
      /401/,
    ],
  },
  // RESOURCE：磁盘满 / 内存不足 → 不重试（需人工处理）
  {
    class: DEV_FAILURE_CLASS.RESOURCE,
    retryable: false,
    patterns: [
      /disk\s+full/i,
      /no\s+space\s+left/i,
      /ENOSPC/,
      /out\s+of\s+(memory|disk)/i,
      /cannot\s+allocate\s+memory/i,
      /ENOMEM/,
      /memory\s+exhausted/i,
      /storage\s+full/i,
    ],
  },
  // CODE_ERROR：编译 / 测试 / lint 失败 → 可重试（带失败上下文供下次修复）
  {
    class: DEV_FAILURE_CLASS.CODE_ERROR,
    retryable: true,
    patterns: [
      /compilation\s+error/i,
      /compile\s+error/i,
      /syntax\s+error/i,
      /type\s+error/i,
      /typescript\s+(error|failed|compilation)/i,
      /tsc\s+failed/i,
      /eslint\s+(error|failed)/i,
      /lint\s+(error|failed)/i,
      /test(s)?\s+(failed|suite\s+failed)/i,
      /test\s+failure/i,
      /assertion\s+failed/i,
      /expect.*received/i,
      /build\s+failed/i,
      /npm\s+run\s+build\s+failed/i,
      /vitest\s+failed/i,
      /jest\s+failed/i,
    ],
  },
  // TRANSIENT：网络 / CI / rate limit / 超时 → 可重试
  {
    class: DEV_FAILURE_CLASS.TRANSIENT,
    retryable: true,
    patterns: [
      /timeout/i,
      /timed?\s+out/i,
      /ETIMEDOUT/,
      /ECONNRESET/,
      /ECONNREFUSED/,
      /ENOTFOUND/,
      /network\s+error/i,
      /network\s+failure/i,
      /connection\s+(refused|reset|lost|closed)/i,
      /socket\s+(hang|closed|error)/i,
      /rate\s+limit/i,
      /too\s+many\s+requests/i,
      /429/,
      /CI\s+(check\s+)?(failed|failure)/i,
      /github\s+actions?\s+fail/i,
      /pipeline\s+(failed|failure)/i,
      /flaky/i,
      /overloaded/i,
      /service\s+unavailable/i,
      /503/,
      /502/,
    ],
  },
];

// ============================================================
// 核心分类函数
// ============================================================

/**
 * 提取失败信息字符串（统一入口，支持多种 result 格式）
 *
 * @param {*} result - execution-callback 传入的 result 对象
 * @param {string} [status] - 原始状态字符串（可包含附加信息）
 * @returns {string} 拼接后的错误信息字符串
 */
function extractErrorString(result, status) {
  const parts = [];

  if (typeof result === 'string') {
    parts.push(result);
  } else if (result && typeof result === 'object') {
    // 支持 { result, error, message, log_snippet, output, stderr } 等字段
    for (const field of ['result', 'error', 'message', 'log_snippet', 'output', 'stderr']) {
      if (result[field] && typeof result[field] === 'string') {
        parts.push(result[field]);
      }
    }
    // 如果没有已知字段，取 JSON 字符串（截取前 500 字符）
    if (parts.length === 0) {
      parts.push(JSON.stringify(result).substring(0, 500));
    }
  }

  if (status && typeof status === 'string') {
    parts.push(status);
  }

  return parts.join(' ');
}

/**
 * 对 dev 任务失败进行分类
 *
 * @param {*} result - execution-callback 的 result 字段
 * @param {string} [status] - 原始状态（如 "AI Failed"）
 * @returns {{ class: string, retryable: boolean, reason: string }}
 */
export function classifyDevFailure(result, status) {
  const errorStr = extractErrorString(result, status);

  for (const rule of CLASSIFICATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(errorStr)) {
        return {
          class: rule.class,
          retryable: rule.retryable,
          reason: `matched pattern: ${pattern} in "${errorStr.substring(0, 100)}"`,
        };
      }
    }
  }

  // 默认：未知错误归为 transient（保守策略，尽量重试）
  console.warn(`[dev-failure-classifier] unrecognized failure, default transient: "${errorStr.substring(0, 100)}"`);
  return {
    class: DEV_FAILURE_CLASS.TRANSIENT,
    retryable: true,
    reason: `unrecognized failure, default transient: "${errorStr.substring(0, 100)}"`,
  };
}
