/**
 * dev-failure-classifier.js
 *
 * Dev 任务失败分类器（专用）
 *
 * 与 quarantine.js 的 classifyFailure 互补：
 * - quarantine.js 处理系统级失败（billing_cap, rate_limit, network, auth, resource）
 * - 本模块处理 dev 任务特有的失败语义：
 *   - transient: CI flaky、暂时性错误 → 可重试
 *   - code_error: 编译失败、测试失败、PR 被拒 → 可重试（带反馈）
 *   - auth: 权限不足、token 过期 → 不重试
 *   - resource: 磁盘满、内存不足（文本匹配）→ 不重试
 *   - resource_killed: OOM/SIGKILL（exit_code=137）→ 降并发延迟重试
 *
 * 使用场景：
 *   执行 /dev 任务的 execution-callback，收到 AI Failed 时，
 *   在 quarantine classifyFailure 无法处理（TASK_ERROR）时，
 *   进一步用本模块做 dev-specific 分类。
 *
 * 纯函数模块，无副作用，100% 单元测试覆盖。
 */

/* global console */

// ============================================================
// 失败类别常量
// ============================================================

export const DEV_FAILURE_CLASS = {
  TRANSIENT: 'transient',             // 暂时性错误：CI flaky、网络波动、限流
  CODE_ERROR: 'code_error',           // 代码错误：编译失败、测试失败
  AUTH: 'auth',                       // 权限/认证错误
  RESOURCE: 'resource',               // 资源不足（文本匹配：ENOMEM/ENOSPC）
  RESOURCE_KILLED: 'resource_killed', // OOM/SIGKILL（exit_code=137）→ 可降并发重试
  UNKNOWN: 'unknown',                 // 无法识别
};

// ============================================================
// 失败模式
// ============================================================

// transient：暂时性，可重试
const TRANSIENT_PATTERNS = [
  // CI flaky
  /ci.*flaky|flaky.*test/i,
  /test.*timeout|timeout.*test/i,
  /runner.*unavailable|no.*runner/i,
  /workflow.*cancelled|cancelled.*workflow/i,
  /job.*cancelled/i,
  /exceeded.*timeout/i,
  // 网络类
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH/i,
  /connection\s+refused|connection\s+reset/i,
  /network\s+error|socket\s+hang\s+up/i,
  /ECONNRESET/i,
  /service\s+unavailable|bad\s+gateway/i,
  /upstream\s+connect\s+error/i,
  // 限流 / API 重试
  /too\s+many\s+requests/i,
  /rate\s+limit/i,
  /429/,
  /overloaded/i,
  /resource\s+exhausted/i,
  /quota\s+exceeded/i,
  // GitHub API 临时错误
  /secondary\s+rate\s+limit/i,
  /abuse\s+detection/i,
  // 通用暂时性
  /temporarily\s+unavailable/i,
  /retry\s+later/i,
];

// code_error：代码/CI 错误，可重试（带上次失败信息）
const CODE_ERROR_PATTERNS = [
  // 编译失败
  /TypeScript.*error|tsc.*error|compilation.*failed/i,
  /build.*failed|npm.*build.*failed/i,
  /syntax\s+error/i,
  /Cannot\s+find\s+module/i,
  /Module\s+not\s+found/i,
  /SyntaxError:/i,
  /ReferenceError:/i,
  // 测试失败
  /test.*failed|tests.*failed/i,
  /FAIL\s+packages?\/|FAIL\s+src\//i,
  /vitest.*failed|jest.*failed/i,
  /assertion.*failed|AssertionError/i,
  /expect.*received|expected.*received/i,
  /\d+\s+tests?\s+failed/i,
  // CI/PR 失败
  /ci.*failed|CI.*check.*failed/i,
  /check.*failed.*required/i,
  /merge.*conflict/i,
  /pr.*review.*changes.*requested/i,
  // DevGate 失败
  /DevGate.*failed|facts.check.*failed/i,
  /version.*sync.*failed/i,
  /dod.*mapping.*failed/i,
  // Lint / 格式
  /eslint.*error|lint.*failed/i,
  /prettier.*failed/i,
];

