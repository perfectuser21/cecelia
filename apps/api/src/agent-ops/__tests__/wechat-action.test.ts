import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const script = resolve(process.cwd(), '../../scripts/agents/wechat_rpa.py');
const actions = ['send_message', 'click', 'screenshot', 'read_inbox'];
const originalPath = process.env.WECHAT_RPA_PY_PATH;
const originalDryrun = process.env.WECHAT_RPA_DRYRUN;
const originalPython = process.env.PYTHON_BIN;
const directory = mkdtempSync(join(tmpdir(), 'wechat-contract-'));

function runScript(action: string, dryrun = false) {
  return spawnSync('python3', [script], {
    input: JSON.stringify({ action_type: action, target: 'isolated-fixture', content: 'fixture' }),
    encoding: 'utf8', env: { ...process.env, WECHAT_RPA_DRYRUN: dryrun ? '1' : '0' },
  });
}

beforeAll(() => {
  process.env.WECHAT_RPA_PY_PATH = script;
  process.env.PYTHON_BIN = 'python3';
  delete process.env.WECHAT_RPA_DRYRUN;
});
afterAll(() => {
  for (const [key, value] of Object.entries({ WECHAT_RPA_PY_PATH: originalPath, WECHAT_RPA_DRYRUN: originalDryrun, PYTHON_BIN: originalPython })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

describe('真实脚本未实现动作合同', () => {
  it.each(actions)('%s 拒绝伪造业务结果', (action) => {
    const result = runScript(action);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: 'unsupported_action', action_type: action });
  });
  it('保留进程存活探测', () => {
    const result = runScript('health_check');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { alive: true } });
  });
  it.each(actions)('%s 的显式 dryrun 不宣称实际执行', (action) => {
    const result = runScript(action, true);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { dryrun: true } });
  });
});

describe('真实 HTTP → handler → Python', () => {
  async function app() {
    vi.resetModules();
    const { default: router } = await import('../wechat.js');
    return express().use(express.json()).use('/api/agent-ops/wechat', router);
  }
  it.each(actions)('%s 返回明确未实现错误', async (action_type) => {
    const response = await request(await app()).post('/api/agent-ops/wechat/action').send({ action_type, target: 'isolated-fixture' });
    expect(response.status).toBe(501);
    expect(response.body).toMatchObject({ error: 'rpa_action_unsupported' });
    expect(response.body.status).not.toBe('ok');
  });
  it('health 和 dryrun 仍然可用且语义明确', async () => {
    const server = await app();
    const health = await request(server).post('/api/agent-ops/wechat/action').send({ action_type: 'health_check' });
    expect(health.status).toBe(200);
    expect(health.body.result.payload).toMatchObject({ ok: true, data: { alive: true } });
    const dryrun = await request(server).post('/api/agent-ops/wechat/action').send({ action_type: 'send_message', dryrun: true });
    expect(dryrun.status).toBe(200);
    expect(dryrun.body.result).toMatchObject({ status: 'dryrun_receipt', dryrun: true });
  });
  it('脚本环境 dryrun 也只能返回演练回执', async () => {
    process.env.WECHAT_RPA_DRYRUN = '1';
    try {
      const response = await request(await app()).post('/api/agent-ops/wechat/action').send({ action_type: 'send_message', target: 'isolated-fixture' });
      expect(response.status).toBe(200);
      expect(response.body.result).toMatchObject({ dryrun: true, status: 'dryrun_receipt', payload: { data: { sent: false, dryrun: true } } });
    } finally { delete process.env.WECHAT_RPA_DRYRUN; }
  });
  it('exit 0 但业务失败不能包装为成功', async () => {
    const fakeScript = join(directory, 'failed.py');
    writeFileSync(fakeScript, 'import json,sys\njson.load(sys.stdin)\nprint(json.dumps({"ok":False,"error":"fixture_failure"}))\n');
    process.env.WECHAT_RPA_PY_PATH = fakeScript;
    try {
      const response = await request(await app()).post('/api/agent-ops/wechat/action').send({ action_type: 'health_check' });
      expect(response.status).toBe(500);
      expect(response.body.error).toBe('rpa_failed');
    } finally { process.env.WECHAT_RPA_PY_PATH = script; }
  });
});
