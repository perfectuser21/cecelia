import {describe, it, expect, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';

const filename = new URL('../../scripts/cecelia-bridge.cjs', import.meta.url);
const realRequire = createRequire(filename);

function loadBridge() {
  let handler;
  const execute = vi.fn(() => { throw Error('unexpected external execution'); });
  const listen = vi.fn();
  runInNewContext(readFileSync(filename, 'utf8'), {
    require(specifier) {
      if (specifier === 'http') return {createServer:fn => { handler = fn; return {listen}; }};
      if (specifier === 'child_process') return {execFile:execute, spawn:execute};
      if (specifier === './lib/bridge-lifecycle.cjs') return realRequire(specifier);
      throw Error(`unexpected dependency: ${specifier}`);
    },
    process:{env:{}, on:vi.fn()}, console:{log:vi.fn(), error:vi.fn()},
  }, {filename:filename.pathname});
  return {handler, execute, listen};
}

function request(handler, method, url) {
  const req = {method, url, on:vi.fn()};
  const res = {writeHead:vi.fn(), end:vi.fn()};
  handler(req, res);
  return {req, status:res.writeHead.mock.calls[0]?.[0], body:JSON.parse(res.end.mock.calls[0][0])};
}

describe('当前Bridge退休边界，替代旧/llm-call超时公式副本', () => {
  it.each(['/llm-call', '/trigger-cecelia'])('%s固定410，不读取请求体或执行任何进程', path => {
    const {handler, execute} = loadBridge();
    const result = request(handler, 'POST', path);
    expect(result.status).toBe(410);
    expect(result.body).toEqual({ok:false, error:'claude_channel_retired'});
    expect(result.req.on).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it('保留的health真实分支仍200，未知端点404', () => {
    const {handler, execute} = loadBridge();
    expect(request(handler, 'GET', '/health')).toMatchObject({status:200, body:{ok:true,status:'healthy'}});
    expect(request(handler, 'POST', '/unknown')).toMatchObject({status:404, body:{ok:false}});
    expect(execute).not.toHaveBeenCalled();
  });
});
