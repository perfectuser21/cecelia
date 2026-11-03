import { expect, it, vi } from 'vitest';

// 重现既有 executor consumer 的部分 child_process transport；无 Git 恢复不需凭据组件。
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  const { execFile, ...transport } = actual;
  return transport;
});

it('F1导入历史Kernel不加载恢复凭据，新建在连接前拒绝', async () => {
  const { createKernelRun } = await import('../../../packages/brain/src/orchestrator/kernel-run-store.js');
  const connect = vi.fn();
  await expect(createKernelRun({ connect }, { phase: 'invalid' })).rejects.toMatchObject({code:'kernel_runtime_retired'});
  expect(connect).not.toHaveBeenCalled();
});
