import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const skillPath = resolve(
  process.cwd(),
  '../../packages/workflows/skills/harness-evaluator/SKILL.md',
);

describe('harness-evaluator required_command_evidence 输出合同', () => {
  it('要求每条声明命令原样执行并单独写入结构化 checks', () => {
    const skill = readFileSync(skillPath, 'utf8');

    expect(skill).toContain('required_command_evidence');
    expect(skill).toContain('command 字段必须与声明字符串逐字一致');
    expect(skill).toContain('每条命令单独写入 checks');
  });
});
