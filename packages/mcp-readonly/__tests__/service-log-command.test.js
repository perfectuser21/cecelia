import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('node:child_process', () => {
  const execFile = () => { throw new Error('only promisified command is expected'); };
  execFile[Symbol.for('nodejs.util.promisify.custom')] = (...args) => command(...args);
  return { execFile };
});
import { createApp } from '../server.js';

function rpc(text) {
  return JSON.parse(text.split('\n').find(line => line.startsWith('data: ')).slice(6));
}
async function callLogs() {
  const response = await request(createApp({ skipDbInit: true, bearerToken: 'log-test' }))
    .post('/mcp').set('Authorization', 'Bearer log-test')
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_service_logs', arguments: { service: 'cecelia-brain', lines: 5 } } });
  expect(response.status).toBe(200);
  expect(command).toHaveBeenCalledWith('docker', ['logs', '--tail', '5', 'cecelia-node-brain']);
  return rpc(response.text).result;
}
beforeEach(() => command.mockReset());
describe('Docker日志命令退出状态', () => {
  it('非零退出携带stderr时MCP返回错误，不包装成功lines', async () => {
    command.mockRejectedValue(Object.assign(new Error('docker log command failed'), { code: 1, stdout: '', stderr: 'No such container\n' }));
    const result = await callLogs();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('"lines"');
  });
  it('零退出的stderr仍是服务日志，与stdout合并并脱敏', async () => {
    command.mockResolvedValue({ stdout: 'normal log\n', stderr: 'stderr log\n' });
    const result = await callLogs();
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ lines: ['normal log', 'stderr log'] });
  });
});
