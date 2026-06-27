/**
 * parseE2eAcceptanceFromContract 单元测试。
 * 验证从真实 contract-draft.md 解析出 scenarios.length > 0，
 * 并通过 normalizeAcceptance 的非空校验（harness-final-e2e.js:93-97）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));

const { parseE2eAcceptanceFromContract } = await import('../staging-e2e-runner.js');
const { normalizeAcceptance } = await import('../harness-final-e2e.js');

// 真实合同文件（仓库根 sprints/ 目录下，内含 ## E2E 验收 段）
const CONTRACT_PATH = '/workspace/sprints/contract-draft.md';

describe('parseE2eAcceptanceFromContract', () => {
  it('真实 contract-draft.md → scenarios.length > 0', () => {
    const content = readFileSync(CONTRACT_PATH, 'utf8');
    const result = parseE2eAcceptanceFromContract(content);
    expect(result).not.toBeNull();
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('通过 normalizeAcceptance 非空 scenarios 强校验（lines 93-97）', () => {
    const content = readFileSync(CONTRACT_PATH, 'utf8');
    const result = parseE2eAcceptanceFromContract(content);
    // normalizeAcceptance 会抛错如果 scenarios 为空或结构不合法
    expect(() => normalizeAcceptance(result)).not.toThrow();
  });

  it('每个 scenario 都有 name / covered_tasks / commands', () => {
    const content = readFileSync(CONTRACT_PATH, 'utf8');
    const { scenarios } = parseE2eAcceptanceFromContract(content);
    for (const sc of scenarios) {
      expect(typeof sc.name).toBe('string');
      expect(sc.name.length).toBeGreaterThan(0);
      expect(Array.isArray(sc.covered_tasks)).toBe(true);
      expect(sc.covered_tasks.length).toBeGreaterThan(0);
      expect(Array.isArray(sc.commands)).toBe(true);
      expect(sc.commands.length).toBeGreaterThan(0);
      expect(typeof sc.commands[0].cmd).toBe('string');
      expect(sc.commands[0].cmd.length).toBeGreaterThan(0);
    }
  });

  it('无 ## E2E 验收 段 → 返回 null', () => {
    expect(parseE2eAcceptanceFromContract('# Just a title\n\nSome content')).toBeNull();
  });

  it('空字符串 → 返回 null', () => {
    expect(parseE2eAcceptanceFromContract('')).toBeNull();
    expect(parseE2eAcceptanceFromContract(null)).toBeNull();
  });

  it('内联脚本生成 heredoc cmd', () => {
    const md = `# Contract\n\n## E2E 验收\n\n\`\`\`bash\ncurl http://localhost:5221/api/brain/health\necho done\n\`\`\`\n`;
    const result = parseE2eAcceptanceFromContract(md);
    expect(result).not.toBeNull();
    expect(result.scenarios.length).toBe(1);
    const cmd = result.scenarios[0].commands[0].cmd;
    expect(cmd).toContain('bash <<');
    expect(cmd).toContain('curl http://localhost:5221/api/brain/health');
  });

  it('.sh 文件引用 → 生成 bash <path> cmd', () => {
    const md = `# Contract\n\n## E2E 验收\n\n\`\`\`bash\nscripts/e2e-test.sh\n\`\`\`\n`;
    const result = parseE2eAcceptanceFromContract(md);
    expect(result).not.toBeNull();
    expect(result.scenarios[0].commands[0].cmd).toBe('bash scripts/e2e-test.sh');
  });

  it('.ps1 文件引用 → 生成 pwsh <path> cmd', () => {
    const md = `# Contract\n\n## E2E 验收\n\n\`\`\`\nscripts/e2e-test.ps1\n\`\`\`\n`;
    const result = parseE2eAcceptanceFromContract(md);
    expect(result).not.toBeNull();
    expect(result.scenarios[0].commands[0].cmd).toBe('pwsh scripts/e2e-test.ps1');
  });

  it('多个 bash block → 多 scenarios', () => {
    const md = [
      '# Contract',
      '',
      '## E2E 验收',
      '',
      '```bash',
      'curl http://localhost:5221/health',
      '```',
      '',
      '```bash',
      'curl http://localhost:5221/api/brain/tasks',
      '```',
      '',
    ].join('\n');
    const result = parseE2eAcceptanceFromContract(md);
    expect(result.scenarios.length).toBe(2);
  });

  it('## E2E 验收 段后的其他 ## 段不混入', () => {
    const md = [
      '# Contract',
      '',
      '## E2E 验收',
      '',
      '```bash',
      'curl http://localhost:5221/health',
      '```',
      '',
      '## 风险与对冲',
      '',
      '```bash',
      'this should not be included',
      '```',
    ].join('\n');
    const result = parseE2eAcceptanceFromContract(md);
    expect(result.scenarios.length).toBe(1);
    expect(result.scenarios[0].commands[0].cmd).not.toContain('this should not be included');
  });
});
