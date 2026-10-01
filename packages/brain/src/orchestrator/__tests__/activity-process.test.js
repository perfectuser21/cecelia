import { describe, test, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callActivityProcess } from '../activity-process.js';

const fixtureDir = dirname(fileURLToPath(new URL('./fixtures/activity-runtime/activity.mjs', import.meta.url)));

describe('activity-process真实进程边界', () => {
  test('预算内真实心跳触发安全取消，返回活动清理产物及真实退出码', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'activity-process-heartbeat-'));
    try {
      const controller = new AbortController(), heartbeats = [];
      const result = await callActivityProcess({ budget: { max_duration_s: 10, heartbeat_s: 1 },
        runtime: { entry: 'activity.mjs', argv: ['safe-stop'], cleanup_grace_s: 1 } },
      { run_tag: 'heartbeat-run', trace: join(dir, 'trace') }, {
        cwd: fixtureDir, signal: controller.signal, onHeartbeat: async event => {
          heartbeats.push(event); controller.abort();
        },
      });
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].elapsed_s).toBeGreaterThanOrEqual(0.9);
      expect(result.reason_code).toBe('run_cancelled');
      expect(result.exit_code).toBe(2);
      expect(JSON.parse(result.stdout).outputs.fragments).toEqual([{ id: 'safely-retained' }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 10000);
  test('无执行权的SH入口返回真实EACCES，不冒充活动成功', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'activity-process-admission-'));
    try {
      await writeFile(join(cwd, 'blocked.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o600 });
      const result = await callActivityProcess({ budget: { max_duration_s: 5, heartbeat_s: 1 },
        runtime: { entry: 'blocked.sh', argv: [] } }, { run_tag: 'admission-run' }, { cwd });
      expect(result.reason_code).toBe('EACCES');
      expect(result.exit_code).not.toBe(0);
      expect(result.stdout).toBe('');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
