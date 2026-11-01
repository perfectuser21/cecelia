import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GP_HARNESS_TARGET_ENVIRONMENTS } from '../golden-path-contract-task.js';

describe('GP 与固定 proposer 来源的枚举合同', () => {
  /**
   * SSOT 是 harness-contract-proposer SKILL 的 target_environment 行——Proposer 按它写合同，
   * Brain 按 JS 侧枚举收 GP。两边漂了不会有人当场发现：Proposer 写出的合法环境
   * 在 GP 转 harness 时被拒，或反过来 GP 收下的环境 Proposer 根本不认。
   * 这条把漂移变成一次 CI 红。
   */
  it('JS 枚举与 harness-contract-proposer SKILL.md 的 target_environment 行逐字一致', () => {
    const skillMd = readFileSync(
      new URL('../../../workflows/skills/harness-contract-proposer/SKILL.md', import.meta.url),
      'utf8',
    );
    const line = skillMd.match(/\*\*target_environment\*\*:\s*\{([^}]+)\}/);
    expect(line, 'SKILL.md 里找不到 **target_environment**: {...} 行').toBeTruthy();

    const skillEnums = line[1].split('|').map((s) => s.trim()).filter(Boolean);
    expect(skillEnums.sort()).toEqual([...GP_HARNESS_TARGET_ENVIRONMENTS].sort());
  });
});
