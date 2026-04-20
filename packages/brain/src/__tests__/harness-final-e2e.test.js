/**
 * Harness v2 M5 — harness-final-e2e 单元测试
 *
 * 覆盖（mock-based，不起真实 docker / curl）：
 *   - runScenarioCommand exit=0 / 抛错 / 超长输出截尾 / 空 cmd 兜底
 *   - normalizeAcceptance 合法 + 各种非法结构
 *   - bootstrapE2E / teardownE2E exec 注入
 *   - runFinalE2E happy path（全 PASS）
 *   - runFinalE2E 部分失败（FAIL + failedScenarios 列表正确）
 *   - runFinalE2E bootstrap 失败 fail-fast
 *   - attributeFailures 空数组 / 单 Task / 多 Task 聚合 / failureCount 累加
 */

import { describe, it, expect } from 'vitest';
import {
  runScenarioCommand,
  normalizeAcceptance,
  bootstrapE2E,
  teardownE2E,
  runFinalE2E,
  attributeFailures,
} from '../harness-final-e2e.js';

// ─── runScenarioCommand ────────────────────────────────────────────────────

describe('runScenarioCommand', () => {
  it('exec 返回字符串 → exitCode 0', () => {
    const exec = () => 'HTTP/1.1 200 OK\n';
    const r = runScenarioCommand({ cmd: 'curl http://x' }, { exec });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('200 OK');
  });

  it('exec 返回 Buffer → 转成字符串', () => {
    const exec = () => Buffer.from('buffer-out');
    const r = runScenarioCommand({ cmd: 'ls' }, { exec });
    expect(r.exitCode).toBe(0);
    expect(r.output).toBe('buffer-out');
  });

  it('exec 抛错 → exitCode 非 0 + output 含 stderr', () => {
    const exec = () => {
      const err = new Error('command failed');
      err.status = 2;
      err.stdout = 'some stdout';
      err.stderr = 'some stderr';
      throw err;
    };
    const r = runScenarioCommand({ cmd: 'false' }, { exec });
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain('some stderr');
    expect(r.output).toContain('some stdout');
  });

  it('exec 抛无 status 错 → 默认 exitCode 1', () => {
    const exec = () => { throw new Error('no status field'); };
    const r = runScenarioCommand({ cmd: 'false' }, { exec });
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('no status field');
  });

  it('超长输出截尾到 4000 字节', () => {
    const huge = 'x'.repeat(10000);
    const exec = () => huge;
    const r = runScenarioCommand({ cmd: 'cat huge' }, { exec });
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeLessThanOrEqual(4000);
  });

  it('空 cmd 兜底为 FAIL', () => {
    const r = runScenarioCommand({ cmd: '  ' }, { exec: () => 'x' });
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/empty cmd/);
  });

  it('非对象 command 兜底为 FAIL', () => {
    expect(runScenarioCommand(null).exitCode).toBe(1);
    expect(runScenarioCommand({ cmd: 123 }).exitCode).toBe(1);
  });
});

// ─── normalizeAcceptance ───────────────────────────────────────────────────

describe('normalizeAcceptance', () => {
  const validScenario = {
    name: 's1',
    covered_tasks: ['t1'],
    commands: [{ type: 'curl', cmd: 'curl http://x' }],
  };

  it('合法结构 → 返回 { scenarios }', () => {
    const r = normalizeAcceptance({ scenarios: [validScenario] });
    expect(r.scenarios.length).toBe(1);
  });

  it('acceptance 非对象 → 抛错', () => {
    expect(() => normalizeAcceptance(null)).toThrow(/must be an object/);
    expect(() => normalizeAcceptance('str')).toThrow();
  });

  it('scenarios 为空 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [] })).toThrow(/non-empty/);
    expect(() => normalizeAcceptance({})).toThrow();
  });

  it('scenario.name 缺失 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [{ ...validScenario, name: '' }] }))
      .toThrow(/name required/);
  });

  it('scenario.covered_tasks 空 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [{ ...validScenario, covered_tasks: [] }] }))
      .toThrow(/covered_tasks/);
  });

  it('scenario.commands 空 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [{ ...validScenario, commands: [] }] }))
      .toThrow(/commands/);
  });

  it('scenario 非对象 → 抛错', () => {
    expect(() => normalizeAcceptance({ scenarios: [null] })).toThrow();
  });
});

