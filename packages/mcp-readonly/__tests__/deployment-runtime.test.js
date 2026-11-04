import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { getDeploymentStatus, readBrainHealth } from '../src/tools/schema-and-deployment.js';
import { createApp } from '../server.js';
const exec = () => vi.fn(async cmd => ({ stdout: cmd.includes('rev-parse') ? 'checkout-sha\n' : 'cp-checkout\n' }));
const health = () => ({ git_sha: 'runtime-sha', version: '1.2.3', uptime_seconds: 17 });
describe('运行部署身份独立于宿主checkout与MCP进程年龄', () => {
  it('分别呈现checkout和Brain health，运行值来自真实依赖边界', async () => {
    const brainHealth = vi.fn().mockResolvedValue(health());
    const result = await getDeploymentStatus(exec(), { startedAt: Date.now() - 900000, brainHealth });
    expect(result.identity_source).toBe('checkout');
    expect(result.commit_sha).toBe('checkout-sha');
    expect(result.runtime).toEqual({ status: 'known', git_sha: 'runtime-sha', version: '1.2.3', uptime_seconds: 17 });
    expect(brainHealth).toHaveBeenCalledOnce();
  });
  it.each([async () => { throw new Error('private infrastructure error'); }, async () => ({})])('health失败或缺字段明确未知且不拿checkout补齐', async brainHealth => {
    const result = await getDeploymentStatus(exec(), { startedAt: 0, brainHealth });
    expect(result.runtime).toMatchObject({ status: 'unknown', git_sha: null, version: null, uptime_seconds: null });
    expect(JSON.stringify(result)).not.toContain('private infrastructure error');
  });
  it('真实MCP工具装配消费注入的Brain health，不能只修叶子函数', async () => {
    const brainHealth = vi.fn().mockResolvedValue(health());
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token', brainHealth, gitExec: exec() });
    const response = await request(app).post('/mcp').set('Authorization', 'Bearer test-token')
      .set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_deployment_status', arguments: {} } });
    expect(response.status).toBe(200);
    const rpc = JSON.parse(response.text.split('\n').find(l => l.startsWith('data: ')).slice(6));
    const payload = JSON.parse(rpc.result.content[0].text);
    expect(payload.runtime.git_sha).toBe('runtime-sha');
    expect(brainHealth).toHaveBeenCalledOnce();
  });
});

describe('Brain health固定只读HTTP边界', () => {
  it('仅GET固定健康端点并带3秒有界中止信号', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => health() });
    await expect(readBrainHealth(fetchFn)).resolves.toEqual(health());
    const [url, options] = fetchFn.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5221/api/brain/health');
    expect(options.method).toBe('GET');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });
  it('HTTP失败不解析或采用响应正文', async () => {
    const json = vi.fn();
    await expect(readBrainHealth(async () => ({ ok: false, json }))).rejects.toThrow('brain_health_unavailable');
    expect(json).not.toHaveBeenCalled();
  });
});
