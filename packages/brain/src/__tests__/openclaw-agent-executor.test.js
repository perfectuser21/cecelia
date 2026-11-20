/** 仅保留旧inflight收割、回执真实性与失败收尾；退役启动功能的测试随功能删除。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ssh-args.js', () => ({
  SSH_BASE_ARGS: Object.freeze([
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no',
    '-o', 'SentinelBaseArgs=yes',
  ]),
}));
vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
// 目标机必须是 sshTargetFor(resolvePrimaryWorkerId())：mock 只认 'fake-primary'，
// 实现里若写死 'us-mac-m4' 之类字面量，拿到的就是 WRONG:… 目标 → 断言红。
vi.mock('../machine-registry.js', () => ({
  resolvePrimaryWorkerId: vi.fn(() => 'fake-primary'),
  sshTargetFor: vi.fn((id) => (id === 'fake-primary' ? 'administrator@10.0.0.9' : `WRONG:${String(id)}`)),
}));
import { recordTaskEventSafe } from '../lib/task-event-log.js';

import { buildQiumiSource } from '../lib/qiumi-source.js';
import { reapOpenclawAgentRuns } from '../openclaw-agent-executor.js';

const task = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  task_type: 'qiumi_task',
  status: 'in_progress',
  payload: {
    run_id: 'qiumi-aaaaaaaa-1',
    model: 'claude-cli/claude-sonnet-5',
    qiumi_department: 'dev',
    qiumi_source: buildQiumiSource({ title: '标题', remark: '备', body: 'token: SECRET 正文' }),
  },
};

/** 假 ssh 子进程：stdin.end 记录写进去的正文，__emit 触发一轮 stdout→close。 */

beforeEach(() => vi.clearAllMocks());

