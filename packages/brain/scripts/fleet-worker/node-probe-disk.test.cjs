'use strict';
/* global describe, it, expect, vi */
const { probeFleetWorkerHealth } = require('./node-probe.cjs');
const { probeDiskResources } = require('./local-resource-admission.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const disk = (free, used) => `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/data 100000 50000 ${free} ${used}% /Data\n`;

async function sample(diskResponses = {}, diskPaths = ['/repo', '/worker', '/mount/worktrees'], env = {}) {
  const execFileFn = vi.fn(async (file, args) => {
    if (file === 'df') {
      const response = diskResponses[args.at(-1)] ?? disk(200000, 27);
      if (response instanceof Error) throw response;
      return { stdout: response };
    }
    return { stdout: '' };
  });
  const report = await probeFleetWorkerHealth({
    env, repoRoot: '/repo', diskPaths, execFileFn,
    fetchFn: async () => ({ ok: true }),
    statFn: async () => { throw new Error('absent'); },
    makeTempDirFn: async () => { throw new Error('no real filesystem changes'); },
  });
  return { report, execFileFn };
}

describe('健康报告采集真实执行目录磁盘', () => {
  it('系统卷宽裕但数据卷紧张时报告最小可用量和最大使用率', async () => {
    const { report, execFileFn } = await sample({ '/worker': disk(20000, 87) });
    expect(report.resources).toMatchObject({ disk_free_bytes: 20000 * 1024, disk_used_percent: 87 });
    expect(execFileFn.mock.calls.filter(([file]) => file === 'df').map(([, args]) => args))
      .toEqual([['-kP', '/repo'], ['-kP', '/worker'], ['-kP', '/mount/worktrees']]);
  });

  it.each([new Error('unreadable'), disk('NaN', 25), disk(10000, 'NaN'), disk(10000, -1)])(
    '任一执行文件系统不可确认就报告未知容量 %s', async (invalid) => {
      const { report } = await sample({ '/worker': invalid });
      expect(report.resources).toMatchObject({ disk_free_bytes: 0, disk_used_percent: 100 });
    },
  );

  it('重复路径只查一次，每轮重新读取', async () => {
    const paths = ['/repo', '/worker', '/worker'];
    const first = await sample({ '/worker': disk(10000, 92) }, paths);
    const second = await sample({ '/worker': disk(90000, 40) }, paths);
    expect(first.report.resources.disk_used_percent).toBe(92);
    expect(second.report.resources.disk_used_percent).toBe(40);
    expect(first.execFileFn.mock.calls.filter(([file]) => file === 'df')).toHaveLength(2);
  });

  it('独立探针默认读取配置的数据目录和仓库，不退回系统卷', async () => {
    const { report, execFileFn } = await sample({ '/worker': disk(18000, 90) }, null,
      { CECELIA_FLEET_DATA_ROOT: '/worker' });
    expect(report.resources.disk_used_percent).toBe(90);
    expect(execFileFn.mock.calls.filter(([file]) => file === 'df').map(([, args]) => args.at(-1)))
      .toEqual(['/repo', '/worker']);
  });

  it('仅安装预检允许尚未创建的目录，读取其实际已有父目录', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-ancestor-'));
    try {
      const run = vi.fn(async () => ({ stdout: disk(30000, 84) }));
      const paths = [path.join(root, 'future', 'worker')];
      const result = await probeDiskResources({ run, paths, allowMissingPaths: true });
      expect(result.disk_used_percent).toBe(84);
      expect(run).toHaveBeenCalledWith('df', ['-kP', root]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('预检不能把断开的符号链接当作未来目录放行', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-link-'));
    try {
      fs.symlinkSync(path.join(root, 'absent'), path.join(root, 'broken'));
      const run = vi.fn(async () => ({ stdout: disk(30000, 84) }));
      const result = await probeDiskResources({ run, paths: [path.join(root, 'broken', 'child')], allowMissingPaths: true });
      expect(result).toEqual({ disk_free_bytes: 0, disk_used_percent: 100 });
      expect(run).not.toHaveBeenCalled();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
