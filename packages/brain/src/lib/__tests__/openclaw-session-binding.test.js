import { describe, it, expect, vi } from 'vitest';
import { bindOpenclawSession, sessionBindingCommand } from '../openclaw-session-binding.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRemoteCommand } from '../../openclaw-agent-executor.js';

const options = { binPath: '/opt/homebrew/bin/openclaw', key: 'agent:skill-factory:r1', agentId: 'skill-factory', model: 'openai/gpt-6.1-sol', profileId: 'openai-plus3' };
const response = (o = options) => ({ ok: true, key: o.key, entry: { sessionId: 'session-1', authProfileOverride: o.profileId, authProfileOverrideSource: 'user', providerOverride: 'openai', modelOverride: 'gpt-6.1-sol' } });

describe('OpenClaw 会话绑定', () => {
  it('两个会话分别固定账号，不修改共享认证顺序', () => {
    const run = vi.fn((bin, args) => {
      const p = JSON.parse(args[args.indexOf('--params') + 1]);
      const o = { ...options, key: p.key, profileId: p.model.slice(p.model.indexOf('@') + 1) };
      return JSON.stringify(response(o));
    });
    expect(bindOpenclawSession(options, run).profileId).toBe('openai-plus3');
    expect(bindOpenclawSession({ ...options, key: 'agent:skill-factory:r2', profileId: 'openai:other@example.com' }, run).profileId).toBe('openai:other@example.com');
    expect(run.mock.calls.every(([, args]) => args[2] === 'sessions.patch')).toBe(true);
  });

  it.each([
    { ok: false },
    { entry: { ...response().entry, authProfileOverride: 'other' } },
    { entry: { ...response().entry, authProfileOverrideSource: 'auto' } },
    { entry: { ...response().entry, modelOverride: 'gpt-5.6-terra' } },
  ])('绑定失败或读回不一致拒绝运行 %j', (patch) => {
    expect(() => bindOpenclawSession(options, () => JSON.stringify({ ...response(), ...patch }))).toThrow('openclaw_session_binding_mismatch');
  });

  it('生成的绑定脚本在真实 shell 可执行，账号字符串不进入 shell 插值', () => {
    expect(sessionBindingCommand(options)).not.toContain(options.profileId);
  });

  it.each([true, false])('真实 shell：绑定成功=%s 决定是否启动 agent', async (success) => {
    const home = mkdtempSync(join(tmpdir(), 'qiumi-binding-'));
    const bin = join(home, 'fake-claw');
    mkdirSync(join(home, 'brain-runs'));
    writeFileSync(bin, `#!/usr/bin/env node\nconst fs=require('fs');if(process.argv[2]==='gateway'){console.log(${JSON.stringify(JSON.stringify(success ? response() : { ok: false }))});}else{fs.writeFileSync(process.env.HOME+'/started',JSON.stringify(process.argv));console.log('OK');}\n`, { mode: 0o755 });
    try {
      const command = buildRemoteCommand({ runId: 'r1', department: 'skill-factory', model: options.model, profileId: options.profileId, taskId: 't1', binPath: bin });
      const launched = spawnSync('sh', ['-c', command], { input: '业务正文', env: { ...process.env, HOME: home }, encoding: 'utf8' });
      expect(launched.status).toBe(0);
      for (let i = 0; i < 100 && !existsSync(join(home, 'brain-runs/r1.exit')); i++) await new Promise(r => setTimeout(r, 20));
      expect(readFileSync(join(home, 'brain-runs/r1.exit'), 'utf8').trim(), readFileSync(join(home, 'brain-runs/r1.log'), 'utf8')).toBe(success ? '0' : '1');
      expect(existsSync(join(home, 'started'))).toBe(success);
      if (success) {
        expect(JSON.parse(readFileSync(join(home, 'brain-runs/r1.binding.json'), 'utf8')).profileId).toBe(options.profileId);
        const args = JSON.parse(readFileSync(join(home, 'started'), 'utf8'));
        expect(args).toContain('业务正文');
        expect(args).not.toContain('--model');
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
