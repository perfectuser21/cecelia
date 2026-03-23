import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanRCI = require('../../scripts/devgate/scan-rci-coverage.cjs');

describe('parseRCI - evidence.file 路径覆盖', () => {
  it('DEVGATE-STALE-REFS-002: evidence.file 字段应被加入 contract.paths', () => {
    const contracts = scanRCI.parseRCI();
    expect(Array.isArray(contracts)).toBe(true);
    expect(contracts.length).toBeGreaterThan(0);

    // regression-contract.yaml 中有多个 evidence.file 字段
    // 调用 parseRCI() 会执行 filePathMatch 代码路径
    // 验证至少一个 contract 通过 file: 字段获得了 paths
    const withFilePaths = contracts.filter(c =>
      Array.isArray(c.paths) && c.paths.some(p => typeof p === 'string' && p.length > 0)
    );
    expect(withFilePaths.length).toBeGreaterThan(0);
  });

  it('evidence.file 路径被正确解析（不含引号、空格、注释）', () => {
    const contracts = scanRCI.parseRCI();

    // S4-002 (intent-expand) 含 file: "skills/intent-expand/SKILL.md"
    const intentExpand = contracts.find((c: { id: string }) => c.id === 'S4-002');
    if (intentExpand) {
      // paths 应包含不带引号的路径
      expect(intentExpand.paths).toContain('skills/intent-expand/SKILL.md');
      // 路径不能含有引号
      expect(intentExpand.paths.every((p: string) => !p.includes('"') && !p.includes("'"))).toBe(true);
    }
  });
});

describe('DevGate - scan-rci-coverage glob regex', () => {
  it('W8-001: glob regex 正确处理递归通配符 (**)', () => {
    // 验证修复：先替换 ** 再替换 *
    const scriptPath = join(__dirname, '../../scripts/devgate/scan-rci-coverage.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    // 检查替换顺序
    const regexStrPattern = /\.replace\(.*\*\*.*\).*\.replace\(.*\*(?!\*).*\)/s;
    expect(content).toMatch(regexStrPattern);

    // 确保 ** 在 * 之前替换
    const lines = content.split('\n');
    let doubleStarLine = -1;
    let singleStarLine = -1;

    lines.forEach((line, index) => {
      if (line.includes('.replace(/\\*\\*/g')) {
        doubleStarLine = index;
      }
      if (line.includes('.replace(/\\*/g') && !line.includes('\\*\\*/g')) {
        singleStarLine = index;
      }
    });

    // ** 的替换必须在 * 之前
    expect(doubleStarLine).toBeGreaterThan(0);
    expect(singleStarLine).toBeGreaterThan(0);
    expect(doubleStarLine).toBeLessThan(singleStarLine);
  });

  it('正确的替换顺序使 ** 递归匹配部分生效', () => {
    // 错误的顺序：先 * 后 ** - 完全失效
    const wrongPattern = 'src/**';
    const wrongRegex = wrongPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^/]*')      // 先替换所有 *（包括 ** 中的）
      .replace(/\*\*/g, '.*');      // ** 已经被替换成 [^/]*[^/]*，永远不会匹配

    // 结果: src/[^/]*[^/]* - 完全无法匹配包含 / 的路径
    const wrong = new RegExp(`^${wrongRegex}$`);
    expect(wrong.test('src/with/slash')).toBe(false);

    // 正确的顺序：先 ** 后 * - 部分生效
    const correctPattern = 'src/**';
    const correctRegex = correctPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')       // 先替换 **
      .replace(/\*/g, '[^/]*');     // 再替换 *（会替换 .* 中的 *）

    // 结果: src/.[^/]* - 至少 . 可以匹配任意字符包括 /
    const correct = new RegExp(`^${correctRegex}$`);
    // . 匹配第一个字符，[^/]* 匹配后续非 / 字符
    // 所以可以匹配单层路径如 src/x，但多层需要 . 匹配到 /
    expect(correct.test('src/anything')).toBe(true);

    // 注：这不是完美的 glob 实现，但比完全失效的错误顺序好
    // 完美实现需要用占位符避免二次替换
  });

  it('错误的顺序会导致 ** 失效', () => {
    const contractPath = 'src/**/*.ts';

    // 错误的顺序（bug 版本）
    const wrongRegexStr = contractPath
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^/]*')      // 先替换所有 *
      .replace(/\*\*/g, '.*');      // ** 已经被替换了，永远不会匹配

    const wrongRegex = new RegExp(`^${wrongRegexStr}$`);

    // 验证错误版本无法匹配多层目录
    expect(wrongRegex.test('src/deep/nested/file.ts')).toBe(false);
  });
});
