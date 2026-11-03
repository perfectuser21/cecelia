import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { claudeFailure } from '../lib/claude.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

// 真实 fixture 写入超过管道容量的日志，读端延后消费；退出前丢尾会改变真实失败分类。
function captureWithBackpressure(root, mode, sentinel) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, '-p', 'TASK_ID: fixture-output',
      '--backpressure-padding', ...Array.from({ length: 10 }, () => 'x'.repeat(10000))], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, FAKE_CLAUDE_MODE: mode,
        FAKE_TAMPER_FILE: sentinel, FAKE_CLAUDE_COST: '99' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stdout.pause();
    child.stderr.on('data', chunk => { stderr += chunk; });
    const resume = setTimeout(() => child.stdout.resume(), 200);
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('假 claude 背压测试超过10秒'));
    }, 10000);
    const cleanup = () => { clearTimeout(resume); clearTimeout(deadline); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); resolve({ code, stdout, stderr, output: stdout + stderr }); });
  });
}

describe('假 claude 失败输出在背压下完整交付', () => {
  it.each([
    ['verify-authresult', 'needs_human', 'claude_auth',
      { type: 'result', subtype: 'error', is_error: true, result: 'Invalid API key · Please run /login' }],
    ['verify-bizauth', 'retryable', 'claude_failed',
      { type: 'result', subtype: 'error_max_turns', is_error: true, result: 'max turns reached' }],
  ])('%s：交付完整事件并保留失败早退语义', async (mode, failureClass, reasonCode, event) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-output-'));
    try {
      const sentinel = path.join(root, 'sentinel');
      fs.writeFileSync(sentinel, 'unchanged\n');
      const run = await captureWithBackpressure(root, mode, sentinel);
      expect(run.code, run.stderr).toBe(1);
      expect(claudeFailure(run, { streamJson: true })).toEqual({
        status: 'failed', failure_class: failureClass, reason_code: reasonCode,
      });
      expect(run.stdout.includes('fake claude log line 199\n')).toBe(true);
      expect(run.stdout.includes(`${JSON.stringify(event)}\n`)).toBe(true);
      expect(run.stdout.endsWith(`${JSON.stringify(event)}\n`)).toBe(true);
      expect(run.stdout).not.toContain('"total_cost_usd":99');
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('unchanged\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