describe('reapOpenclawAgentRuns', () => {
  const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };
  it.each([
    [JSON.stringify({ stage: 'explore', claimed_result: 'success', lock_released: true, run_id: row.run_id }), 1, 0],
    ['没有读取成功', 0, 1],
    [JSON.stringify({ stage: 'verify', claimed_result: 'success' }), 0, 1],
  ])('显式探路只接受同运行号且释放锁的完整回执：%s', async (text, completed, failed) => {
    const factoryRow = { ...row, payload: { qiumi_department: 'skill-factory', qiumi_source: { body: '使用 skill：skill-explore' } } };
    const query = vi.fn().mockResolvedValueOnce({ rows: [factoryRow] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${JSON.stringify({ finalAssistantVisibleText: text })}\n`, ''));
    expect(await reapOpenclawAgentRuns({ query }, { execFileFn })).toMatchObject({ completed, failed });
  });
  it.each([
    ['blocked', true, 'qiumi-aaaaaaaa-1', '微信未登录'],
    ['failed', true, 'qiumi-aaaaaaaa-1', '截图失败'],
    ['success', false, 'qiumi-aaaaaaaa-1', null],
    ['success', true, 'wrong-run', null],
  ])('探路进程退出0也不能把失败/未解锁/错运行号记完成：%s', async (claimed_result, lock_released, run_id, fail_reason) => {
    const factoryRow = { ...row, payload: { qiumi_department: 'skill-factory' } };
    const report = JSON.stringify({ stage: 'explore', claimed_result, lock_released, run_id, fail_reason });
    const query = vi.fn().mockResolvedValueOnce({ rows: [factoryRow] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${JSON.stringify({ finalAssistantVisibleText: report })}\n`, ''));
    expect(await reapOpenclawAgentRuns({ query }, { execFileFn })).toMatchObject({ completed: 0, failed: 1 });
    const update = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(update[1][1]).toMatch(/rpa_/);
    if (fail_reason) expect(update[1][1]).toContain(fail_reason);
  });

  it.each([
    ['blocked', 'failed', 0, 1],
    ['success', 'completed', 1, 0],
  ])('秋米 trial 回执 claimed_result=%s，退出码 0 → %s（任务 c244dd02）', async (claimed_result, _label, completed, failed) => {
    const factoryRow = { ...row, payload: { qiumi_department: 'skill-factory' } };
    const report = JSON.stringify({ stage: 'trial', claimed_result, fail_reason: '抖音登录态失效' });
    const query = vi.fn().mockResolvedValueOnce({ rows: [factoryRow] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${JSON.stringify({ finalAssistantVisibleText: report })}\n`, ''));
    expect(await reapOpenclawAgentRuns({ query }, { execFileFn })).toMatchObject({ completed, failed });
    const failedUpd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    const doneUpd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    if (failed) {
      expect(failedUpd[1][1]).toContain('agent_receipt_blocked');
      expect(failedUpd[1][1]).toContain('抖音登录态失效');
      expect(doneUpd).toBeUndefined();
    } else {
      expect(doneUpd).toBeDefined();
      expect(failedUpd).toBeUndefined();
    }
  });

  it('EXIT=0 → completed_no_pr + receipt 子键（finalAssistantVisibleText）', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{"finalAssistantVisibleText":"done ✓"}\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 1, completed: 1, failed: 0, requeued: 0 });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    // 终态经 lib/task-terminal.js 收口：receipt 作 result jsonb 合并参数（$2），CAS 字面量 in_progress
    expect(upd[0]).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\| \$2::jsonb/);
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
    expect(JSON.parse(upd[1][1]).receipt).toMatchObject({ exit: 0, text: 'done ✓' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      expect.anything(), task.id, 'openclaw_agent_reaped', expect.objectContaining({ run_id: row.run_id, exit: 0 }),
    );
  });

  it('--json 多行输出：从末尾往上找第一行能解析的 JSON，不被带大括号的正文骗走', async () => {
    const log = [
      'thinking… { 这行有大括号但不是 JSON }',
      '{"type":"progress","note":"{嵌套}"} 后面还跟了别的字所以整行不是合法 JSON',
      '{"finalAssistantVisibleText":"最终结论"}',
    ].join('\n');
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${log}\n`, ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    expect(JSON.parse(upd[1][1]).receipt.text).toBe('最终结论');
  });

  it('EXIT=1 → failed + error_message=openclaw_agent_exit_1', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=1\nboom\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r.failed).toBe(1);
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[1][1]).toBe('openclaw_agent_exit_1');
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
  });

  it('NO_EXIT → 不动（交给合同 stale 45min）', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'NO_EXIT\n', ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 0, completed: 0, failed: 0, requeued: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('取数带 LIMIT 10 + 老任务优先，单条 ssh 15s——整轮必须压在 job 的 300s 超时内', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{}\n', ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/executor_kind = 'openclaw-agent'/);
    expect(sql).toMatch(/status = 'in_progress'/);
    expect(sql).toMatch(/ORDER BY started_at ASC NULLS FIRST/);
    expect(sql).toMatch(/LIMIT 10/);
    expect(execFileFn.mock.calls[0][2].timeout).toBeLessThanOrEqual(15_000);
    expect(execFileFn.mock.calls[0][1]).toContain('administrator@10.0.0.9');
  });

  it('run_id 非法（含路径穿越）→ 跳过，不发 ssh', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: task.id, run_id: 'r;rm -rf ~' }, { id: task.id, run_id: '../../.ssh/x' }] });
    const execFileFn = vi.fn();
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(r).toEqual({ reaped: 0, completed: 0, failed: 0, requeued: 0 });
    expect(execFileFn).not.toHaveBeenCalled();
  });
});

