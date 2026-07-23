import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let fixtureRoot: string | null = null;

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
});

describe('Codex Slot 受控身份与自动路由 [BEHAVIOR]', () => {
  it('受控 SSH key 映射 actor 且忽略客户端 actor/host 自报', async () => {
    const { loadRootConfig, resolveActor } = await import(
      '../../../packages/brain/src/codex-slot/identity.js'
    );
    fixtureRoot = await mkdtemp(join(tmpdir(), 'codex-slot-identity-'));
    const configPath = join(fixtureRoot, 'root-config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        actors: { 'SHA256:key-air': 'actor-air' },
        agents: {
          'xian-m1': { host: 'xian-m1', max_slots: 1 },
          'xian-m4': { host: 'xian-m4', max_slots: 2 },
        },
      }),
      { mode: 0o600 },
    );

    const config = await loadRootConfig(configPath);
    const actor = resolveActor(config, {
      uid: null,
      sshKeyFingerprint: 'SHA256:key-air',
      claimedActor: 'admin',
      claimedHost: 'evil-host',
      envActor: 'root',
    });
    expect(actor).toEqual({ actor_id: 'actor-air', source: 'ssh_key' });
  });

  it('无 UID/SSH key 映射时 fail closed', async () => {
    const { resolveActor } = await import('../../../packages/brain/src/codex-slot/identity.js');
    expect(() =>
      resolveActor(
        { actors: {}, agents: {} },
        {
          uid: null,
          sshKeyFingerprint: 'SHA256:unknown',
          claimedActor: 'admin',
          claimedHost: 'xian-m4',
          envActor: 'root',
        },
      ),
    ).toThrow(/identity|actor|映射/i);
  });

  it('自动选择仅接纳身份、mmv、容量与新鲜度全部有效的 agent slot', async () => {
    const { selectAgentSlot } = await import('../../../packages/brain/src/codex-slot/selector.js');
    const now = Date.now();
    const selected = selectAgentSlot(
      [
        {
          agent_id: 'xian-m1',
          host_verified: true,
          mmv_verified: true,
          capacity: { max_slots: 1, used_slots: 1, sampled_at_ms: now },
        },
        {
          agent_id: 'xian-m4',
          host_verified: true,
          mmv_verified: true,
          capacity: { max_slots: 2, used_slots: 1, sampled_at_ms: now },
        },
        {
          agent_id: 'client-claimed-host',
          host_verified: false,
          mmv_verified: true,
          capacity: { max_slots: 99, used_slots: 0, sampled_at_ms: now },
        },
      ],
      { nowMs: now, freshnessMs: 30_000 },
    );
    expect(selected).toEqual({ agent_id: 'xian-m4', slot: 2 });
  });

  it('容量缺失、零容量或过期时不选择任何 agent', async () => {
    const { selectAgentSlot } = await import('../../../packages/brain/src/codex-slot/selector.js');
    const now = Date.now();
    expect(() =>
      selectAgentSlot(
        [
          {
            agent_id: 'xian-m1',
            host_verified: true,
            mmv_verified: true,
            capacity: null,
          },
          {
            agent_id: 'xian-m4',
            host_verified: true,
            mmv_verified: true,
            capacity: { max_slots: 0, used_slots: 0, sampled_at_ms: now - 60_000 },
          },
        ],
        { nowMs: now, freshnessMs: 30_000 },
      ),
    ).toThrow(/capacity|slot|容量/i);
  });
});
