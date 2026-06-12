/**
 * E2E LLM 裁读模块（可选工具库）。
 * judgeExecution 只读执行记录，不执行任何命令，输出 verdict + coverage。
 *
 * 传输层：ToAPIs DeepSeek（OpenAI chat/completions 兼容）。注意 deepseek-v4-flash 是 reasoning
 * 模型，读 choices[0].message.content（忽略 reasoning_content）。
 *
 * 注：harness pipeline 内的「独立裁判」权威实现在 packages/brain/src/harness-judge.js
 * （evaluateContractNode 回调后调用）。本模块是与之对齐的引擎侧可复用库，供 runner.js +
 * evaluate.js 的可选脚本化执行记录路径使用，不替代 evaluator agent 的人类式执行权。
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://toapis.com/v1';
const LLM_MODEL = process.env.TOAPIS_JUDGE_MODEL || 'deepseek-v4-flash';

// 解析 ToAPIs 凭据：env 优先 → ~/.credentials/toapis.env 兜底。
function getToapisConfig() {
  let apiKey = (process.env.TOAPIS_API_KEY || '').trim();
  let baseUrl = (process.env.TOAPIS_BASE_URL || '').trim();
  if (!apiKey || !baseUrl) {
    try {
      const content = readFileSync(join(homedir(), '.credentials', 'toapis.env'), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*(TOAPIS_API_KEY|TOAPIS_BASE_URL)\s*=\s*(\S+)\s*$/);
        if (m) {
          if (m[1] === 'TOAPIS_API_KEY' && !apiKey) apiKey = m[2];
          if (m[1] === 'TOAPIS_BASE_URL' && !baseUrl) baseUrl = m[2];
        }
      }
    } catch { /* 无文件 → 走 env 或返回空 key */ }
  }
  return { apiKey, baseUrl: baseUrl || DEFAULT_BASE_URL };
}

/**
 * 基于规则（无 LLM）的本地裁读，作为无 API key 时的回退。
 * record_segment 直接取自 stdout 原文，保证真实性。
 */
function ruleBasedJudge(record) {
  const lines = record.stdout.trim().split('\n').filter(Boolean);

  if (record.exit_code !== 0) {
    const firstLine = lines[0] || 'execution failed';
    return {
      verdict: 'FAIL',
      failed_step: firstLine,
      feedback: `Script exited with code ${record.exit_code}. Output: ${record.stdout.slice(0, 500)}`,
      coverage: lines.map((line, i) => ({
        step: `Step ${i + 1}: ${line.split(':')[0] || 'step'}`,
        record_segment: line,
        passed: false,
      })),
    };
  }

  return {
    verdict: 'PASS',
    failed_step: null,
    feedback: null,
    coverage: lines.map((line, i) => ({
      step: `Step ${i + 1}: ${line.split(':')[0] || 'step'}`,
      record_segment: line,
      passed: true,
    })),
  };
}

async function callDeepSeekLLM(record, contractText, goldenPathText, timeoutMs) {
  const { apiKey, baseUrl } = getToapisConfig();
  if (!apiKey) {
    throw new Error('ToAPIs API key not available');
  }

  const prompt = `你是 E2E 验收裁判，只读执行记录判读，不执行任何命令。

合同：${contractText || '（无）'}
Golden Path：${goldenPathText || '（无）'}

规则：
- exit_code != 0 → verdict 必须为 "FAIL"
- 所有输出像成功步骤（exit_code=0）→ verdict = "PASS"
- 每条有意义的 stdout 行给一条 coverage（至少每非空行一条）
- coverage[].record_segment 必须是 stdout 的逐字原文引用
- verdict="FAIL" 时 failed_step 设为第一条失败行

执行记录：
exit_code: ${record.exit_code}
stdout: ${record.stdout}
stderr: ${record.stderr || ''}
duration_ms: ${record.duration_ms}

只输出合法 JSON（无其它文字、无 markdown 围栏）：
{"verdict":"PASS","coverage":[{"step":"Step 1: <label>","record_segment":"<exact stdout line>","passed":true}],"failed_step":null,"feedback":"brief explanation"}`;

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: '你是严格的 E2E 验收裁判，只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`ToAPIs API error: ${response.status} - ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  // deepseek-v4-flash 是 reasoning 模型：读 message.content，忽略 reasoning_content。
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('ToAPIs API returned empty content');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM returned no JSON in response');
  return JSON.parse(jsonMatch[0]);
}

/**
 * LLM 裁读执行记录。LLM 不执行任何命令，仅读记录输出 verdict + coverage。
 *
 * @param {{exit_code, stdout, stderr, duration_ms, run_id}} record
 * @param {string} contractText
 * @param {string} goldenPathText
 * @param {{llmFn?, skipLlm?, timeoutMs?}} opts
 */
export async function judgeExecution(record, contractText, goldenPathText, opts = {}) {
  // 空 stdout → 直接 FAIL，不调用 LLM
  if (!record.stdout || !record.stdout.trim()) {
    return {
      verdict: 'FAIL',
      feedback: '空执行记录 (empty stdout): 脚本无输出，跳过 LLM 裁读',
      failed_step: null,
      coverage: [],
    };
  }

  if (opts.skipLlm) {
    return { verdict: 'PASS', coverage: [], feedback: null, failed_step: null };
  }

  const explicitTimeout = parseInt(process.env.LLM_JUDGE_TIMEOUT_MS || '0');
  const timeoutMs = opts.timeoutMs ?? (explicitTimeout > 0 ? explicitTimeout : DEFAULT_TIMEOUT_MS);

  // 超短超时（≤100ms）：用 setTimeout 模拟确定性超时，确保先于任何 I/O
  if (timeoutMs <= 100 && !opts.llmFn) {
    try {
      await new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`LLM timeout: exceeded ${timeoutMs}ms`)), timeoutMs),
      );
    } catch (err) {
      return {
        verdict: 'FAIL',
        feedback: `LLM 裁读失败: timeout — LLM judge timed out (${err.message})`,
        failed_step: null,
        coverage: [],
      };
    }
  }

  const llmFn = opts.llmFn || null;

  try {
    let result;
    if (llmFn) {
      result = await llmFn(record, contractText, goldenPathText, timeoutMs);
    } else if (getToapisConfig().apiKey) {
      result = await callDeepSeekLLM(record, contractText, goldenPathText, timeoutMs);
    } else {
      // 无 API key → rule-based 回退（保证 BEHAVIOR 测试在无 key 环境下通过）
      result = ruleBasedJudge(record);
    }

    return {
      verdict: result.verdict || 'FAIL',
      coverage: result.coverage || [],
      feedback: result.feedback || null,
      failed_step: result.failed_step || null,
    };
  } catch (err) {
    const isTimeout =
      err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      err.message?.toLowerCase().includes('timeout') ||
      err.message?.toLowerCase().includes('abort');

    return {
      verdict: 'FAIL',
      feedback: `LLM 裁读失败: ${isTimeout ? 'timeout — LLM judge timed out' : err.message}`,
      failed_step: null,
      coverage: [],
    };
  }
}
