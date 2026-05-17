import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = join(process.cwd(), '..', '..', 'packages', 'engine', 'skills', 'dev', 'scripts', 'enrich-decide.sh');

describe('enrich-decide.sh — PRD 丰满度启发式', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'enrich-')); });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  const run = (content: string): number => {
    const f = join(tmpDir, 'prd.md');
    writeFileSync(f, content);
    try {
      execSync(`bash "${SCRIPT}" "${f}"`, { stdio: 'pipe' });
      return 0;
    } catch (e: any) {
      return e.status || 1;
    }
  };

  it('thin PRD (一句话) → exit 1 (需 enrich)', () => {
    expect(run('修复 quickcheck bug')).toBe(1);
  });

  it('thin PRD (长但缺 ## 成功标准) → exit 1', () => {
    const content = '# PRD\n' + '长'.repeat(600) + '\n## 不做\n- x';
    expect(run(content)).toBe(1);
  });

  it('thin PRD (长但缺 ## 不做) → exit 1', () => {
    const content = '# PRD\n' + '长'.repeat(600) + '\n## 成功标准\n1.ok';
    expect(run(content)).toBe(1);
  });

  it('rich PRD (长且齐全) → exit 0 (跳过)', () => {
    const content = '# PRD\n' + '长'.repeat(600) + '\n## 成功标准\n1.ok\n## 不做\n- x';
    expect(run(content)).toBe(0);
  });

  it('边界: 恰好 500 字节 + 齐全 → exit 0', () => {
    // ## 成功标准 + ## 不做 sections 约 30 字节, 剩 470 字节填内容
    const filler = '长'.repeat(160);  // 约 480 字节 UTF-8
    const content = `# PRD\n${filler}\n## 成功标准\n1\n## 不做\n- x`;
    expect(run(content)).toBe(0);
  });

  it('空文件 → exit 1', () => {
    expect(run('')).toBe(1);
  });

  it('不存在的文件 → exit 1', () => {
    try {
      execSync(`bash "${SCRIPT}" /nonexistent/path.md`, { stdio: 'pipe' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.status).toBe(1);
    }
  });
});