// auth：权限类，不重试
const AUTH_PATTERNS = [
  /permission\s+denied|access\s+denied|unauthorized/i,
  /EACCES|EPERM/i,
  /authentication\s+failed|auth\s+error/i,
  /invalid.*api.*key|api.*key.*invalid/i,
  /forbidden/i,
  /token.*expired|expired.*token/i,
  /not\s+authorized/i,
  /ssh.*denied|publickey.*denied/i,
];

// resource：资源类（文本匹配），不重试
const RESOURCE_PATTERNS = [
  /ENOMEM|out\s+of\s+memory/i,
  /disk\s+full|no\s+space\s+left/i,
  /ENOSPC/i,
  /oom\b/i,
  /killed.*memory|memory.*killed/i,
];

// ============================================================
// 重试配置
// ============================================================

export const MAX_DEV_RETRY = 3;
export const MAX_OOM_RETRY = MAX_DEV_RETRY; // OOM 重试上限（与 dev retry 一致）

/**
 * 计算指数退避的下次运行时间
 * retry 1 → 5min, retry 2 → 10min, retry 3 → 15min
 * @param {number} retryCount - 当前是第几次重试（从 1 开始）
 * @returns {string} ISO 8601 时间字符串
 */
export function calcNextRunAt(retryCount) {
  const delayMs = retryCount * 5 * 60 * 1000;
  return new Date(Date.now() + delayMs).toISOString();
}

/**
 * 计算 OOM/SIGKILL 重试的下次运行时间（更长延迟，让系统恢复）
 * retry 1 → 15min, retry 2 → 30min, retry 3+ → 30min
 * @param {number} retryCount - 当前是第几次重试（从 1 开始）
 * @returns {string} ISO 8601 时间字符串
 */
