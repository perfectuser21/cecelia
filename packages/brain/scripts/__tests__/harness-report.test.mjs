import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Use absolute path so this test works regardless of CWD
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../harness-report.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-report-unit-'));
  writeFileSync(join(dir, 'sprint-prd.md'), '# Sprint PRD — unit fixture\n');
  return dir;
}

function runScript(args, env = {}) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exit: 0, output: out };
  } catch (e) {
    return { exit: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('harness-report.mjs unit — 存在性', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('缺少参数时 exit 非零', () => {
    const { exit } = runScript([]);
    expect(exit).not.toBe(0);
  });
});

describe('harness-report.mjs unit — 文件生成', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('三文件生成', () => {
    dir = makeFixture();
    runScript(['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
               '--pr-url', 'https://github.com/test/1', '--feature-id', 'fake'],
              { BRAIN_URL: 'http://localhost:19999' });
    expect(existsSync(join(dir, 'harness-report.md'))).toBe(true);
    expect(existsSync(join(dir, 'learning.md'))).toBe(true);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });
});
