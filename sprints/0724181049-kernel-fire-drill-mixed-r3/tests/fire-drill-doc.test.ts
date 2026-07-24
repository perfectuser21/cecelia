import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOC = join(__dirname, '../../../docs/fire-drills/kernel-v1-mixed-20260724-r3.md');

describe('kernel v1 mixed fire drill r3 交付文档 [BEHAVIOR]', () => {
  it('验收命令通过：文件存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3', async () => {
    const c = await readFile(DOC, 'utf8');
    expect(c).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3');
  });

  it('字面包含生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850', async () => {
    const c = await readFile(DOC, 'utf8');
    expect(c).toContain('1.267.67');
    expect(c).toContain('19887912bbb581597f12c714a9ed187f051e2850');
  });

  it('六角色 provider/account 证据行齐全（planner/proposer=claude/account1，reviewer/evaluator=grok/grok，generator=codex/team3，judge 以实际 run 为准）', async () => {
    const c = await readFile(DOC, 'utf8');
    for (const pair of [
      'planner=claude/account1',
      'proposer=claude/account1',
      'reviewer=grok/grok',
      'evaluator=grok/grok',
      'generator=codex/team3',
      'judge=',
    ]) {
      expect(c, `缺角色证据 ${pair}`).toContain(pair);
    }
  });

  it('证据锚定本次 run_id 4c7fcc5b-32ee-4a7f-9649-3b857ed30610（防伪：历史 r1/r2 不可能包含）', async () => {
    const c = await readFile(DOC, 'utf8');
    expect(c).toContain('4c7fcc5b-32ee-4a7f-9649-3b857ed30610');
  });
});
