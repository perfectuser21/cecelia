/**
 * Harness Evaluator 编排模块。
 *
 * 职责：
 *   1. parseE2EScript  — 从合同 markdown 提取 ## E2E 验收 bash 脚本
 *   2. runEvaluate     — 编排执行记录（executeAndRecord）+ LLM 裁读（judgeExecution）
 *
 * 回退开关（优先级从高到低）：
 *   opts.legacy = true
 *   process.env.EVAL_LEGACY === '1'
 *   JSON.parse(process.env.EVAL_PAYLOAD || '{}').use_legacy_eval === true
 *
 * CLI 模式（直接 node evaluate.js 运行）：
 *   环境变量：E2E_SCRIPT, SPRINT_DIR, EVAL_LEGACY, EVAL_PAYLOAD, LLM_JUDGE_TIMEOUT_MS
 *   输出：${SPRINT_DIR}/exec-records/<run_id>.json + ./.brain-result.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { executeAndRecord } from './runner.js';
import { judgeExecution } from './e2e-judge.js';

function isLegacyMode(opts = {}) {
  if (opts.legacy) return true;
  if (process.env.EVAL_LEGACY === '1') return true;
  try {
    const payload = JSON.parse(process.env.EVAL_PAYLOAD || '{}');
    if (payload.use_legacy_eval === true) return true;
  } catch { /* ignore parse errors */ }
  return false;
}

/**
 * 从合同 markdown 文件提取 ## E2E 验收 段落的 bash 脚本。
 *
 * @param {string} contractFilePath
 * @returns {string|null}
 */
export function parseE2EScript(contractFilePath) {
  const content = readFileSync(contractFilePath, 'utf8');
  const sectionMatch = content.match(/##\s*E2E[^\n]*\n([\s\S]*?)(?=\n##\s+[^\n]|$)/);
  if (!sectionMatch) return null;
  const section = sectionMatch[1];
  const codeMatch = section.match(/```bash\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1] : null;
}

/**
 * 编排评估流程：代码执行 + LLM 裁读。
 *
 * @param {{cmd: string, type?: string}} cmd         — 要执行的命令/脚本
 * @param {string} contractText                      — 合同文本（传给 LLM）
 * @param {string} goldenPath                        — Golden Path 步骤（传给 LLM）
 * @param {{
 *   sprintDir?: string,
 *   legacy?: boolean,
 *   runnerFn?: Function,
 *   judgeFn?: Function,
 *   llmFn?: Function,
 *   timeoutMs?: number,
 *   writeBrainResult?: boolean,
 * }} opts
 * @returns {Promise<{verdict, coverage, feedback?, failed_step?}>}
 */
export async function runEvaluate(cmd, contractText, goldenPath, opts = {}) {
  if (isLegacyMode(opts)) {
    const result = {
      verdict: 'FAIL',
      feedback: 'legacy mode — EVAL_LEGACY skip: new executor not invoked',
      failed_step: null,
      coverage: [],
    };
    if (opts.writeBrainResult) {
      writeFileSync(
        path.join(process.cwd(), '.brain-result.json'),
        JSON.stringify(result, null, 2),
      );
    }
    return result;
  }

  const sprintDir = opts.sprintDir || process.env.SPRINT_DIR;
  const runnerFn = opts.runnerFn || executeAndRecord;
  const judgeFn = opts.judgeFn || judgeExecution;

  const record = await runnerFn(cmd, { sprintDir });

  const judgeOpts = {
    llmFn: opts.llmFn,
    timeoutMs: opts.timeoutMs,
  };
  const judgeResult = await judgeFn(record, contractText, goldenPath, judgeOpts);

  const result = {
    verdict: judgeResult.verdict || 'FAIL',
    coverage: judgeResult.coverage || [],
    feedback: judgeResult.feedback || null,
    failed_step: judgeResult.failed_step || null,
  };

  if (opts.writeBrainResult) {
    writeFileSync(
      path.join(process.cwd(), '.brain-result.json'),
      JSON.stringify(result, null, 2),
    );
  }

  return result;
}

// ── CLI 模式 ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  (async () => {
    const e2eScript = process.env.E2E_SCRIPT;
    if (!e2eScript) {
      console.error('ERROR: E2E_SCRIPT env var required');
      process.exit(1);
    }

    const sprintDir = process.env.SPRINT_DIR || '.';

    let result;
    try {
      result = await runEvaluate(
        { cmd: e2eScript, type: 'bash' },
        '',
        '',
        {
          sprintDir,
          writeBrainResult: true,
        },
      );
    } catch (err) {
      result = {
        verdict: 'FAIL',
        feedback: `evaluate error: ${err.message}`,
        failed_step: null,
        coverage: [],
      };
      writeFileSync(
        path.join(process.cwd(), '.brain-result.json'),
        JSON.stringify(result, null, 2),
      );
    }

    process.exit(result.verdict === 'PASS' ? 0 : 1);
  })();
}
