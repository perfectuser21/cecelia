import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const VALIDATOR_PATH = '../../validators/prd-structure.mjs';

const NINE_HEADINGS = [
  'OKR 对齐',
  '背景',
  '目标',
  'User Stories',
  '验收场景',
  '功能需求',
  '成功标准',
  '假设',
  '边界情况',
];

describe('Workstream 2 — validatePrdStructure [BEHAVIOR]', () => {
  it('returns ok=true with sections=9 for the real Initiative B2 PRD', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const content = readFileSync('sprints/sprint-prd.md', 'utf8');
    const result = mod.validatePrdStructure(content);
    expect(result.ok).toBe(true);
    expect(result.sections).toBe(9);
  });

  it('returns ok=false listing all 9 missing section names when given an empty document', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.validatePrdStructure('# Just a title\n\nNo sections at all.\n');
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.missing)).toBe(true);
    expect(result.missing).toHaveLength(9);
    for (const heading of NINE_HEADINGS) {
      expect(result.missing).toContain(heading);
    }
  });

  it('returns ok=false with emptySections naming the offending heading when a section body is whitespace-only', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const headers = NINE_HEADINGS.map((h, i) => {
      if (h === '边界情况') return `## ${h}\n   \n`;
      return `## ${h}\n\nContent for ${h} #${i}.\n`;
    }).join('\n');
    const result = mod.validatePrdStructure('# PRD\n\n' + headers);
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.emptySections)).toBe(true);
    expect(result.emptySections).toContain('边界情况');
  });

  it('treats sections separated only by code fences as empty', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const headers = NINE_HEADINGS.map((h) => {
      if (h === '假设') return `## ${h}\n\n\`\`\`\n\`\`\`\n`;
      return `## ${h}\n\nNon-empty body for ${h}.\n`;
    }).join('\n');
    const result = mod.validatePrdStructure('# PRD\n\n' + headers);
    expect(result.ok).toBe(false);
    expect(result.emptySections).toContain('假设');
  });
});
