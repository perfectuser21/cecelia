import { describe, expect, it, vi } from 'vitest';
import { JOBS } from '../scheduler-jobs.js';

const env = {
  CECELIA_LINUX_ROOT_DEVICE: '/dev/vda1',
  REPO_ROOT: '/root/cecelia',
};
const mountinfo = [
  '20 19 0:24 / / rw - overlay overlay rw',
  '23 20 254:1 /root/cecelia /root/cecelia rw - ext4 /dev/vda1 rw',
  '24 20 8:0 /docker /run/cecelia-docker-data ro - ext4 /dev/sda rw',
].join('\n');
const job = JOBS.find(job => job.name === 'us-linux-root-disk');
const interval = 15 * 60_000;
let now = Date.UTC(2026, 10, 26);

function fixture() {
  now += interval;
  return {
    env,
    now,
    readFile: vi.fn().mockResolvedValue(mountinfo),
    execFile: vi.fn().mockResolvedValue({
      stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 420 392 8 98% /root/cecelia\n',
    }),
    raise: vi.fn().mockResolvedValue(undefined),
  };
}

describe('US Linux 根卷容量调度', () => {
  it('用已验证的宿主根卷采样并独立发出 P1，紧接的调度不重复观测', async () => {
    expect(job).toMatchObject({ cadence: { everySec: 900 }, needsPool: false });
    const deps = fixture();
    await expect(job.handler(deps)).resolves.toEqual({
      device: '/dev/vda1', usedPercent: 98, availableBytes: 8192,
    });
    expect(deps.execFile.mock.calls.map(([file, args]) => [file, args])).toEqual([['df', ['-Pk', '/root/cecelia']]]);
    expect(deps.raise).toHaveBeenCalledWith(
      'P1', 'disk_linux_root_critical', expect.stringContaining('98%'), expect.anything(),
    );
    await expect(job.handler({ ...deps, now: deps.now + 60_000 })).resolves.toMatchObject({ skipped: true });
    expect(deps.execFile).toHaveBeenCalledOnce();
    expect(deps.raise).toHaveBeenCalledOnce();
  });

  it('GNU df 显示同盘的文件绑定时仍接受已验证的根卷样本', async () => {
    const deps = fixture();
    deps.execFile.mockResolvedValue({
      stdout: [
        'Filesystem           1024-blocks    Used Available Capacity Mounted on',
        '/dev/vda1             24299968  22559152   1724432  93% /HEARTBEAT.md',
      ].join('\n'),
    });
    await expect(job.handler(deps)).resolves.toEqual({
      device: '/dev/vda1', usedPercent: 93, availableBytes: 1765818368,
    });
    expect(deps.raise).toHaveBeenCalledOnce();
    expect(deps.raise).toHaveBeenCalledWith(
      'P1', 'disk_linux_root_critical', expect.stringContaining('93%'), expect.anything(),
    );
  });

  it.each([
    ['挂载缺失', mountinfo.split('\n').filter(line => !line.includes('254:1')).join('\n')],
    ['错误设备', mountinfo.replace('ext4 /dev/vda1', 'ext4 /dev/sda')],
    ['部署目录本身位于另一挂载点', mountinfo.replace('254:1 /root/cecelia', '254:1 /')],
  ])('%s时观测失败并报告来源缺失', async (_, badMountinfo) => {
    const deps = fixture();
    deps.readFile.mockResolvedValue(badMountinfo);
    await expect(job.handler(deps)).rejects.toThrow('/root/cecelia');
    expect(deps.execFile).not.toHaveBeenCalled();
    expect(deps.raise).toHaveBeenCalledWith(
      'P1', 'disk_linux_root_unavailable', expect.stringContaining('/dev/vda1'), expect.anything(),
    );
  });

  it.each([
    [{}, '未启用'],
    [{ ...env, DB_NAME: 'cecelia_staging' }, 'staging'],
    [{ ...env, BRAIN_PREVIEW: 'true' }, 'preview'],
    [{ ...env, BRAIN_DEPLOY_CANARY: '1' }, 'canary'],
  ])('%j（%s）不采样、不告警', async (runtimeEnv) => {
    const deps = fixture();
    await expect(job.handler({ ...deps, env: runtimeEnv })).resolves.toMatchObject({ skipped: true });
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
    expect(deps.raise).not.toHaveBeenCalled();
  });

  it.each([[80, 'P2'], [79, null]])('根卷已用 %d%% 时按阈值告警', async (usedPercent, level) => {
    const deps = fixture();
    deps.execFile.mockResolvedValue({
      stdout: `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 105 ${usedPercent} ${100 - usedPercent} ${usedPercent}% /root/cecelia\n`,
    });
    await expect(job.handler(deps)).resolves.toMatchObject({ usedPercent });
    if (level) {
      expect(deps.raise).toHaveBeenCalledWith(
        level, 'disk_linux_root_warning', expect.stringContaining('80%'), expect.anything(),
      );
    } else {
      expect(deps.raise).not.toHaveBeenCalled();
    }
  });

  it('挂载身份与 df 返回来源不一致时拒绝样本', async () => {
    const deps = fixture();
    deps.execFile.mockResolvedValue({
      stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda 420 392 8 98% /root/cecelia\n',
    });
    await expect(job.handler(deps)).rejects.toThrow('/dev/vda1');
    expect(deps.raise).toHaveBeenCalledWith(
      'P1', 'disk_linux_root_unavailable', expect.stringContaining('/dev/vda1'), expect.anything(),
    );
  });
});
