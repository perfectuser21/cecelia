/**
 * ci-diagnostics.js
 *
 * CI 失败自动诊断模块
 *
 * 通过 `gh run view --log-failed` 获取真实 CI 日志，
 * 将日志解析为 7 种细化失败类别，补充 dev-failure-classifier.js 无法覆盖的场景。
 *
 * 纯函数 + 依赖注入设计，无副作用，100% 单元可测。
 */

// ============================================================
// 失败类别常量
// ============================================================

export const CI_FAILURE_CLASS = {
  TEST_FAILURE:      'test_failure',      // 测试断言失败（vitest/jest）
  TYPE_ERROR:        'type_error',        // TypeScript 类型错误 / ESLint
  MISSING_DEP:       'missing_dep',       // 缺少依赖（Cannot find module）
  VERSION_MISMATCH:  'version_mismatch',  // 版本不同步
  TIMEOUT:           'timeout',           // 超时
  FLAKY:             'flaky',             // 随机性失败（网络/runner）
  UNKNOWN:           'unknown',           // 无法识别
};

// ============================================================
// 日志模式（按优先级排列）
// ============================================================

const LOG_PATTERNS = [
  {
    class: CI_FAILURE_CLASS.VERSION_MISMATCH,
    retryable: false,
    patterns: [
      /version.*mismatch|mismatch.*version/i,
      /check-version-sync/i,
      /版本不一致|版本同步/,
      /package\.json.*version.*differs/i,
      /VERSION\s+file.*mismatch/i,
      /\.brain-versions.*mismatch/i,
    ],
  },
  {
    class: CI_FAILURE_CLASS.MISSING_DEP,
    retryable: false,
    patterns: [
      /Cannot\s+find\s+module/i,
      /Module\s+not\s+found/i,
      /Cannot\s+resolve\s+module/i,
      /ENOENT.*node_modules/i,
      /npm\s+ERR!\s+missing/i,
      /peer\s+dep\s+missing/i,
    ],
  },
  {
    class: CI_FAILURE_CLASS.TYPE_ERROR,
    retryable: false,
    patterns: [
      /error\s+TS\d+:/i,
      /TypeScript.*error|tsc.*error/i,
      /Type\s+'[^']+'\s+is\s+not\s+assignable/i,
      /Property\s+'[^']+'\s+does\s+not\s+exist/i,
      /eslint.*error|error.*eslint/i,
      /\d+\s+errors?\s+found\s+in/i,
      /Argument\s+of\s+type\s+.*not\s+assignable/i,
    ],
  },
  {
    class: CI_FAILURE_CLASS.TEST_FAILURE,
    retryable: false,
    patterns: [
      /FAIL\s+packages?\//i,
      /FAIL\s+src\//i,
      /vitest.*failed|\d+\s+tests?\s+failed/i,
      /AssertionError|assert\.strictEqual/i,
      /expected\s+.*received|received\s+.*expected/i,
      /Test\s+Suites?:.*\d+\s+failed/i,
    ],
  },
  {
    class: CI_FAILURE_CLASS.TIMEOUT,
    retryable: true,
    patterns: [
      /exit\s+code\s+124/i,
      /timed?\s+out|exceeded\s+.*timeout/i,
      /job\s+cancelled.*timeout|timeout.*job/i,
      /step.*cancelled|cancelled.*step/i,
      /The\s+job\s+running\s+on\s+runner.*exceeded/i,
    ],
  },
  {
    class: CI_FAILURE_CLASS.FLAKY,
    retryable: true,
    patterns: [
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT/i,
      /runner.*unavailable|no\s+runner/i,
      /network\s+error|socket\s+hang/i,
      /rate\s+limit|too\s+many\s+requests/i,
      /secondary\s+rate\s+limit/i,
      /service\s+unavailable|bad\s+gateway/i,
      /flaky|intermittent/i,
    ],
  },
];

// ============================================================
// 核心函数
// ============================================================

/**
 * 解析 CI 失败日志文本，返回诊断结果
 *
 * @param {string} logOutput - gh run view --log-failed 的原始输出
 * @returns {{
 *   failure_class: string,
 *   retryable: boolean,
 *   patterns_matched: string[],
 *   excerpt: string,
 * }}
 */
