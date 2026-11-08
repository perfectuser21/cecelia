import {test, expect, vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createCommanderBridge} from '../runner-commander-bridge.js';
import {createCommanderTransport, createOpenClawCommanderTransport} from '../runner-commander-transport.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

test('旧Gateway响应迟到不得清除重新接回后新回合的pending占位', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-race-'));
  const old = deferred(), fresh = deferred();
  const requests = [];
  const success = request => ({stdout: JSON.stringify({runId: request.idempotencyKey, status: 'ok', payloads: [{text: '{"action":"none"}'}]})});
  try {
    await fs.writeFile(path.join(cwd, 'skill.md'), '只监督，不执行外部动作');
    const transport = createOpenClawCommanderTransport({cwd,
      profile: {timeout_s: 1, skill: {entry: 'skill.md', version: '1'}},
      files: {'skill.md': hash('只监督，不执行外部动作')},
      execute: async (_command, args) => {
        const params = JSON.parse(args[args.indexOf('--params') + 1]);
        if (args.includes('agent.wait')) return {stdout: JSON.stringify({runId: params.runId, status: 'ok', endedAt: 1})};
        requests.push(params);
        return requests.length === 1 ? old.promise : fresh.promise;
      },
    });
    const oldTurn = transport({run_id: 'same-run', phase: 'event'});
    expect(await transport.reconcile({run_id: 'same-run'})).toEqual({execution_stopped: true});
    const freshTurn = transport({run_id: 'same-run', phase: 'event'});
    expect(requests).toHaveLength(2);
    old.resolve(success(requests[0]));
    await oldTurn;
    await expect(transport({run_id: 'same-run', phase: 'event'})).rejects.toThrow('commander_previous_turn_unknown');
    expect(requests).toHaveLength(2);
    fresh.resolve(success(requests[1]));
    expect(await freshTurn).toEqual({action: 'none'});
  } finally {
    old.resolve({stdout: '{}'}); fresh.resolve({stdout: '{}'});
    await fs.rm(cwd, {recursive: true, force: true});
  }
});

test('桥接超时后不重发仍活本地进程，迟到close确证后同run重新接回', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-late-close-'));
  const trace = path.join(cwd, 'trace');
  const code = `import fs from 'node:fs';
import {setTimeout} from 'node:timers/promises';
let s='';for await(const c of process.stdin)s+=c;const request=JSON.parse(s);
const trace=${JSON.stringify(trace)};fs.appendFileSync(trace,request.run_id+'\\n');
if(fs.readFileSync(trace,'utf8').trim().split('\\n').length===1)await setTimeout(800);
console.log(JSON.stringify({action:'answer',text:'接回原运行'}));`;
  const events = [];
  try {
    await fs.writeFile(path.join(cwd, 'commander.mjs'), code);
    await fs.writeFile(path.join(cwd, 'skill.md'), '观察原运行');
    const transport = createCommanderTransport({cwd,
      profile: {entry: 'commander.mjs', timeout_s: 2, skill: {entry: 'skill.md', version: '1'}},
      files: {'commander.mjs': hash(code), 'skill.md': hash('观察原运行')},
    });
    const commander = createCommanderBridge({run_id: 'same-run', transport,
      budget: {timeout_ms: 250}, onEvent: async event => {events.push(event);}});
    await commander.wake();
    expect(commander.status).toBe('unavailable');
    expect(await commander.notify('activity', {type: 'heartbeat'}, {executor_kind: 'agent'})).toEqual({action: 'none'});
    expect((await fs.readFile(trace, 'utf8')).trim().split('\n')).toEqual(['same-run']);
    await vi.waitFor(async () => {expect(await transport.reconcile({run_id: 'same-run'})).toEqual({execution_stopped: true});}, {timeout: 3000, interval: 25});
    expect(await commander.notify('activity', {type: 'question'}, {executor_kind: 'agent'})).toEqual({action: 'answer', text: '接回原运行'});
    expect(commander.status).toBe('available');
    expect((await fs.readFile(trace, 'utf8')).trim().split('\n')).toEqual(['same-run', 'same-run']);
    expect(events.some(event => event.event_type === 'COMMANDER_RECONNECTED')).toBe(true);
  } finally {await fs.rm(cwd, {recursive: true, force: true});}
});
