import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { runOpenclawGuards } from '../openclaw-guards.js';
let now = 9000000000000;
const options = (extra = {}) => ({
  io: Object.fromEntries(['read','write','append','listDirs','exec'].map(k => [k, () => { throw Error('local forbidden'); }])),
  nowMs: now += 600000, env: { OPENCLAW_GUARD_MODE: 'remote' }, inContainer: false,
  ...extra,
});
describe('US 本地 OpenClaw 退役', () => {
  it('remote路径不执行本地控制与文件IO，触达日志通过Mac读取', async () => {
    const touches = []; let command;
    const io = Object.fromEntries(['read','write','append','listDirs','exec'].map(k => [k, () => {
      touches.push(k); throw Error('local forbidden');
    }]));
    const out = await runOpenclawGuards(null, options({ io, remoteExecFn: async cmd => {
      command = cmd; return '[now] 无待触达单';
    } }));
    expect(touches).toEqual([]);
    expect(out.local).toEqual({ status: 'retired', reason: 'gateway_moved_to_macstudio' });
    expect(out.outreach.verdict).toBe('idle');
    expect(command).toContain('ssh -o BatchMode=yes -o ConnectTimeout=20 mmv');
    expect(command).toContain('jinnuoshengyuan@100.86.57.69');
    expect(command).toContain('tail -12 ~/outreach.log');
    expect(command).not.toContain('/opt/openclaw');
  });
  it('空转仍按原规则告警一次，远端失败/空日志为unknown且不泄密', async () => {
    const raised = [];
    const stalled = await runOpenclawGuards(null, options({
      remoteExecFn: async () => Array(3).fill('[now] 话术缺失: NO_SCRIPT B').join('\n'),
      raiseFn: async (...args) => raised.push(args),
    }));
    expect(stalled.outreach.verdict).toBe('stalled');
    expect(raised).toHaveLength(1);
    expect(raised[0][1]).toBe('outreach_stalled');
    const bad = await runOpenclawGuards(null, options({ remoteExecFn: async () => { throw Error('secret'); } }));
    expect(bad.outreach).toEqual({ verdict: 'unknown', error: 'outreach_evidence_unavailable' });
    expect(await runOpenclawGuards(null, options({ remoteExecFn: async () => '' })))
      .toMatchObject({ outreach: { verdict: 'unknown' } });
  });
  it('错误mode必须拒绝，不能回到本地旧职责', async () => {
    await expect(runOpenclawGuards(null, options({ env: { OPENCLAW_GUARD_MODE: 'remtoe' } })))
      .rejects.toThrow('invalid_openclaw_guard_mode');
  });
  it('US compose明确采用remote，其他部署默认不改', () => {
    const source = readFileSync(new URL('../../../../docker-compose.us-vps.yml', import.meta.url), 'utf8');
    const config = yaml.load(source);
    expect(Object.values(config.services).some(s => s.environment?.includes('OPENCLAW_GUARD_MODE=remote'))).toBe(true);
  });
});
