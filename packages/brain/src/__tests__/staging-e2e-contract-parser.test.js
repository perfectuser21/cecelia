/**
 * parseE2eAcceptanceFromContract 单元测试。
 * 覆盖：真实 contract-draft.md 解析、normalizeAcceptance 兼容性、边界情况。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

const { parseE2eAcceptanceFromContract } = await import('../staging-e2e-runner.js');
const { normalizeAcceptance } = await import('../harness-final-e2e.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(__dirname, '../../../../sprints/contract-draft.md');

describe('parseE2eAcceptanceFromContract — 真实 contract-draft.md', () => {
  const md = readFileSync(CONTRACT_PATH, 'utf8');

  it('解析出 scenarios.length > 0', () => {
    const result = parseE2eAcceptanceFromContract(md);
    expect(result).not.toBeNull();
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('每个 scenario 含 name、covered_tasks、commands', () => {
    const { scenarios } = parseE2eAcceptanceFromContract(md);
    for (const sc of scenarios) {
      expect(typeof sc.name).toBe('string');
      expect(sc.name.length).toBeGreaterThan(0);
      expect(Array.isArray(sc.covered_tasks)).toBe(true);
      expect(sc.covered_tasks.length).toBeGreaterThan(0);
      expect(Array.isArray(sc.commands)).toBe(true);
      expect(sc.commands.length).toBeGreaterThan(0);
    }
  });

  it('每条 command 含 cmd 字符串', () => {
    const { scenarios } = parseE2eAcceptanceFromContract(md);
    for (const sc of scenarios) {
      for (const cmd of sc.commands) {
        expect(typeof cmd.cmd).toBe('string');
        expect(cmd.cmd.length).toBeGreaterThan(0);
      }
    }
  });

  it('通过 normalizeAcceptance 校验（兼容 staging runScenarios 调用路径）', () => {
    const result = parseE2eAcceptanceFromContract(md);
    expect(() => normalizeAcceptance(result)).not.toThrow();
  });
});

describe('parseE2eAcceptanceFromContract — 边界情况', () => {
  it('null 输入 → null', () => {
    expect(parseE2eAcceptanceFromContract(null)).toBeNull();
  });

  it('undefined 输入 → null', () => {
    expect(parseE2eAcceptanceFromContract(undefined)).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(parseE2eAcceptanceFromContract('')).toBeNull();
  });

  it('无 E2E 验收段 → null', () => {
    const md = '# Title\n## 其他段落\n内容';
    expect(parseE2eAcceptanceFromContract(md)).toBeNull();
  });

  it('有 E2E 验收段但无代码块且无脚本引用 → null', () => {
    const md = '## E2E 验收\n纯文字，无命令\n## 下一段';
    expect(parseE2eAcceptanceFromContract(md)).toBeNull();
  });

  it('内联 bash 块 → 提取为 commands', () => {
    const md = '## E2E 验收\n```bash\ncurl http://localhost:5221/api/brain/health\n```\n';
    const result = parseE2eAcceptanceFromContract(md);
    expect(result).not.toBeNull();
    expect(result.scenarios[0].commands[0].cmd).toContain('curl');
    expect(result.scenarios[0].commands[0].type).toBe('bash');
  });

  it('脚本文件引用（.sh）→ 兜底提取', () => {
    const md = '## E2E 验收\n运行 bash scripts/e2e-verify.sh 验证\n## 结束';
    const result = parseE2eAcceptanceFromContract(md);
    expect(result).not.toBeNull();
    expect(result.scenarios[0].commands[0].cmd).toContain('scripts/e2e-verify.sh');
  });
});
