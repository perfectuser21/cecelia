/**
 * Unit tests for harness-e2e-runner.js
 * 覆盖 runE2eScriptCommands / runAndRecordE2eCommands 逐命令采集逻辑。
 */
import { describe, it, expect, vi } from 'vitest';
import { runE2eScriptCommands, runAndRecordE2eCommands } from '../harness-e2e-runner.js';

describe('harness-e2e-runner — runE2eScriptCommands', () => {
  it('空脚本返回空 commands 数组', async () => {
    const result = await runE2eScriptCommands('', {});
    expect(result.commands).toHaveLength(0);
  });

  it('注释行和空行被跳过', async () => {
    const script = '# comment\n\n# another comment\n';
    const result = await runE2eScriptCommands(script, {});
    expect(result.commands).toHaveLength(0);
  });

  it('成功命令 exitCode=0，stdout 正确采集', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: 'hello', stderr: '' });
    const result = await runE2eScriptCommands('echo hello', { execFile });
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].exitCode).toBe(0);
    expect(result.commands[0].stdout).toBe('hello');
    expect(result.commands[0].cmd).toBe('echo hello');
    expect(typeof result.commands[0].elapsedMs).toBe('number');
  });

  it('失败命令 exitCode=1，stderr 如实保留（不丢弃失败输出）', async () => {
    const execFile = vi.fn().mockRejectedValue(
      Object.assign(new Error('cmd failed'), { code: 1, stdout: '', stderr: 'error output' })
    );
    const result = await runE2eScriptCommands('false', { execFile });
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].exitCode).toBe(1);
    expect(result.commands[0].stderr).toBe('error output');
  });

  it('多命令混合 exitCode（不因单条失败中止采集）', async () => {
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '' })
      .mockRejectedValueOnce(Object.assign(new Error('fail'), { code: 1, stdout: '', stderr: 'err' }));
    const result = await runE2eScriptCommands('echo ok\nfalse', { execFile });
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].exitCode).toBe(0);
    expect(result.commands[1].exitCode).toBe(1);
  });
});

describe('harness-e2e-runner — runAndRecordE2eCommands', () => {
  it('返回 ExecutionRecordSchema 兼容结构（含 commands 数组）', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });
    const result = await runAndRecordE2eCommands('echo ok', null, { execFile });
    expect(result).toHaveProperty('commands');
    expect(Array.isArray(result.commands)).toBe(true);
    expect(result.commands[0]).toMatchObject({ cmd: 'echo ok', exitCode: 0 });
  });

  it('outputPath=null 时不写文件（不报错）', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    await expect(runAndRecordE2eCommands('echo x', null, { execFile })).resolves.toBeDefined();
  });
});
