import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  new URL('../../../../../packages/workflows/skills/harness-evaluator/SKILL.md', import.meta.url),
  'utf8',
);
describe('固定 evaluator 来源的收据与 writer 合同', () => {
  it('required_assertions 由可信 Runner 逐项执行并输出可机械验真的 checks', () => {
    expect(skill).toContain('required_assertions');
    expect(skill).toContain('Harness Runner');
    expect(skill).not.toContain('required-assertions-executor:start');
  });

  it('最终 writer 是合法 bash', () => {
    const start = '# evaluator-result-writer:start';
    const end = '# evaluator-result-writer:end';
    const block = skill.slice(skill.indexOf(start), skill.indexOf(end) + end.length);
    expect(block).toContain(start);
    expect(spawnSync('bash', ['-n'], { input: block, encoding: 'utf8' })).toMatchObject({
      status: 0,
      stderr: '',
    });
  });
});
