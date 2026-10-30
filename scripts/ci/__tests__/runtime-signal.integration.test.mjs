import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
import test from 'node:test';

const script = new URL('../basic-runtime-smoke.mjs', import.meta.url);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

for (const signal of ['SIGINT', 'SIGTERM']) test(`真实运行验收收到${signal}后非零结束、关闭本人Brain且清理交接目录`, {timeout: 30000}, async () => {
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script.pathname, '--cancel-probe'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let metadata, output = '', stderr = '', timer;
  const closed = new Promise(done => child.once('close', (code, signal) => done({code, signal})));
  try {
    const ready = new Promise((done, reject) => {
      timer = setTimeout(() => reject(new Error(`运行探针未就绪：${stderr}`)), 15000);
      child.once('error', reject);
      child.stdout.on('data', chunk => {
        output += chunk;
        const line = output.split('\n').find(value => value.startsWith('RUNTIME_CANCEL_PROBE '));
        if (!line) return;
        try { metadata = JSON.parse(line.slice('RUNTIME_CANCEL_PROBE '.length)); done(); } catch (error) { reject(error); }
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('close', () => { if (!metadata) reject(new Error(`运行探针提前关闭：${stderr}`)); });
    });
    await ready;
    clearTimeout(timer);
    assert.ok(Number.isInteger(metadata.pid) && metadata.pid > 1);
    assert.equal(dirname(metadata.artifacts), resolve(tmpdir()));
    assert.ok(basename(metadata.artifacts).startsWith('cecelia-ci-runtime-artifacts-'));
    assert.ok(alive(metadata.pid));
    child.kill(signal);
    const result = await Promise.race([closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('中断后运行验收未按时关闭')), 12000);
    })]);
    clearTimeout(timer);
    assert.notEqual(result.code, 0, stderr);
    for (let attempt = 0; attempt < 30 && alive(metadata.pid); attempt++) await sleep(100);
    assert.equal(alive(metadata.pid), false, '中断后本人Brain进程仍存活');
    assert.equal(existsSync(metadata.artifacts), false, '中断后本人交接目录仍残留');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    // RED复现时也只清理本探针明确记录的子进程与新建目录。
    if (metadata?.pid && alive(metadata.pid)) process.kill(metadata.pid, 'SIGTERM');
    if (metadata?.artifacts && dirname(metadata.artifacts) === resolve(tmpdir()) && basename(metadata.artifacts).startsWith('cecelia-ci-runtime-artifacts-')) {
      rmSync(metadata.artifacts, {recursive: true, force: true});
    }
  }
});
