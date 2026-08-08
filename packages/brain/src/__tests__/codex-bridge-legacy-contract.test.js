import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const bridge = require('../../scripts/codex-bridge/codex-bridge.cjs');

describe('Codex Bridge legacy /run 执行合同', () => {
  it('prompt 模式始终使用本机配置的 repo workspace，并允许跨设备映射 canonical repo', () => {
    expect(typeof bridge.resolveLegacyWorkDir).toBe('function');
    expect(bridge.resolveLegacyWorkDir({
      baseRepo: 'perfectuser21/cecelia',
      workDir: null,
      defaultWorkDir: '/machine-local/repos/cecelia',
    })).toBe('/machine-local/repos/cecelia');
  });

  it('legacy Codex 参数显式允许受控的非 git 启动目录，避免 trusted directory 秒挂', () => {
    expect(typeof bridge.buildCodexExecArgs).toBe('function');
    expect(bridge.buildCodexExecArgs('test prompt', 'read-only')).toContain('--skip-git-repo-check');
  });

  it('callback 必须回传原 attempt 的 run_id', () => {
    expect(typeof bridge.buildCallbackPayload).toBe('function');
    const payload = bridge.buildCallbackPayload({
      taskId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      checkpointId: null,
      status: 'failed',
      output: 'boom',
      durationMs: 100,
    });
    expect(payload.run_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload.executor).toBe('codex-bridge');
  });
});
