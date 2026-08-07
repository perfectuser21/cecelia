/**
 * golden-path-contract-task.test.js — GP → harness 任务的胶水常量与目录命名
 *
 * Task: d2567378-babb-4d7d-808c-968186223a8b（债2 GP 胶水参数化）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createGoldenPathSprintDir,
  GP_HARNESS_BASE_REPO,
  GP_HARNESS_TARGET_ENVIRONMENT,
  GP_HARNESS_TARGET_ENVIRONMENTS,
} from '../golden-path-contract-task.js';

describe('GP harness 胶水常量', () => {
  it('回落常量指向 cecelia repo 的 local_api（golden_paths 两列为 NULL 时的取值）', () => {
    expect(GP_HARNESS_BASE_REPO).toBe('https://github.com/perfectuser21/cecelia.git');
    expect(GP_HARNESS_TARGET_ENVIRONMENT).toBe('local_api');
  });

  it('回落的 target_environment 自己必须是合法枚举之一', () => {
    // 常量与枚举分两处写，回落值哪天改成枚举外的字符串，
    // 存量 GP（两列全 NULL）会集体撞 CHECK——这条就是防它。
    expect(GP_HARNESS_TARGET_ENVIRONMENTS).toContain(GP_HARNESS_TARGET_ENVIRONMENT);
  });

  it('枚举覆盖轻量 / Windows / 真机三类目标环境且无重复', () => {
    expect(GP_HARNESS_TARGET_ENVIRONMENTS).toEqual([
      'local_api',
      'mac_web',
      'windows_cloud',
      'windows_wechat',
      'linux_server',
      'playground',
      'android_realmachine',
    ]);
    expect(new Set(GP_HARNESS_TARGET_ENVIRONMENTS).size)
      .toBe(GP_HARNESS_TARGET_ENVIRONMENTS.length);
  });

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

describe('createGoldenPathSprintDir', () => {
  it('用北京时间 MMDDHHNN 戳 + 标题 slug + GP 短 id 组目录名', () => {
    // 2026-08-07T08:50:00Z = 北京 16:50
    const dir = createGoldenPathSprintDir(
      '朋友圈 GP',
      'a1b2c3d4-1111-2222-3333-444455556666',
      new Date('2026-08-07T08:50:00Z'),
    );
    expect(dir).toBe('sprints/08071650-朋友圈-gp-a1b2c3d4');
  });

  it('标题全是符号时退化成 gp 而不是空 slug', () => {
    const dir = createGoldenPathSprintDir('!!! ???', 'ffffffff-0000-0000-0000-000000000000', new Date('2026-08-07T08:50:00Z'));
    expect(dir).toBe('sprints/08071650-gp-ffffffff');
  });
});
