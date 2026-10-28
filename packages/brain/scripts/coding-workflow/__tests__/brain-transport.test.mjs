import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { startTestBrain } from './helpers/brain-transport.mjs';

const originalMode = process.env.CODING_WF_TEST_TRANSPORT;
const resources = [];
afterEach(async () => {
  for (const brain of resources.splice(0)) await brain.close();
  if (originalMode === undefined) delete process.env.CODING_WF_TEST_TRANSPORT;
  else process.env.CODING_WF_TEST_TRANSPORT = originalMode;
});
async function brainFor(mode, handler) {
  process.env.CODING_WF_TEST_TRANSPORT = mode;
  const brain = await startTestBrain(handler);
  resources.push(brain);
  return brain;
}
function run(brain, code, onChild = () => {}) {
  const options = brain.spawnOptions();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...options.args, '--input-type=module', '-e', code], { stdio: options.stdio });
    options.attach(child);
    child.stdin.end();
    onChild(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    // Node 的显式 IPC disconnect 可不触发 ChildProcess close；等待真实退出及两条输出管道结束。
    Promise.all([
      new Promise((done) => child.once('exit', done)),
      new Promise((done) => child.stdout.once('end', done)),
      new Promise((done) => child.stderr.once('end', done)),
    ]).then(([exitCode]) => resolve({ exitCode, stdout, stderr }));
  });
}

// 显式 IPC 验证不声称测过 TCP；默认命令同时执行 HTTP 与 IPC。
const modes = originalMode === 'ipc' ? ['ipc'] : ['http', 'ipc'];
describe.each(modes)('测试 Brain %s 传输', (mode) => {
  it('真实子进程保留方法、路径、UTF8正文、header、状态码和响应体', async () => {
    const seen = [];
    const brain = await brainFor(mode, (request) => {
      seen.push(request);
      return { status: 409, headers: { 'x-reply': 'yes' }, body: '冲突' };
    });
    const result = await run(brain, `const r=await fetch(${JSON.stringify(brain.url + '/api/tasks?q=1')},{method:'POST',headers:{'x-test':'one'},body:'中文'});console.log(JSON.stringify([r.status,r.ok,r.headers.get('x-reply'),await r.text()]));`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([409, false, 'yes', '冲突']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/tasks?q=1', body: '中文', headers: { 'x-test': 'one' } });
  });
  it('并发乱序响应按请求身份匹配，204为空正文', async () => {
    const brain = await brainFor(mode, async ({ url }) => {
      if (url === '/slow') await new Promise((r) => setTimeout(r, 30));
      return url === '/empty' ? { status: 204, body: '' } : { status: 200, body: url };
    });
    const result = await run(brain, `console.log(JSON.stringify(await Promise.all(['/slow','/fast','/empty'].map(async p=>{const r=await fetch(${JSON.stringify(brain.url)}+p);return [r.status,await r.text()]}))));`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([[200, '/slow'], [200, '/fast'], [204, '']]);
  });
  it('未知路径由fixture明确拒绝，不伪造成功', async () => {
    const brain = await brainFor(mode, () => ({ status: 404, body: 'unknown route' }));
    const result = await run(brain, `const r=await fetch(${JSON.stringify(brain.url + '/unknown')});console.log(JSON.stringify([r.status,await r.text()]));`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([404, 'unknown route']);
  });
  it('HEAD 不暴露响应正文', async () => {
    const brain = await brainFor(mode, () => ({ status: 200, body: 'not a HEAD body' }));
    const result = await run(brain, `const r=await fetch(${JSON.stringify(brain.url)},{method:'HEAD'});console.log(JSON.stringify([r.status,await r.text()]));`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([200, '']);
  });
  it('AbortSignal取消，不等待迟到响应才结束', async () => {
    const brain = await brainFor(mode, () => new Promise(() => {}));
    const result = await run(brain, `try{await fetch(${JSON.stringify(brain.url + '/pending')},{signal:AbortSignal.timeout(40)})}catch(e){console.log(e.name)}`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('TimeoutError');
  });
});

describe('IPC fixture 隔离与退出', () => {
  it('已取消请求及超大正文不调用handler', async () => {
    let hits = 0;
    const brain = await brainFor('ipc', () => { hits += 1; return { status: 200, body: '' }; });
    const result = await run(brain, `const errors=[];for(const init of [{signal:AbortSignal.abort()},{method:'POST',body:'x'.repeat(1024*1024+1)}]){try{await fetch(${JSON.stringify(brain.url)},init)}catch(e){errors.push(e.message)}}console.log(JSON.stringify(errors));`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)[1]).toBe('test_brain_body_too_large');
    expect(hits).toBe(0);
  });
  it('非HTTP标准方法由IPC父端拒绝', async () => {
    let hits = 0;
    const brain = await brainFor('ipc', () => { hits += 1; return { status: 200, body: '' }; });
    const result = await run(brain, `try{await fetch(${JSON.stringify(brain.url)},{method:'CUSTOM'})}catch(e){console.log(e.message)}`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('test_brain_method_denied');
    expect(hits).toBe(0);
  });
  it('未知origin不调用父handler，也不回退到真实fetch', async () => {
    let hits = 0;
    const brain = await brainFor('ipc', () => { hits += 1; return { status: 200, body: 'bad' }; });
    const result = await run(brain, `try{await fetch('http://127.0.0.1:5221/api/brain/health')}catch(e){console.log(e.message)}`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('test_brain_origin_denied');
    expect(hits).toBe(0);
  });
  it('断开IPC令等待请求失败，子进程能退出', async () => {
    let child;
    const brain = await brainFor('ipc', () => { child.disconnect(); return new Promise(() => {}); });
    const result = await run(brain, `try{await fetch(${JSON.stringify(brain.url)})}catch(e){console.log(e.message)}`, (c) => { child = c; });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('test_brain_disconnected');
  });
  it('handler异常使fetch拒绝，不返回伪造HTTP 200', async () => {
    const brain = await brainFor('ipc', () => { throw new Error('fixture_network_failure'); });
    const result = await run(brain, `try{await fetch(${JSON.stringify(brain.url)})}catch(e){console.log(e.message)}`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('fixture_network_failure');
  });
  it('无效传输名称明确失败，不自动选其他模式', async () => {
    process.env.CODING_WF_TEST_TRANSPORT = 'automatic';
    await expect(startTestBrain(() => ({}))).rejects.toThrow('test_brain_transport_invalid');
  });
});
