// spec 活动：用 claude CLI + 薄 prompt 根据 01-intent.md 生成 <sprint_dir>/02-spec.md。
// 格式校验不在这里做，交给 chain_check。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runActivity, validateBase, fail, log } from '../lib/protocol.mjs';

const SPEC_FILE = '02-spec.md';
const DEFAULT_INTENT_FILE = '01-intent.md';
const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../prompts/spec.md');
const AUTH_RE = /auth|login|quota/i;

function renderPrompt(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value), template);
}

/** 运行子进程，输出全部转写到本进程 stderr；返回 { code, output }，spawn 失败时 code 为 null。 */
function runChild(bin, args, cwd) {
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, output: String(error?.message || error) });
      return;
    }
    const forward = (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (error) => {
      log(`[spec] 启动 ${bin} 失败: ${error?.message || error}`);
      resolve({ code: null, output: `${output}\n${error?.message || error}` });
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

await runActivity(async (input) => {
  const { worktree, intent_ids: intentIds } = input;
  const intentFile = input.intent_file || DEFAULT_INTENT_FILE;

  const { dir } = validateBase(input);
  const taskId = input.task_id;
  if (!Array.isArray(intentIds) || intentIds.length === 0) return fail('fatal', 'intent_ids_missing');

  const specPath = path.join(dir, SPEC_FILE);
  const prompt = renderPrompt(fs.readFileSync(PROMPT_PATH, 'utf8'), {
    TASK_ID: taskId,
    INTENT_PATH: path.join(dir, intentFile),
    SPEC_PATH: specPath,
    INTENT_IDS: intentIds.join(','),
  });

  const bin = process.env.CODING_WF_CLAUDE_BIN || 'claude';
  const { code, output } = await runChild(bin, ['-p', prompt, '--permission-mode', 'acceptEdits'], worktree);

  if (code !== 0) {
    if (AUTH_RE.test(output)) return fail('needs_human', 'claude_auth');
    return fail('retryable', 'claude_failed');
  }
  if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');

  return {
    status: 'completed',
    outputs: { spec_file: SPEC_FILE },
    evidence: [`${SPEC_FILE} 已生成`],
  };
});