export function parseCiFailureLogs(logOutput) {
  const text = String(logOutput || '');
  const excerpt = text.slice(0, 500);

  for (const group of LOG_PATTERNS) {
    const matched = [];
    for (const pattern of group.patterns) {
      if (pattern.test(text)) {
        matched.push(pattern.toString());
      }
    }
    if (matched.length > 0) {
      return {
        failure_class: group.class,
        retryable: group.retryable,
        patterns_matched: matched,
        excerpt,
      };
    }
  }

  return {
    failure_class: CI_FAILURE_CLASS.UNKNOWN,
    retryable: false,
    patterns_matched: [],
    excerpt,
  };
}

/**
 * 从 GitHub PR URL 提取 owner/repo/prNumber
 *
 * @param {string} prUrl - https://github.com/owner/repo/pull/123
 * @returns {{ owner: string, repo: string, prNumber: string } | null}
 */
export function extractPrInfo(prUrl) {
  if (!prUrl) return null;
  const match = String(prUrl).match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: match[3] };
}

/**
 * 诊断 CI 失败原因（异步，依赖注入 gh 命令执行器）
 *
 * @param {{ prUrl?: string, taskId?: string }} params
 * @param {{ execFn?: Function }} options - execFn(cmd) 返回 Promise<string>
 * @returns {Promise<{
 *   failure_class: string,
 *   retryable: boolean,
 *   summary: string,
 *   suggested_fix: string,
 *   raw_log_excerpt: string,
 *   run_id?: string,
 * } | null>}
 */
export async function diagnoseCiFailure({ prUrl, taskId } = {}, { execFn } = {}) {
  const exec = execFn || defaultExec;

  const prInfo = extractPrInfo(prUrl);
  if (!prInfo) {
    console.log(`[ci-diagnostics] no valid prUrl (taskId=${taskId}), skipping`);
    return null;
  }

  const { owner, repo, prNumber } = prInfo;

  try {
    // 1. 获取最新失败的 run_id
    const runListOutput = await exec(
      `gh run list --repo ${owner}/${repo} --pr ${prNumber} --status failure --limit 1 --json databaseId,conclusion`
    );
    const runs = JSON.parse(runListOutput || '[]');
    if (!runs.length) {
      console.log(`[ci-diagnostics] no failed runs for PR #${prNumber}`);
      return null;
    }
    const runId = String(runs[0].databaseId);

    // 2. 获取失败日志
    const logOutput = await exec(
      `gh run view ${runId} --repo ${owner}/${repo} --log-failed`
    );

    // 3. 解析日志
    const parsed = parseCiFailureLogs(logOutput);

    return {
      failure_class: parsed.failure_class,
      retryable: parsed.retryable,
      summary: buildSummary(parsed),
      suggested_fix: buildSuggestedFix(parsed.failure_class),
      raw_log_excerpt: parsed.excerpt,
      run_id: runId,
    };
  } catch (err) {
    // gh 不可用时优雅降级
    console.warn(`[ci-diagnostics] gh command failed: ${err.message}`);
    return null;
  }
}

// ============================================================
// 内部辅助
// ============================================================

async function defaultExec(cmd) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const { stdout } = await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 });
  return stdout;
}

function buildSummary({ failure_class, excerpt }) {
  const firstLine = excerpt.split('\n').find(l => l.trim().length > 10) || '';
  return `CI ${failure_class}: ${firstLine.trim().slice(0, 120)}`;
}

function buildSuggestedFix(failureClass) {
  const fixes = {
    [CI_FAILURE_CLASS.TEST_FAILURE]:     '查看测试断言，修复失败的测试用例',
    [CI_FAILURE_CLASS.TYPE_ERROR]:       '修复 TypeScript 类型错误或 ESLint 报错',
    [CI_FAILURE_CLASS.MISSING_DEP]:      '运行 npm install，确认依赖已正确声明在 package.json',
    [CI_FAILURE_CLASS.VERSION_MISMATCH]: '同步 package.json、VERSION、.brain-versions、DEFINITION.md 版本号',
    [CI_FAILURE_CLASS.TIMEOUT]:          'CI 超时，可尝试重跑；如持续超时，优化慢测试',
    [CI_FAILURE_CLASS.FLAKY]:            '随机性失败，自动重试即可',
    [CI_FAILURE_CLASS.UNKNOWN]:          '查看 CI 日志原文，手动判断原因',
  };
  return fixes[failureClass] || fixes[CI_FAILURE_CLASS.UNKNOWN];
}
