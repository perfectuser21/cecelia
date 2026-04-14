import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = join(process.cwd(), '..', '..', 'packages', 'engine', 'ci', 'scripts', 'check-chinese-punctuation-bombs.sh');

describe('check-chinese-punctuation-bombs.sh — 中文标点炸弹扫描', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chinese-punct-'));
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  const run = (file: string): number => {
    try {
      execSync(`bash "${SCRIPT}" "${file}"`, { stdio: 'pipe' });
      return 0;
    } catch (e: any) {
      return e.status || 1;
    }
  };

  it('命中：$var 紧跟中文逗号 → exit 1', () => {
    const f = join(tmpDir, 'bad-comma.sh');
    writeFileSync(f, '#!/bin/bash\necho "更新 $base_branch，使用当前版本"\n');
    expect(run(f)).toBe(1);
  });

  it('命中：$var 紧跟中文括号 → exit 1', () => {
    const f = join(tmpDir, 'bad-paren.sh');
    writeFileSync(f, '#!/bin/bash\necho "($value)"\necho "清理（$_ob）"\n');
    expect(run(f)).toBe(1);
  });

  it('无命中：${var} 加了花括号 → exit 0', () => {
    const f = join(tmpDir, 'good.sh');
    writeFileSync(f, '#!/bin/bash\necho "更新 ${base_branch}，使用当前版本"\necho "清理（${_ob}）"\n');
    expect(run(f)).toBe(0);
  });

  it('无命中：纯中文注释（无变量） → exit 0', () => {
    const f = join(tmpDir, 'comment.sh');
    writeFileSync(f, '#!/bin/bash\n# 这是一个中文注释，带全角标点。\necho hello\n');
    expect(run(f)).toBe(0);
  });
});
