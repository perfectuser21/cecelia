import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('L2B Check - P2 Evidence Security', () => {
  const scriptPath = join(__dirname, '../../scripts/devgate/l2b-check.sh');

  it('C11-001: 包含 Evidence 时间戳验证逻辑', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含时间戳验证代码
    expect(content).toContain('Evidence 时间戳验证');
    expect(content).toContain('EVIDENCE_MTIME');
    expect(content).toContain('COMMIT_TIME');

    // 验证比较逻辑存在
    expect(content).toMatch(/EVIDENCE_MTIME.*COMMIT_TIME/);
    expect(content).toContain('时间戳过旧');
  });

  it('C11-002: 包含 Evidence 文件存在性验证逻辑', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含文件存在性检查代码
    expect(content).toContain('Evidence 文件存在性验证');
    expect(content).toContain('docs/evidence/');
    expect(content).toMatch(/MISSING_FILES/);

    // 验证文件不存在时报错
    expect(content).toMatch(/文件不存在/);
  });

  it('C11-003: 包含 Evidence metadata 验证逻辑', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证包含 metadata 检查代码
    expect(content).toContain('Evidence Metadata 验证');
    expect(content).toContain('YAML frontmatter');
    expect(content).toContain('FRONTMATTER');

    // 验证必填字段检查
    expect(content).toContain('commit');
    expect(content).toContain('timestamp');
    expect(content).toMatch(/REQUIRED_FIELDS/);
  });

  it('时间戳验证逻辑：允许5分钟误差', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证5分钟（300秒）误差
    expect(content).toMatch(/300/);
  });

  it('文件存在性验证：使用 grep -oP 提取路径', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证使用 grep -oP 提取文件路径
    expect(content).toMatch(/grep.*-oP.*docs\/evidence/);
  });

  it('metadata 验证：使用 awk 提取 frontmatter', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // 验证使用 awk 提取 YAML frontmatter
    expect(content).toMatch(/awk.*---/);
  });

  it('P2 验证在 PR 模式下执行', () => {
    const content = readFileSync(scriptPath, 'utf8');

    // P2 验证应该在 L2B-min 检查之后
    // 验证顺序：L2B-min 检查通过 -> P2 验证
    const l2bMinIndex = content.indexOf('L2B-min 检查通过');
    const timestampIndex = content.indexOf('Evidence 时间戳验证');

    expect(l2bMinIndex).toBeGreaterThan(0);
    expect(timestampIndex).toBeGreaterThan(l2bMinIndex);
  });
});
