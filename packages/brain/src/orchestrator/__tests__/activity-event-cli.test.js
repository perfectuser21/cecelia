import { describe, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, copyFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../../../scripts/activity-contract-run.js', import.meta.url));
const fixture = new URL('./fixtures/activity-runtime/activity.mjs', import.meta.url);
async function invoke(args, input = {}, { symlinkEntry = false } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'activity-event-cli-'));
  try {
    await copyFile(fixture, join(cwd, 'activity.mjs'));
    const trace = join(cwd, 'trace');
    const receipt = trace + '.receipt';
    const envelope = { input: { run_tag: 'offline', trace, fragments: [], ...input },
      contract: { workflow: 'offline', activities: [{ key: 'finalize', order: 1,
        budget: { max_duration_s: 5, heartbeat_s: 1 },
        failure: { empty_ok: [], retryable: [], fatal: [], needs_human: { cases: [] } },
        runtime: { protocol: 'json-stdio-v1', phase: 'finalize', entry: 'activity.mjs', argv: ['finalize'] } }] } };
    let entry = cli;
    if (symlinkEntry) { entry = join(cwd, 'linked-cli.mjs'); await symlink(cli, entry); }
    const child = spawnSync(process.execPath, [entry, '--cwd', cwd, '--receipt', receipt, ...args],
      { input: JSON.stringify(envelope), encoding: 'utf8', timeout: 10000,
        env: { ...process.env, ACTIVITY_EVENT_DATABASE_URL: 'not-a-postgres-url' } });
    expect(child.stdout.trim(), 'CLI必须执行并输出终态，不能因symlink静默退出').not.toBe('');
    const result = JSON.parse(child.stdout);
    expect(child.stderr).toBe('');
    expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual(result);
    let actions = [];
    try { actions = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
    return { code: child.status, result, actions, stdout: child.stdout };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
describe('事件数据库CLI显式启用边界', () => {
  test('默认CLI忽略事件数据库环境且保留原回执', async () => {
    const r = await invoke([]);
    expect(r.code).toBe(0);
    expect(r.result.outputs.cleanup).toBe(true);
    expect(r.result.event_ledger).toBeUndefined();
  });
  test('真实symlink入口执行活动并保持终态stdout与原子回执一致', async () => {
    const r = await invoke([], {}, { symlinkEntry: true });
    expect(r.code).toBe(0);
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.cleanup).toBe(true);
    expect(r.actions.map(row => row.action)).toEqual(['finalize']);
  });
  test.each([['--brain-run-id', randomUUID()], ['--event-db'],
    ['--event-db', '--brain-run-id', randomUUID()]])('不完整绑定%s拒绝且无finalize副作用', async (...args) => {
    const r = await invoke(args);
    expect(r.code).toBe(1);
    expect(r.result.detail).toBe('event_db_binding_required');
    expect(r.actions).toEqual([]);
  });
  test('无效UUID在获取数据库连接前拒绝', async () => {
    const r = await invoke(['--event-db', '--brain-run-id', 'invalid', '--event-source-id', randomUUID()]);
    expect(r.result.detail).toBe('activity_run_id_invalid');
    expect(r.actions).toEqual([]);
  });
  test('凭据字符串run_tag拒绝时终态不泄露原字符串', async () => {
    const r = await invoke(['--event-db', '--brain-run-id', randomUUID(), '--event-source-id', randomUUID()],
      { run_tag: 'https://fixture:private-password@example.invalid' });
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain('private-password');
    expect(r.result.run_tag).toBeNull();
    expect(r.actions).toEqual([]);
  });
});
