import { describe, it, expect } from 'vitest';
import { loadAgentRuns, runFeishuTaskLedger, GROUPS } from '../feishu-task-ledger.js';

describe('Mac Studio 执行事实', () => {
  it('远端只读、全部 runtime，保留 agent/time 边界；不再读 US sqlite', async () => {
    let command;
    const rows = [{ created_at: 1001, task_kind: 'exec', runtime: 'cli' }];
    const result = await loadAgentRuns({ agentId: 'zenithjoy-router', sinceMs: 1000,
      inContainer: false, execFn: async (cmd) => { command = cmd; return JSON.stringify(rows); } });
    expect(result).toEqual(rows);
    expect(command).toContain('ssh -o BatchMode=yes -o ConnectTimeout=20 mmv');
    expect(command).toContain('sqlite3 -readonly -json ~/.openclaw/state/openclaw.sqlite');
    expect(command).not.toContain('/opt/openclaw/state');
    const sql = Buffer.from(command.match(/echo ([A-Za-z0-9+/=]+) \|/)[1], 'base64').toString();
    expect(sql).toContain("agent_id='zenithjoy-router'");
    expect(sql).toContain('created_at > 1000');
    expect(sql).not.toContain("runtime='cron'");
  });
  it('确认空结果仍为空，非JSON/坏行/超时都拒绝且不泄露远端错误', async () => {
    const read = (execFn) => loadAgentRuns({ agentId: 'zenithjoy-router', sinceMs: 1000,
      inContainer: false, execFn });
    expect(await read(async () => '')).toEqual([]);
    expect(await read(async () => '[]')).toEqual([]);
    for (const raw of ['diagnostic []', '{}', '[{"runtime":"cli"}]']) {
      await expect(read(async () => raw)).rejects.toThrow('openclaw_evidence_unavailable');
    }
    await expect(read(async () => { throw Error('private token'); })).rejects.toThrow(/^openclaw_evidence_unavailable$/);
  });
  it('agent或时间越界不启动ssh', async () => {
    let calls = 0;
    for (const patch of [{ agentId: "a';DROP TABLE task_runs;--" }, { sinceMs: NaN }, { sinceMs: -1 }]) {
      await expect(loadAgentRuns({ agentId: 'a', sinceMs: 1, ...patch,
        execFn: async () => { calls++; return '[]'; } })).rejects.toThrow('invalid_evidence_query');
    }
    expect(calls).toBe(0);
  });
  it('读取失败标unknown不写任务，下一群仍消费异步执行证据', async () => {
    const writes = [];
    const out = await runFeishuTaskLedger({}, {
      env: { FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 'b' }, sinceSec: 1,
      fetchTokenFn: async () => 'token', fetchBotOpenIdFn: async () => 'bot',
      fetchMessagesFn: async ({ chatId }) => chatId === GROUPS[2].chatId ? [] : [
        { message_id: chatId, create_time: '10000', sender: { sender_type: 'user', id: 'human' },
          mentions: [{ id: { open_id: 'bot' } }], body: { content: '{"text":"请完成整理"}' } },
        { message_id: chatId + '-reply', create_time: '10010', sender: { sender_type: 'app' },
          body: { content: '{"text":"401 unauthorized 无法连接"}' } },
      ],
      loadAgentRunsFn: (() => { let n = 0; return async () => {
        if (++n === 1) throw Error('openclaw_evidence_unavailable'); return [];
      }; })(),
      createRoutedTaskFn: async (_pool, req) => { writes.push(req); return { task: { id: 'x' } }; },
    });
    expect(out.stats.unknown).toBe(1);
    expect(out.errors).toContain(GROUPS[0].chatId);
    expect(out.evidence_errors).toEqual([{ chat_id: GROUPS[0].chatId, reason: 'openclaw_evidence_unavailable' }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].source_id).toBe(GROUPS[1].chatId);
  });
});
