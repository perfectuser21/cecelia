import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const DB_URL = process.env.DB_URL ?? 'postgresql://localhost/cecelia';
const RUN = `reaper-${Date.now()}-${process.pid}`;
let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
});

afterAll(async () => {
  if (client) {
    const tables = await client.query<{ sessions: string | null }>(
      `SELECT to_regclass('codex_slot_sessions')::text AS sessions`,
    );
    if (tables.rows[0].sessions) {
      await client.query('DELETE FROM codex_slot_sessions WHERE actor_id LIKE $1', [`${RUN}%`]);
      await client.query('DELETE FROM codex_account_leases WHERE actor_id LIKE $1', [`${RUN}%`]);
      await client.query('DELETE FROM codex_company_accounts WHERE account_key LIKE $1', [
        `${RUN}%`,
      ]);
    }
    await client.end();
  }
});

describe('Codex Slot rollout、旧入口与 reaper 真接缝 [BEHAVIOR]', () => {
  it('rollout 在 inventory_complete 与旧入口禁写证据前拒绝 broker_only', async () => {
    const { transitionRollout } = await import(
      '../../../packages/brain/src/codex-slot/rollout.js'
    );
    await expect(
      transitionRollout(client, {
        from: 'frozen',
        to: 'broker_only',
        inventory_complete: false,
        legacy_write_probe_passed: false,
      }),
    ).rejects.toThrow(/inventory|legacy|rollout/i);
  });

  it('旧 codex-request 入口硬失败且不创建 auth.json', async () => {
    const home = `/tmp/${RUN}-legacy-home`;
    try {
      await execFileAsync('mkdir', ['-p', home]);
      // --help 在当前旧入口会 exit 0，因而 Red；硬切后连帮助入口也必须返回
      // broker-only 指引并非零退出。选择 --help 可证明真实脚本行为，又不会触发
      // 任何 SSH/scp/token 路径。
      const result = await execFileAsync('bash', ['scripts/codex-request.sh', '--help'], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home },
      }).then(
        () => ({ code: 0 }),
        (error: { code?: number }) => ({ code: error.code ?? 1 }),
      );
      expect(result.code).not.toBe(0);
      const probe = await execFileAsync('bash', [
        '-c',
        `if [ -e "$1/.codex-team1/auth.json" ]; then exit 9; fi`,
        'probe',
        home,
      ]);
      expect(probe.stderr).toBe('');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('reaper 两轮真实时间流逝不重置状态，unknown 保持 quarantine', async () => {
    const { runCodexSlotReaper } = await import(
      '../../../packages/brain/src/codex-slot/reaper.js'
    );
    const { CodexSlotRegistry } = await import(
      '../../../packages/brain/src/codex-slot/registry.js'
    );
    await client.query(
      `INSERT INTO codex_company_accounts(account_key, enabled) VALUES ($1, true)`,
      [`${RUN}-account`],
    );
    const registry = new CodexSlotRegistry(client);
    const acquired = await registry.acquire({
      actor_id: `${RUN}-actor`,
      agent_id: 'xian-m4',
      slot: 1,
      idempotency_key: `${RUN}-lease`,
    });
    await registry.recordUnknownResult(acquired.session_handle, {
      phase: 'status',
      sanitized_reason: 'agent_unreachable',
    });

    await runCodexSlotReaper(client);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await runCodexSlotReaper(client);

    const row = await client.query(
      `SELECT state FROM codex_account_leases WHERE session_handle=$1`,
      [acquired.session_handle],
    );
    expect(row.rows[0].state).toBe('quarantined');
  });

  it('scheduler JOBS 真实接线 codex-slot-reaper 且周期为 60 秒', async () => {
    const { JOBS } = await import('../../../packages/brain/src/scheduler-jobs.js');
    const job = JOBS.find((entry: { name: string }) => entry.name === 'codex-slot-reaper');
    expect(job).toBeDefined();
    expect(job.intervalMs).toBe(60_000);
  });
});
