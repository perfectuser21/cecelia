import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const engine = resolve(__dirname, '../..');
function lint(shell = '#!/bin/bash\ntrue\n', js = 'export const value = 1;\n', ci = '#!/bin/bash\ntrue\n') {
  const root = mkdtempSync(join(tmpdir(), 'engine-syntax-'));
  const put = (file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  try {
    for (const dir of ['hooks', 'runners', 'scripts', 'lib', 'skills/dev/scripts', 'src/harness', 'ci/scripts']) mkdirSync(join(root, dir), { recursive: true });
    put('package.json', readFileSync(join(engine, 'package.json'), 'utf8'));
    const entry = join(engine, 'scripts/check-syntax.mjs');
    if (existsSync(entry)) copyFileSync(entry, join(root, 'scripts/check-syntax.mjs'));
    put('skill-loader.cjs', 'module.exports = {};\n');
    put('scripts/valid.sh', '#!/bin/bash\ntrue\n');
    put('ci/scripts/version-check.sh', ci);
    put('hooks/pre-commit', shell);
    put('src/harness/runtime.js', js);
    const result = spawnSync('npm', ['run', 'lint'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    return { ...result, output: result.stdout + result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('Engine 真实脚本语法准备检查', () => {
  it('真实Bash和JavaScript解析成功，且不执行脚本副作用', () => {
    const result = lint('#!/bin/bash\nexit 91\n', 'throw new Error("must not execute");\n');
    expect(result.status, result.output).toBe(0);
  });
  it('真实坏Bash脚本阻止通过，并报告文件路径', () => {
    const result = lint('#!/bin/bash\nif then\n');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('hooks/pre-commit');
  });
  it('真实坏CI Shell脚本阻止通过，并报告文件路径', () => {
    const result = lint(undefined, undefined, '#!/bin/bash\nif then\n');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('ci/scripts/version-check.sh');
  });
  it('真实坏JavaScript阻止通过，并报告文件路径', () => {
    const result = lint(undefined, 'export const = ;\n');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('src/harness/runtime.js');
  });
});
