import { expect, it, vi } from 'vitest';

// 重现既有 executor consumer 的部分 child_process transport；无 Git 恢复不需凭据组件。
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  const { execFile, ...transport } = actual;
  return transport;
});

it('F1普通接单能加载真实Kernel，恢复专用Git凭据仅在显式恢复时加载', async () => {
  const { createKernelRun } = await import('../../../packages/brain/src/orchestrator/kernel-run-store.js');
  const connect = vi.fn();
  await expect(createKernelRun({ connect }, { phase: 'invalid' })).rejects.toThrow('invalid Kernel run start phase');
  expect(connect).not.toHaveBeenCalled();
});
