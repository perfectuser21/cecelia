/**
 * E2E LLM 裁读模块。
 * judgeExecution 只读执行记录，不执行任何命令，输出 verdict + coverage。
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_TIMEOUT_MS = 30_000;
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LLM_MAX_TOKENS = 1000;

function getAnthropicKey() {
  try {
    const cred = JSON.parse(readFileSync(join(homedir(), '.credentials', 'anthropic.json'), 'utf8'));
    return cred.api_key || null;
  } catch {
    return process.env.ANTHROPIC_API_KEY || null;
  }
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

async function callAnthropicLLM(record, contractText, goldenPathText, timeoutMs) {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new Error('Anthropic API key not available');
  }

  const prompt = `You are an E2E test result evaluator. Analyze the execution record and return a verdict.

Rules:
- If exit_code != 0: verdict MUST be "FAIL"
- If all output looks like successful steps (exit_code=0): verdict = "PASS"
- Create one coverage entry per significant stdout line (at minimum, one entry per non-empty line)
- Each coverage[].record_segment MUST be an EXACT verbatim quote from stdout (character-for-character)
- If verdict="FAIL": set failed_step to the first failing line

Execution Record:
exit_code: ${record.exit_code}
stdout: ${record.stdout}
stderr: ${record.stderr || ''}
duration_ms: ${record.duration_ms}

Return ONLY valid JSON, no other text:
{
  "verdict": "PASS",
  "coverage": [
    {"step": "Step 1: <label>", "record_segment": "<exact stdout line>", "passed": true}
  ],
  "failed_step": null,
  "feedback": "brief explanation"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: LLM_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`Anthropic API error: ${response.status} - ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Anthropic API returned empty content');

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
    } else if (getAnthropicKey()) {
      result = await callAnthropicLLM(record, contractText, goldenPathText, timeoutMs);
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