describe('每次运行一个新会话 + 回执解析（任务 7951bd36）', () => {

  it('回执：真实 --json 是多行缩进 JSON，且尾巴从对象中间截断 → 仍能取出 finalAssistantVisibleText', async () => {
    const tail = [
      '          "schemaChars": 360',
      '        }',
      '      },',
      '      "finalAssistantVisibleText": "{\\"phone\\":\\"小龙虾\\",\\"ok\\":true}",',
      '      "stopReason": "stop"',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=0\n${tail}\n`, ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    const upd = query.mock.calls.find(([sql]) => /completed_no_pr/.test(sql));
    expect(JSON.parse(upd[1][1]).receipt.text).toBe('{"phone":"小龙虾","ok":true}');
  });

  it('收割读日志尾巴放大到 20000 字节（4000 常截在最终回答之前）', async () => {
    const row = { id: task.id, run_id: 'qiumi-aaaaaaaa-1' };
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, 'EXIT=0\n{"finalAssistantVisibleText":"x"}\n', ''));
    await reapOpenclawAgentRuns({ query }, { execFileFn });
    expect(execFileFn.mock.calls[0][1].join(' ')).toContain('tail -c 20000');
  });
});

// 0929 23:52 生产实证（任务 55c2e84b）：Brain 已按执行参数起 `--agent media --model openai/gpt-6-sol`，
// 但 prompt 原样带着「执行参数：/执行Agent：media/模型：sol」块，agent 当成"要再派 media/sol 去做"，
// sessions_spawn 开子会话后 sessions_yield；Brain 收到 exit 0 + result.payloads=[] 判成完成，
// 真机操作在追踪外跑完。两刀：prompt 顶部声明参数已应用并去掉参数块；收割器不把 yield 判完成。

describe('收割器：agent 以 yield 收尾、没有最终结果 → 不判完成（任务 e3c81cce）', () => {
  const row = { id: task.id, run_id: 'qiumi-55c2e84b-1' };
  // 55c2e84b 真实 .log 的形状：开头 result.payloads=[]；尾部 meta.yielded=true + acceptedSessionSpawns。
  // tail -c 20000 读不到开头，所以两类信号都要能单独认出来。
  const yieldTail = [
    '      "livenessState": "paused",',
    '      "yielded": true,',
    '      "stopReason": "end_turn",',
    '      "toolSummary": { "calls": 8, "tools": ["agents_list", "bash", "sessions_spawn", "sessions_yield"], "failures": 1 }',
    '    },',
    '    "acceptedSessionSpawns": [',
    '      { "runId": "b73bfb6a", "childSessionKey": "agent:media:subagent:94d3d839", "expectsCompletionMessage": true }',
    '    ],',
    '    "requesterContinuationSettled": true',
    '  }',
    '}',
  ].join('\n');
  const reap = async (stdout) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
    const execFileFn = vi.fn((c, a, o, cb) => cb(null, stdout, ''));
    const r = await reapOpenclawAgentRuns({ query }, { execFileFn });
    return { r, query };
  };

  it('EXIT=0 + yielded=true + 无最终文本 → failed(agent_yielded_without_result)，不写 completed_no_pr', async () => {
    const { r, query } = await reap(`EXIT=0\n${yieldTail}\n`);
    expect(r).toEqual({ reaped: 1, completed: 0, failed: 1, requeued: 0 });
    expect(query.mock.calls.some(([sql]) => /completed_no_pr/.test(sql)), 'yield 收尾被判完成').toBe(false);
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
    expect(upd[1]).toContain('agent_yielded_without_result');
    const merged = JSON.parse(upd[1].find((v) => typeof v === 'string' && v.includes('receipt')));
    expect(merged.receipt.exit).toBe(0);
    expect(merged.receipt.log_tail).toContain('"yielded": true');
    expect(merged.yield_summary).toMatchObject({ yielded: true, child_sessions: ['agent:media:subagent:94d3d839'] });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      expect.anything(), task.id, 'openclaw_agent_reaped',
      expect.objectContaining({ run_id: row.run_id, exit: 0, reason: 'agent_yielded_without_result' }),
    );
  });

  it('EXIT=0 + result.payloads 为空且无最终文本（未见 yielded 字段）→ 同样 failed', async () => {
    const head = '{\n  "runId": "x",\n  "status": "ok",\n  "result": {\n    "payloads": [],\n    "meta": { "durationMs": 1 }\n  }\n}';
    const { r, query } = await reap(`EXIT=0\n${head}\n`);
    expect(r.failed).toBe(1);
    expect(r.completed).toBe(0);
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[1]).toContain('agent_yielded_without_result');
  });

  it('EXIT=0 + 有最终文本（无 yield 信号）→ 仍判 completed_no_pr', async () => {
    const { r, query } = await reap('EXIT=0\n{"finalAssistantVisibleText":"已完成：截图 a.jpg 12KB","result":{"payloads":[{"text":"已完成"}]}}\n');
    expect(r).toEqual({ reaped: 1, completed: 1, failed: 0, requeued: 0 });
    expect(query.mock.calls.some(([sql]) => /completed_no_pr/.test(sql))).toBe(true);
  });
});