// ─── bootstrapE2E / teardownE2E ────────────────────────────────────────────

describe('bootstrapE2E / teardownE2E', () => {
  it('bootstrap 成功 → exitCode 0 + 调 up 脚本', () => {
    let receivedCmd = '';
    const exec = (cmd) => { receivedCmd = cmd; return 'OK'; };
    const r = bootstrapE2E({ exec });
    expect(r.exitCode).toBe(0);
    expect(receivedCmd).toMatch(/scripts\/harness-e2e-up\.sh/);
  });

  it('bootstrap 自定义 upScript', () => {
    let receivedCmd = '';
    const exec = (cmd) => { receivedCmd = cmd; return 'OK'; };
    const r = bootstrapE2E({ exec, upScript: 'scripts/custom-up.sh' });
    expect(r.exitCode).toBe(0);
    expect(receivedCmd).toMatch(/custom-up\.sh/);
  });

  it('teardown 成功 → exitCode 0', () => {
    let receivedCmd = '';
    const exec = (cmd) => { receivedCmd = cmd; return 'OK'; };
    const r = teardownE2E({ exec });
    expect(r.exitCode).toBe(0);
    expect(receivedCmd).toMatch(/scripts\/harness-e2e-down\.sh/);
  });

  it('teardown 失败 → exitCode 非 0 但不抛', () => {
    const exec = () => { const e = new Error('docker daemon down'); e.status = 127; throw e; };
    const r = teardownE2E({ exec });
    expect(r.exitCode).toBe(127);
  });
});

// ─── runFinalE2E ───────────────────────────────────────────────────────────

describe('runFinalE2E — happy path', () => {
  const contract = {
    e2e_acceptance: {
      scenarios: [
        {
          name: 'KPI 查询链路',
          covered_tasks: ['task-a', 'task-b'],
          commands: [
            { type: 'curl', cmd: 'curl http://localhost:5222/api/health' },
            { type: 'node', cmd: 'node tests/e2e/smoke.js' },
          ],
        },
        {
          name: 'Dashboard 首屏',
          covered_tasks: ['task-c'],
          commands: [{ type: 'playwright', cmd: 'playwright test' }],
        },
      ],
    },
  };

  it('所有 scenarios PASS → verdict PASS', async () => {
    const runScenario = async () => ({ exitCode: 0, output: 'ok' });
    const r = await runFinalE2E('init-1', contract, {
      runScenario,
      bootstrap: () => ({ exitCode: 0, output: 'up' }),
      teardown: () => ({ exitCode: 0, output: 'down' }),
    });
    expect(r.verdict).toBe('PASS');
    expect(r.failedScenarios).toEqual([]);
    expect(r.passedScenarios.length).toBe(2);
    expect(r.bootstrap.exitCode).toBe(0);
    expect(r.teardown.exitCode).toBe(0);
  });

  it('skipBootstrap=true → bootstrap/teardown 为 null', async () => {
    const runScenario = async () => ({ exitCode: 0, output: 'ok' });
    const r = await runFinalE2E('init-2', contract, {
      runScenario,
      skipBootstrap: true,
    });
    expect(r.verdict).toBe('PASS');
    expect(r.bootstrap).toBeNull();
    expect(r.teardown).toBeNull();
  });

  it('teardown 抛错 → teardown.exitCode 非 0 但 verdict 不变', async () => {
    const runScenario = async () => ({ exitCode: 0, output: 'ok' });
    const r = await runFinalE2E('init-t', contract, {
      runScenario,
      bootstrap: () => ({ exitCode: 0, output: 'up' }),
      teardown: () => { throw new Error('teardown boom'); },
    });
    expect(r.verdict).toBe('PASS');
    expect(r.teardown.exitCode).toBe(1);
    expect(r.teardown.output).toMatch(/teardown boom/);
  });
});

