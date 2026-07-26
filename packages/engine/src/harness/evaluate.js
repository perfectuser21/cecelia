/**
 * Harness Evaluator 可选编排工具库（非 pipeline 默认执行路径）。
 *
 * 职责：
 *   1. parseE2EScript  — 从合同 markdown 提取 ## E2E 验收 bash 脚本
 *   2. runEvaluate     — 可选编排：脚本化执行记录（executeAndRecord）+ LLM 裁读（judgeExecution）
 *
 * 用户拍板的验收架构是「运动员-摄像头-裁判」三权分立：evaluator agent 像人类 QA 亲手执行验证
 * （运动员，执行权不被代码取代），证据自动留痕（摄像头），DeepSeek 独立裁判判读
 * （packages/brain/src/harness-judge.js）。#3370 原版「把执行权整个交给纯代码执行器」的方向被否决，
 * 故此处删除那套「移交执行权」的回退开关接线（原 env 开关 + legacy payload 判定）——
 * runEvaluate 仅作为可选工具保留，供需要纯命令脚本化执行 + 记录的场景调用，不再是 evaluate_contract
 * 的代理执行器。
 *
 * CLI 模式（直接 node evaluate.js 运行）：
 *   环境变量：E2E_SCRIPT, SPRINT_DIR, LLM_JUDGE_TIMEOUT_MS
 *   输出：${SPRINT_DIR}/exec-records/<run_id>.json + ./.brain-result.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { executeAndRecord } from './runner.js';
import { judgeExecution } from './e2e-judge.js';
import testContractPaths from '../../../../scripts/lib/test-contract-paths.cjs';

const { parseCanonicalE2EScript } = testContractPaths;

/**
 * 从合同 markdown 文件提取 ## E2E 验收 段落的 bash 脚本。
 *
 * @param {string} contractFilePath
 * @returns {string|null}
 */
export function parseE2EScript(contractFilePath) {
  const content = readFileSync(contractFilePath, 'utf8');
  return parseCanonicalE2EScript(content);
}

/**
 * 编排评估流程：代码执行 + LLM 裁读。
 *
 * @param {{cmd: string, type?: string}} cmd         — 要执行的命令/脚本
 * @param {string} contractText                      — 合同文本（传给 LLM）
 * @param {string} goldenPath                        — Golden Path 步骤（传给 LLM）
 * @param {{
 *   sprintDir?: string,
 *   runnerFn?: Function,
 *   judgeFn?: Function,
 *   llmFn?: Function,
 *   timeoutMs?: number,
 *   writeBrainResult?: boolean,
 * }} opts
 * @returns {Promise<{verdict, coverage, feedback?, failed_step?}>}
 */
export async function runEvaluate(cmd, contractText, goldenPath, opts = {}) {
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
