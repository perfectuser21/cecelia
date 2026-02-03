import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('DevGate - snapshot-prd-dod shell escaping', () => {
  it('W8-002: 完整转义（反斜杠、双引号、backtick、$()）', () => {
    const scriptPath = join(__dirname, '../../scripts/devgate/snapshot-prd-dod.sh');
    const content = readFileSync(scriptPath, 'utf8');

    // 检查所有转义都存在
    expect(content).toContain('ESCAPED_TITLE="${TITLE//\\\\/\\\\\\\\}"');       // 转义反斜杠
    expect(content).toContain('ESCAPED_TITLE="${ESCAPED_TITLE//\\"/\\\\\\\"}"');   // 转义双引号
    expect(content).toContain('ESCAPED_TITLE="${ESCAPED_TITLE//\\`/\\\\\\`}"');   // 转义 backtick
    expect(content).toContain('ESCAPED_TITLE="${ESCAPED_TITLE//\\$/\\\\\\$}"');   // 转义 $

    // 确保转义顺序正确（先反斜杠，再其他）
    const lines = content.split('\n');
    let backslashLine = -1;
    let quoteLine = -1;
    let backtickLine = -1;
    let dollarLine = -1;

    lines.forEach((line, index) => {
      if (line.includes('TITLE//\\\\/\\\\\\\\')) {
        backslashLine = index;
      }
      if (line.includes('ESCAPED_TITLE//\\"/\\\\\\\"')) {
        quoteLine = index;
      }
      if (line.includes('ESCAPED_TITLE//\\`/\\\\\\`')) {
        backtickLine = index;
      }
      if (line.includes('ESCAPED_TITLE//\\$/\\\\\\$')) {
        dollarLine = index;
      }
    });

    // 反斜杠必须最先转义
    expect(backslashLine).toBeGreaterThan(0);
    expect(backslashLine).toBeLessThan(quoteLine);
    expect(backslashLine).toBeLessThan(backtickLine);
    expect(backslashLine).toBeLessThan(dollarLine);
  });

  it('转义逻辑应该防止命令注入', () => {
    // 模拟转义函数
    function escapeTitle(title: string): string {
      let escaped = title;
      escaped = escaped.replace(/\\/g, '\\\\');       // 转义反斜杠
      escaped = escaped.replace(/"/g, '\\"');         // 转义双引号
      escaped = escaped.replace(/`/g, '\\`');         // 转义 backtick
      escaped = escaped.replace(/\$/g, '\\$');        // 转义 $
      return escaped;
    }

    // 测试危险输入
    const dangerousInputs = [
      '`whoami`',
      '$(whoami)',
      'test"; echo "pwned',
      'test\\"; echo \\"pwned',
      '$SHELL',
      '${USER}',
    ];

    dangerousInputs.forEach(input => {
      const escaped = escapeTitle(input);
      // 转义后不应该包含未转义的特殊字符
      expect(escaped).not.toMatch(/[^\\]`/);
      expect(escaped).not.toMatch(/[^\\]\$/);
    });

    // 验证转义结果
    expect(escapeTitle('`whoami`')).toBe('\\`whoami\\`');
    expect(escapeTitle('$(whoami)')).toBe('\\$(whoami)');
    expect(escapeTitle('test"; echo "pwned')).toBe('test\\"; echo \\"pwned');
  });

  it('P1 fix: 应包含 backtick 和 $() 转义注释', () => {
    const scriptPath = join(__dirname, '../../scripts/devgate/snapshot-prd-dod.sh');
    const content = readFileSync(scriptPath, 'utf8');

    // 检查 P1 fix 注释存在
    expect(content).toContain('P1 fix: 完整转义');
    expect(content).toContain('backtick');
    expect(content).toContain('$()');
  });
});
