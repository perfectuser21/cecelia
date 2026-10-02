import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
let api = {}; try { api = require('./app-server-stream.cjs'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

describe('无正文日志的有界JSONL流', () => {
  it('分片与多帧原样转发，双向认证请求和token不落诊断', async () => {
    expect(api).toHaveProperty('createJsonlBoundary');
    const stream = api.createJsonlBoundary(), chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    const done = once(stream, 'end');
    stream.write(Buffer.from('{"id":1,"method":"account/login/'));
    stream.end(Buffer.from('start","params":{"token":"secret"}}\n{"id":2,"result":{}}\n'));
    await done;
    expect(Buffer.concat(chunks).toString()).toBe('{"id":1,"method":"account/login/start","params":{"token":"secret"}}\n{"id":2,"result":{}}\n');
  });
  it('过大帧报固定错误，错误不能含正文', async () => {
    expect(api).toHaveProperty('createJsonlBoundary');
    const stream = api.createJsonlBoundary({ maxFrameBytes: 32 });
    const error = once(stream, 'error'); stream.resume(); stream.write('secret'.repeat(10));
    expect((await error)[0].message).toBe('appserver_frame_too_large');
  });
  it('下游阻塞触发背压，不无限堆积聊天帧', () => {
    expect(api).toHaveProperty('createJsonlBoundary');
    const stream = api.createJsonlBoundary({ maxFrameBytes: 8192 });
    const blocked = new PassThrough({ highWaterMark: 16 }); stream.pipe(blocked);
    let accepted = true, frames = 0;
    while (accepted && frames < 1000) { accepted = stream.write('x'.repeat(8000) + '\n'); frames++; }
    expect(accepted).toBe(false); expect(frames).toBeLessThan(100); stream.destroy(); blocked.destroy();
  });
  it('连接末尾未完成帧不转发，报固定截断错误', async () => {
    expect(api).toHaveProperty('createJsonlBoundary');
    const stream = api.createJsonlBoundary(); const errors = once(stream, 'error'); stream.resume(); stream.end('{"token":"secret"');
    expect((await errors)[0].message).toBe('appserver_frame_truncated');
  });
});
it('单个大chunk含多帧时也服从readable背压，不把全部帧堆入输出队列',()=>{
 const stream=api.createJsonlBoundary({maxFrameBytes:1024});
 expect(stream.write(Buffer.from('x\n'.repeat(100000)))).toBe(false);
 expect(stream.readableLength).toBeLessThanOrEqual(65536+1024);
 stream.destroy();
});
