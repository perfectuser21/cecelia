import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmExpiredParentCleanup } from './attempt-resource-cleanup.js';

const id = '11111111-1111-4111-8111-111111111111';
const parent = { id, run_id: '22222222-2222-4222-8222-222222222222', actual_machine_id: 'us-mac-m4',
  execution_transport: 'local-docker', local_container_naming: 'legacy-unsuffixed', lease_owner: 'old', lease_generation: 3 };
afterEach(() => vi.unstubAllEnvs());

describe('恢复前精确旧进程清理', () => {
  it('legacy不能把worker空state的already_clean当作清理证据', async () => {
    const launcher = { cancel: vi.fn(async () => ({ status: 'already_clean', attempt_id: id })) };
    const removeContainer = vi.fn(async () => true);
    const inspectContainer = vi.fn(async () => false);
    const receipt = await confirmExpiredParentCleanup(parent, { env: { CECELIA_MACHINE_ID: 'us-mac-m4' }, launcher, removeContainer, inspectContainer });
    expect(launcher.cancel).not.toHaveBeenCalled();
    expect(removeContainer).toHaveBeenCalledWith('cecelia-harness-11111111');
    expect(inspectContainer).toHaveBeenCalledWith('cecelia-harness-11111111');
    expect(receipt).toEqual({ status: 'cleaned', attempt_id: id });
  });
  it.each([false, 'still_present'])('删除失败或仍存活 %s 不确认停止', async (outcome) => {
    const receipt = await confirmExpiredParentCleanup(parent, { env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      removeContainer: async () => outcome !== false, inspectContainer: async () => true });
    expect(receipt.status).toBe('unavailable');
  });
  it('重复清理时精确inspect证实不存在才返回already_clean', async () => {
    let exists = true;
    const removeContainer = vi.fn(async () => { const removed = exists; exists = false; return removed; });
    const inspectContainer = vi.fn(async () => exists);
    const options = { env: { CECELIA_MACHINE_ID: 'us-mac-m4' }, removeContainer, inspectContainer };
    expect(await confirmExpiredParentCleanup(parent, options)).toEqual({ status: 'cleaned', attempt_id: id });
    expect(await confirmExpiredParentCleanup(parent, options)).toEqual({ status: 'already_clean', attempt_id: id });
    expect(inspectContainer).toHaveBeenCalledTimes(2);
  });
  it.each([null, undefined])('inspect未知结果%s不能作为已停止证据', async (unknown) => {
    expect(await confirmExpiredParentCleanup(parent, { env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      removeContainer: async () => false, inspectContainer: async () => unknown }))
      .toMatchObject({ status: 'unavailable' });
  });
  it('daemon不可达不能被当成容器不存在', async () => {
    await expect(confirmExpiredParentCleanup(parent, { env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
      removeContainer: async () => false, inspectContainer: async () => { throw new Error('docker_daemon_unavailable'); } }))
      .rejects.toThrow('docker_daemon_unavailable');
  });
  it('非目标host不调用本机docker也不退回worker假确认', async () => {
    const removeContainer = vi.fn(); const launcher = { cancel: vi.fn() };
    const receipt = await confirmExpiredParentCleanup(parent, { env: { CECELIA_MACHINE_ID: 'us-vps' }, launcher, removeContainer });
    expect(receipt).toMatchObject({ status: 'unsupported', reason: 'legacy_cleanup_wrong_host' });
    expect(removeContainer).not.toHaveBeenCalled(); expect(launcher.cancel).not.toHaveBeenCalled();
  });
  it('默认环境真正传入production transport并完成HTTP取消', async () => {
    const requests = [];
    const server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'cleaned', attempt_id: id }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      vi.stubEnv('KERNEL_FLEET_REMOTE_ENABLED', 'true');
      vi.stubEnv('KERNEL_FLEET_BRIDGE_TOKEN', 'unit-http-transport-secret-at-least-32-characters');
      vi.stubEnv('FLEET_WORKER_US_MAC_M4_URL', `http://127.0.0.1:${server.address().port}`);
      const receipt = await confirmExpiredParentCleanup({ ...parent, execution_transport: 'fleet-worker', local_container_naming: 'generation-v1' });
      expect(receipt).toMatchObject({ status: 'cleaned', attempt_id: id });
      expect(requests).toEqual([{ method: 'POST', url: `/harness/attempts/${id}/cancel` }]);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