describe('runFinalE2E — partial failure', () => {
  const contract = {
    e2e_acceptance: {
      scenarios: [
        {
          name: 'Scenario A（会 PASS）',
          covered_tasks: ['task-a'],
          commands: [{ cmd: 'curl A1' }, { cmd: 'curl A2' }],
        },
        {
          name: 'Scenario B（第二条失败）',
          covered_tasks: ['task-b', 'task-c'],
          commands: [{ cmd: 'curl B1' }, { cmd: 'curl B2' }],
        },
        {
          name: 'Scenario C（第一条失败）',
          covered_tasks: ['task-c'],
          commands: [{ cmd: 'curl C1' }],
        },
      ],
    },
  };

  it('B fail-fast + C fail → verdict FAIL + 2 项失败', async () => {
    const runScenario = async (cmd) => {
      if (cmd.cmd === 'curl B2') {
        return { exitCode: 2, output: 'B2 bad response' };
      }
      if (cmd.cmd === 'curl C1') {
        return { exitCode: 3, output: 'C1 connection refused' };
      }
      return { exitCode: 0, output: 'ok' };
    };
    const r = await runFinalE2E('init-fail', contract, {
      runScenario,
      skipBootstrap: true,
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.failedScenarios.length).toBe(2);
    expect(r.passedScenarios.length).toBe(1);
    expect(r.passedScenarios[0].name).toMatch(/Scenario A/);

    const b = r.failedScenarios.find((s) => s.name.includes('Scenario B'));
    expect(b.failedCommand).toBe('curl B2');
    expect(b.exitCode).toBe(2);
    expect(b.covered_tasks).toEqual(['task-b', 'task-c']);

    const c = r.failedScenarios.find((s) => s.name.includes('Scenario C'));
    expect(c.failedCommand).toBe('curl C1');
    expect(c.exitCode).toBe(3);
  });

  it('scenario 内第一条失败 → 不继续跑后续命令（fail-fast）', async () => {
    const calls = [];
    const runScenario = async (cmd) => {
      calls.push(cmd.cmd);
      if (cmd.cmd === 'curl B1') return { exitCode: 1, output: 'B1 fail' };
      return { exitCode: 0, output: 'ok' };
    };
    await runFinalE2E('init-ff', contract, { runScenario, skipBootstrap: true });
    // B1 失败后 B2 不能再被调用
    expect(calls).not.toContain('curl B2');
    expect(calls).toContain('curl B1');
  });
});

describe('runFinalE2E — bootstrap failure', () => {
  const contract = {
    e2e_acceptance: {
      scenarios: [
        { name: 's1', covered_tasks: ['t1', 't2'], commands: [{ cmd: 'curl x' }] },
        { name: 's2', covered_tasks: ['t2', 't3'], commands: [{ cmd: 'curl y' }] },
      ],
    },
  };

  it('up 脚本失败 → FAIL + 归因汇聚所有 covered_tasks', async () => {
    const runScenario = async () => ({ exitCode: 0, output: 'unreached' });
    const r = await runFinalE2E('init-bs', contract, {
      runScenario,
      bootstrap: () => ({ exitCode: 9, output: 'postgres port busy' }),
      teardown: () => ({ exitCode: 0, output: 'noop' }),
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.failedScenarios.length).toBe(1);
    expect(r.failedScenarios[0].name).toMatch(/bootstrap failure/);
    expect(r.failedScenarios[0].exitCode).toBe(9);
    // 去重后应为 t1 / t2 / t3
    expect(new Set(r.failedScenarios[0].covered_tasks)).toEqual(new Set(['t1', 't2', 't3']));
  });
});

describe('runFinalE2E — input validation', () => {
  const minimalContract = {
    e2e_acceptance: {
      scenarios: [{ name: 's', covered_tasks: ['t'], commands: [{ cmd: 'x' }] }],
    },
  };

  it('initiativeId 缺失 → 抛错', async () => {
    await expect(runFinalE2E('', minimalContract)).rejects.toThrow(/initiativeId/);
    await expect(runFinalE2E(null, minimalContract)).rejects.toThrow();
  });

  it('contract 缺失 → 抛错', async () => {
    await expect(runFinalE2E('id', null)).rejects.toThrow(/contract/);
  });

  it('e2e_acceptance 结构非法 → 抛错（normalizeAcceptance 传出）', async () => {
    await expect(runFinalE2E('id', { e2e_acceptance: { scenarios: [] } }))
      .rejects.toThrow();
  });
});

// ─── attributeFailures ─────────────────────────────────────────────────────

describe('attributeFailures', () => {
  it('空数组 → 空 Map', () => {
    expect(attributeFailures([]).size).toBe(0);
    expect(attributeFailures(null).size).toBe(0);
    expect(attributeFailures(undefined).size).toBe(0);
  });

  it('单 scenario 单 task → 单 entry failureCount=1', () => {
    const m = attributeFailures([
      { name: 'A', covered_tasks: ['t1'], exitCode: 2, output: 'err A' },
    ]);
    expect(m.size).toBe(1);
    expect(m.get('t1').failureCount).toBe(1);
    expect(m.get('t1').scenarios[0].name).toBe('A');
    expect(m.get('t1').scenarios[0].exitCode).toBe(2);
  });

  it('多 scenario 击中同 task → failureCount 累加', () => {
    const m = attributeFailures([
      { name: 'A', covered_tasks: ['t1', 't2'], exitCode: 1, output: '1' },
      { name: 'B', covered_tasks: ['t1'], exitCode: 3, output: '2' },
      { name: 'C', covered_tasks: ['t3'], exitCode: 1, output: '3' },
    ]);
    expect(m.size).toBe(3);
    expect(m.get('t1').failureCount).toBe(2);
    expect(m.get('t1').scenarios.map((s) => s.name)).toEqual(['A', 'B']);
    expect(m.get('t2').failureCount).toBe(1);
    expect(m.get('t3').failureCount).toBe(1);
  });

  it('covered_tasks 非数组或 task_id 非字符串 → 跳过', () => {
    const m = attributeFailures([
      { name: 'X', covered_tasks: null, exitCode: 1 },
      { name: 'Y', covered_tasks: ['', '   ', null, 42], exitCode: 1 },
      { name: 'Z', covered_tasks: ['valid-id'], exitCode: 1 },
    ]);
    // 只有 'valid-id' 被收集
    expect(m.size).toBe(1);
    expect(m.has('valid-id')).toBe(true);
  });

  it('exitCode 缺失 → 默认 1，output 缺失 → 空字符串', () => {
    const m = attributeFailures([
      { name: 'A', covered_tasks: ['t1'] },
    ]);
    expect(m.get('t1').scenarios[0].exitCode).toBe(1);
    expect(m.get('t1').scenarios[0].output).toBe('');
  });

  it('null 项被跳过', () => {
    const m = attributeFailures([
      null,
      { name: 'A', covered_tasks: ['t1'], exitCode: 1 },
    ]);
    expect(m.size).toBe(1);
  });

  it('保留 Map 插入顺序', () => {
    const m = attributeFailures([
      { name: 'A', covered_tasks: ['t-beta'], exitCode: 1 },
      { name: 'B', covered_tasks: ['t-alpha'], exitCode: 1 },
    ]);
    const keys = [...m.keys()];
    expect(keys).toEqual(['t-beta', 't-alpha']);
  });
});
