import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  nativeExec: vi.fn(() => { throw new Error('unexpected native exec'); }),
  bark: vi.fn(() => { throw new Error('unexpected notification'); }),
}));
vi.mock('node:child_process', () => ({ execFile: boundary.nativeExec }));
vi.mock('../notifier.js', () => ({ sendBark: boundary.bark }));
vi.mock('../machine-registry.js', () => ({
  resolveMachineId: host => host === 'owned-worker' ? host : null,
  resolvePrimaryWorkerId: () => 'owned-gateway',
  sshTargetFor: () => 'owned-gateway',
}));
vi.mock('../workflow-run-lost-deadline.js', () => ({
  deriveRunTag: () => { throw new Error('unexpected tag fallback'); },
  workflowRunLabel: () => 'owned-run',
}));

import { MAX_ADOPT, runCommanderWatchdog } from '../commander-watchdog.js';

function arrange(listReply, { listError, adoptCount = 0 } = {}) {
  const commands = [];
  const writes = [];
  const events = [];
  const task = {
    id: 'owned-task-1', title: 'owned-run', task_type: 'workflow_run',
    payload: {
      tag: 'owned-tag', host: 'owned-worker', serial: 'owned-serial',
      profile: 'owned', escort_id: 'owned-old-id', commander_adopt_count: adoptCount,
    },
  };
  const pool = { query: vi.fn(async (sql, params) => {
    if (/FROM tasks[\s\S]*commander_heartbeat_at/.test(sql)) return { rows: [task] };
    if (/FROM working_memory/.test(sql)) return { rows: [] };
    if (/^UPDATE tasks/.test(sql)) {
      writes.push(JSON.parse(params[1]));
      return { rows: [{ id: task.id }], rowCount: 1 };
    }
    if (/INSERT INTO task_events/.test(sql)) {
      events.push({ type: params[1], payload: JSON.parse(params[2]) });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected record-only SQL: ${sql}`);
  }) };
  const execFileFn = vi.fn((command, args, options, callback) => {
    expect(command).toBe('ssh');
    const remote = args[args.length - 1];
    if (remote === 'openclaw cron list --json') {
      commands.push('list');
      return callback(listError ?? null, listReply, '');
    }
    if (remote === 'openclaw cron rm owned-old-id') {
      commands.push('rm');
      return callback(null, '', '');
    }
    if (remote.startsWith('openclaw cron add --timeout 90000')) {
      commands.push('add');
      return callback(null, '{"id":"owned-new-id"}', '');
    }
    throw new Error('unexpected remote command');
  });
  const run = () => runCommanderWatchdog(pool, {
    execFileFn, bark: boundary.bark, now: 1900000000000, gateMs: 0,
  });
  return { run, commands, writes, events };
}

describe('Commander cron list authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['transport failure', '', { listError: new Error('owned list failure') }],
    ['malformed JSON', '{not-json', {}],
    ['missing jobs', '{}', {}],
    ['non-array jobs', '{"jobs":null}', {}],
  ])('%s leaves the old escort intact and records failure', async (_name, reply, options) => {
    const fixture = arrange(reply, options);
    const result = await fixture.run();
    expect(result).toMatchObject({ scanned: 1, relaunched: 0, adopted: 0, failed: 1 });
    expect(fixture.commands).toEqual(['list']);
    expect(fixture.events).toEqual([{
      type: 'commander_relaunch_failed',
      payload: expect.objectContaining({ error: expect.stringMatching(/^cron_list_/), tag: 'owned-tag' }),
    }]);
    expect(fixture.writes).toEqual([{ commander_relaunched_at: new Date(1900000000000).toISOString() }]);
    expect(boundary.nativeExec).not.toHaveBeenCalled();
    expect(boundary.bark).not.toHaveBeenCalled();
  });

  it('an authoritative empty list still removes and replaces the absent escort', async () => {
    const fixture = arrange('{"jobs":[]}');
    expect(await fixture.run()).toMatchObject({ relaunched: 1, adopted: 0, failed: 0 });
    expect(fixture.commands).toEqual(['list', 'rm', 'add']);
    expect(fixture.writes[0]).toMatchObject({ escort_id: 'owned-new-id', commander_relaunch_count: 1 });
    expect(fixture.events[0].type).toBe('commander_relaunched');
    expect(boundary.nativeExec).not.toHaveBeenCalled();
    expect(boundary.bark).not.toHaveBeenCalled();
  });

  it('a matching live escort is adopted without removing or adding', async () => {
    const fixture = arrange('{"jobs":[{"name":"escort-owned-worker-owned-tag","id":"owned-existing-id"}]}');
    expect(await fixture.run()).toMatchObject({ relaunched: 0, adopted: 1, failed: 0 });
    expect(fixture.commands).toEqual(['list']);
    expect(fixture.writes[0]).toMatchObject({ escort_id: 'owned-existing-id', commander_adopt_count: 1 });
    expect(fixture.events[0].type).toBe('commander_adopted');
    expect(boundary.nativeExec).not.toHaveBeenCalled();
    expect(boundary.bark).not.toHaveBeenCalled();
  });

  it('MAX_ADOPT retains the existing deliberate replacement policy without a list request', async () => {
    const fixture = arrange('not used', { adoptCount: MAX_ADOPT });
    expect(await fixture.run()).toMatchObject({ relaunched: 1, adopted: 0, failed: 0 });
    expect(fixture.commands).toEqual(['rm', 'add']);
    expect(fixture.events[0].type).toBe('commander_relaunched');
    expect(boundary.nativeExec).not.toHaveBeenCalled();
    expect(boundary.bark).not.toHaveBeenCalled();
  });
});
