/**
 * harness-death-classifier.test.js — 分类器单元测试（vitest）
 * 配对文件：packages/brain/src/harness-death-classifier.js
 * 覆盖：7 cause 枚举、三源优先级、边界条件
 */

import { describe, it, expect } from 'vitest';
import { classifyDeath } from '../harness-death-classifier.js';

describe('classifyDeath — exitCode 优先（源1）', () => {
  it('exitCode=137 → cause=oom, action=oom_upgrade', () => {
    expect(classifyDeath({ exitCode: 137, stdoutTail: '', tmuxPane: null }))
      .toEqual({ cause: 'oom', action: 'oom_upgrade' });
  });

  it('exitCode=137 + rate_limit 文本 → 仍为 oom（exitCode 优先）', () => {
    expect(classifyDeath({ exitCode: 137, stdoutTail: 'rate limit exceeded', tmuxPane: null }).cause)
      .toBe('oom');
  });
});

describe('classifyDeath — stdoutTail 关键词（源2）', () => {
  it('stdoutTail 含 401 → cause=auth', () => {
    expect(classifyDeath({ exitCode: 1, stdoutTail: 'HTTP 401 Unauthorized', tmuxPane: null }))
      .toMatchObject({ cause: 'auth', action: 'auth_retry' });
  });

  it('stdoutTail 含 403 → cause=auth', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: '403 Forbidden', tmuxPane: null }).cause)
      .toBe('auth');
  });

  it('stdoutTail 含 unauthorized → cause=auth（大小写不敏感）', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: 'Error: Unauthorized access', tmuxPane: null }).cause)
      .toBe('auth');
  });

  it('stdoutTail 含 429 → cause=rate_limit', () => {
    expect(classifyDeath({ exitCode: 1, stdoutTail: '429 Too Many Requests', tmuxPane: null }))
      .toMatchObject({ cause: 'rate_limit', action: 'rate_limit_defer' });
  });

  it('stdoutTail 含 quota → cause=rate_limit', () => {
    expect(classifyDeath({ exitCode: 1, stdoutTail: 'quota exceeded', tmuxPane: null }).cause)
      .toBe('rate_limit');
  });

  it('stdoutTail 含 CI_RED → cause=ci_red', () => {
    expect(classifyDeath({ exitCode: 1, stdoutTail: 'CI_RED: build failed', tmuxPane: null }))
      .toMatchObject({ cause: 'ci_red', action: 'ci_red_refire' });
  });

  it('stdoutTail 含 GREEN_WAITING → cause=green_waiting_merge', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: 'GREEN_WAITING for merge', tmuxPane: null }))
      .toMatchObject({ cause: 'green_waiting_merge', action: 'await_merge' });
  });
});

describe('classifyDeath — tmuxPane（源3，最低优先）', () => {
  it('tmuxPane 含 Press enter → cause=interactive_stuck', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: '', tmuxPane: 'Press enter to continue' }))
      .toMatchObject({ cause: 'interactive_stuck', action: 'kill_refire' });
  });

  it('tmuxPane 含 press esc → cause=interactive_stuck（大小写不敏感）', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: '', tmuxPane: 'press esc to cancel' }).cause)
      .toBe('interactive_stuck');
  });

  it('tmuxPane 含 [Y/n] → cause=interactive_stuck', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: '', tmuxPane: 'Continue? [Y/n]' }).cause)
      .toBe('interactive_stuck');
  });
});

describe('classifyDeath — unknown 兜底（保守默认）', () => {
  it('无特征 exitCode=1 空 tail → cause=unknown', () => {
    expect(classifyDeath({ exitCode: 1, stdoutTail: '', tmuxPane: null }))
      .toEqual({ cause: 'unknown', action: 'log_only' });
  });

  it('所有参数为 null → cause=unknown', () => {
    expect(classifyDeath({ exitCode: null, stdoutTail: null, tmuxPane: null }))
      .toEqual({ cause: 'unknown', action: 'log_only' });
  });

  it('正常退出 exitCode=0 无关键词 → cause=unknown', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: 'task completed successfully', tmuxPane: null }).cause)
      .toBe('unknown');
  });
});

describe('classifyDeath — 三源优先级验证', () => {
  it('exitCode=137 > stdoutTail auth 关键词（exitCode 优先）', () => {
    expect(classifyDeath({ exitCode: 137, stdoutTail: '401 Unauthorized', tmuxPane: null }).cause)
      .toBe('oom');
  });

  it('stdoutTail auth > tmuxPane interactive（stdoutTail 优先）', () => {
    expect(classifyDeath({ exitCode: 0, stdoutTail: '403 Forbidden', tmuxPane: 'Press enter' }).cause)
      .toBe('auth');
  });
});

describe('classifyDeath — 模块约束（INV-03/INV-07）', () => {
  it('函数执行耗时 < 1ms（纯同步）', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      classifyDeath({ exitCode: 137, stdoutTail: '', tmuxPane: null });
    }
    const avg = (performance.now() - start) / 1000;
    expect(avg).toBeLessThan(1);
  });

  it('无 import 约束 — 模块无任何 import 语句', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, '../harness-death-classifier.js'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^import\s/.test(l));
    expect(importLines).toHaveLength(0);
  });
});
