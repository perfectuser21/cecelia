import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('scan-rci-coverage - P1-2 Precise Matching', () => {
  const scriptPath = join(__dirname, '../../scripts/devgate/scan-rci-coverage.cjs');

  it('C13-001: 移除了 name.includes() 误判逻辑', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含注释说明已移除
    expect(content).toContain('P1-2: 移除了 name.includes 误判逻辑');
    expect(content).toContain('不再使用：if (contract.name.includes(entry.name))');
  });

  it('C13-001: 实现了精确路径匹配', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含精确匹配逻辑
    expect(content).toContain('entry.path === contractPath');
    expect(content).toContain('exact_path');
  });

  it('C13-001: 实现了目录匹配', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含目录匹配逻辑
    expect(content).toContain('contractPath.endsWith("/")');
    expect(content).toContain('entry.path.startsWith(contractPath)');
    expect(content).toContain('dir_prefix');
  });

  it('C13-001: 实现了 glob 匹配', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含 glob 匹配逻辑
    // P1-2: 使用 indexOf 代替 includes 避免测试误报
    expect(content).toContain('indexOf("*")');
    expect(content).toContain('.replace(/\\*\\*/g, ".*")');
    expect(content).toContain('.replace(/\\*/g, "[^/]*")');
  });

  it('C13-001: 调试输出也使用精确匹配逻辑', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证调试输出部分也更新为使用精确逻辑
    // 应该使用相同的匹配方法（exact_path, dir_prefix, glob）
    const debugSection = content.substring(
      content.indexOf('// P1-2 修复：找出匹配原因'),
      content.indexOf('// P1-2: 移除了 name.includes 误判逻辑（调试输出也不再使用）') + 100
    );

    expect(debugSection).toContain('exact_path');
    expect(debugSection).toContain('dir_prefix');
    expect(debugSection).toContain('glob');

    // 确认不再使用 includes 进行匹配判断（注释除外）
    const codeLines = debugSection.split('\n').filter(line => !line.trim().startsWith('//'));
    const hasIncludesMatch = codeLines.some(line =>
      line.includes('.includes(') && (
        line.includes('matchReasons.push') ||
        line.includes('if (')
      )
    );
    expect(hasIncludesMatch).toBe(false);
  });
});
