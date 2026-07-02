/**
 * check-version-sync.sh 回归测试
 *
 * 根因：脚本用 `grep -oP ... | head -1` 提取 DEFINITION.md 版本号，PCRE 的 -P
 * 在 macOS 自带 BSD grep 上不支持、直接报错退出，但因为管道尾是 `head -1`
 * （成功退出 0），`set -e` 抓不到这个失败，DOC_VERSION 变成空字符串，脚本误判
 * 成"没找到该行"而不是报出真实的版本不一致，掩盖了漂移。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../scripts/check-version-sync.sh');

describe('check-version-sync.sh 检测 DEFINITION.md 版本漂移', () => {
  let workDir;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'version-sync-test-'));
    mkdirSync(join(workDir, 'packages', 'brain'), { recursive: true });
    writeFileSync(join(workDir, 'packages/brain/package.json'), JSON.stringify({ version: '9.9.9' }));
    writeFileSync(join(workDir, 'packages/brain/package-lock.json'), JSON.stringify({ version: '9.9.9' }));
    writeFileSync(join(workDir, '.brain-versions'), '9.9.9\n');
    // 故意写一个和 package.json 不一致的 DEFINITION.md 版本，模拟真实漂移场景
    writeFileSync(join(workDir, 'DEFINITION.md'), '**Brain 版本**: 1.0.0\n');
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('DEFINITION.md 版本不一致时必须报错退出，不能被 grep -P 静默吞掉', () => {
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(`bash "${SCRIPT}"`, { cwd: workDir, encoding: 'utf8' });
    } catch (err) {
      exitCode = err.status;
      output = String(err.stdout || '') + String(err.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(output).toContain('DEFINITION.md');
    expect(output).not.toContain("no 'Brain 版本' line found");
  });
});
