/**
 * golden-path-contract-task.test.js — GP → harness 任务的胶水常量与目录命名
 *
 * Task: d2567378-babb-4d7d-808c-968186223a8b（债2 GP 胶水参数化）
 */

import { describe, it, expect } from 'vitest';

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