export function calcNextRunAtOom(retryCount) {
  const minutes = retryCount === 1 ? 15 : 30;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ============================================================
// 主分类函数
// ============================================================

/**
 * 分类 dev 任务失败原因
 *
 * @param {string|Object|null} result - cecelia-run 返回的 result 字段
 * @param {string} [status='AI Failed'] - 执行状态（'AI Done' | 'AI Failed'）
 * @param {Object} [context={}] - 额外上下文
 * @param {number} [context.retryCount=0] - 已重试次数（payload.retry_count）
 * @param {number} [context.exit_code] - 进程退出码（直接从 execution callback 获取）
 * @returns {{
 *   class: string,
 *   retryable: boolean,
 *   reason: string,
 *   reduce_concurrency?: boolean,
 *   needs_blocked?: boolean,
 *   next_run_at?: string,
 *   retry_reason?: string,
 *   previous_failure?: { class: string, error_excerpt: string }
 * }}
 */
export function classifyDevFailure(result, status = 'AI Failed', context = {}) {
  const { retryCount = 0, exit_code } = context;

  // 提取错误文本
  const errorMsg = extractErrorMsg(result, status);

  // exit_code 直接分流（优先级最高，在文本匹配之前）
  // exit_code=137: OOM/SIGKILL → resource_killed，可降并发重试
  if (exit_code === 137) {
    return buildResult(DEV_FAILURE_CLASS.RESOURCE_KILLED, errorMsg, retryCount);
  }
  // exit_code=1: 代码级错误 → code_error + needs_blocked（直接阻塞，不自动重试）
  if (exit_code === 1) {
    return buildResult(DEV_FAILURE_CLASS.CODE_ERROR, errorMsg, retryCount, { needs_blocked: true });
  }

  // 文本模式匹配（按优先级：auth/resource 优先，避免误判）
  const patternGroups = [
    { patterns: AUTH_PATTERNS, class: DEV_FAILURE_CLASS.AUTH },
    { patterns: RESOURCE_PATTERNS, class: DEV_FAILURE_CLASS.RESOURCE },
    { patterns: TRANSIENT_PATTERNS, class: DEV_FAILURE_CLASS.TRANSIENT },
    { patterns: CODE_ERROR_PATTERNS, class: DEV_FAILURE_CLASS.CODE_ERROR },
  ];

  for (const group of patternGroups) {
    for (const pattern of group.patterns) {
      if (pattern.test(errorMsg)) {
        return buildResult(group.class, errorMsg, retryCount);
      }
    }
  }

  // 无法识别 → unknown，不重试
  return {
    class: DEV_FAILURE_CLASS.UNKNOWN,
    retryable: false,
    reason: 'Dev failure: unrecognized pattern, will not retry',
    previous_failure: {
      class: DEV_FAILURE_CLASS.UNKNOWN,
      error_excerpt: errorMsg.slice(0, 300),
    },
  };
}

// ============================================================
// 内部辅助
// ============================================================

function extractErrorMsg(result, status) {
  if (result !== null && typeof result === 'object') {
    return String(result.result || result.error || result.stderr || JSON.stringify(result));
  }
  return String(result || status || '');
}

/**
 * @param {string} failureClass
 * @param {string} errorMsg
 * @param {number} retryCount
 * @param {Object} [opts]
 * @param {boolean} [opts.needs_blocked] - true 表示应直接阻塞等待人工
 */
function buildResult(failureClass, errorMsg, retryCount, opts = {}) {
  const previousFailure = {
    class: failureClass,
    error_excerpt: errorMsg.slice(0, 300),
  };

  switch (failureClass) {
    case DEV_FAILURE_CLASS.AUTH:
      return {
        class: failureClass,
        retryable: false,
        reason: 'Auth/permission error - requires human intervention',
        previous_failure: previousFailure,
      };

    case DEV_FAILURE_CLASS.RESOURCE:
      return {
        class: failureClass,
        retryable: false,
        reason: 'Resource exhaustion - requires human intervention',
        previous_failure: previousFailure,
      };

    case DEV_FAILURE_CLASS.RESOURCE_KILLED: {
      if (retryCount >= MAX_DEV_RETRY) {
        return {
          class: failureClass,
          retryable: false,
          reason: `OOM/SIGKILL retries exhausted (${MAX_DEV_RETRY}/${MAX_DEV_RETRY})`,
          previous_failure: previousFailure,
        };
      }
      const next_run_at = calcNextRunAtOom(retryCount + 1);
      return {
        class: failureClass,
        retryable: true,
        reduce_concurrency: true,
        reason: `OOM/SIGKILL (exit_code=137), retry #${retryCount + 1} with longer delay`,
        next_run_at,
        retry_reason: `上次因 OOM/SIGKILL 失败（exit_code=137），建议 Agent 降低并发操作数量后重试`,
        previous_failure: previousFailure,
      };
    }

    case DEV_FAILURE_CLASS.TRANSIENT: {
      if (retryCount >= MAX_DEV_RETRY) {
        return {
          class: failureClass,
          retryable: false,
          reason: `Transient error retries exhausted (${MAX_DEV_RETRY}/${MAX_DEV_RETRY})`,
          previous_failure: previousFailure,
        };
      }
      const next_run_at = calcNextRunAt(retryCount + 1);
      return {
        class: failureClass,
        retryable: true,
        reason: `Transient error, retry #${retryCount + 1} scheduled`,
        next_run_at,
        retry_reason: `上次因 transient 错误失败（${failureClass}），自动重试`,
        previous_failure: previousFailure,
      };
    }

    case DEV_FAILURE_CLASS.CODE_ERROR: {
      // exit_code=1 直接分流时：needs_blocked=true → 不重试，直接阻塞
      if (opts.needs_blocked) {
        return {
          class: failureClass,
          retryable: false,
          needs_blocked: true,
          reason: 'Code error (exit_code=1) - requires human intervention',
          previous_failure: previousFailure,
        };
      }
      // 文本匹配的 code_error：仍可重试（带反馈）
      if (retryCount >= MAX_DEV_RETRY) {
        return {
          class: failureClass,
          retryable: false,
          reason: `Code error retries exhausted (${MAX_DEV_RETRY}/${MAX_DEV_RETRY})`,
          previous_failure: previousFailure,
        };
      }
      const next_run_at = calcNextRunAt(retryCount + 1);
      return {
        class: failureClass,
        retryable: true,
        reason: `Code error, retry #${retryCount + 1} with previous failure context`,
        next_run_at,
        retry_reason: `上次因代码错误失败（编译/测试），请优先检查 CI 日志再改代码`,
        previous_failure: previousFailure,
      };
    }

    default:
      return {
        class: failureClass,
        retryable: false,
        reason: `Unknown failure class: ${failureClass}`,
        previous_failure: previousFailure,
      };
  }
}
