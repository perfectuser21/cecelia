// lib/transcript.mjs：从 claude stream-json 对话记录提取实际执行的 Bash 命令，并核对 04 证据。
import { describe, it, expect } from 'vitest';
import { bashExecutions, unverifiedItems, claudeOwnErrorText } from '../lib/transcript.mjs';

const toolUse = (id, command, name = 'Bash') => JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'text', text: '跑一下' }, { type: 'tool_use', id, name, input: { command } }] },
});
const toolResult = (id, content) => JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});

describe('bashExecutions', () => {
  it('配对 tool_use 与 tool_result；结果可为字符串或 text 块数组；忽略非 JSON 行与非 Bash 工具', () => {
    const stdout = [
      'FAKE 非 JSON 行',
      toolUse('t1', 'npm test'),
      toolResult('t1', 'ok 3 passed'),
      toolUse('t2', 'curl -s localhost/health'),
      toolResult('t2', [{ type: 'text', text: '{"ok":true}' }, { type: 'text', text: 'done' }]),
      toolUse('t3', '/etc/passwd', 'Read'),
      toolResult('t3', 'root:x'),
      toolUse('t4', 'echo 没有结果'),
      '{"type":"result","result":"完成"}',
    ].join('\n');
    expect(bashExecutions(stdout)).toEqual([
      { command: 'npm test', result: 'ok 3 passed' },
      { command: 'curl -s localhost/health', result: '{"ok":true}\ndone' },
      { command: 'echo 没有结果', result: '' },
    ]);
  });

  it('空输入 -> []', () => {
    expect(bashExecutions('')).toEqual([]);
  });
});

describe('unverifiedItems', () => {
  const executions = [
    { command: 'cd /repo &&  npm   test -- --run', result: 'RUN v1\n ✓ a.test.js (3)\n Tests  3 passed\nDone' },
    { command: 'curl -s http://x/health', result: '{"ok":true}' },
  ];
  const item = (patch) => ({ id: 'E-1', covers: ['I-1'], verdict: 'PASS', command: 'npm test -- --run', output: 'Tests  3 passed', ...patch });

  it('命令规范化空白后被实际命令包含、output 非空行（去首尾空白）都是结果子串 -> 通过', () => {
    expect(unverifiedItems([item({ output: '  ✓ a.test.js (3)\n\n Tests  3 passed ' })], executions)).toEqual([]);
    expect(unverifiedItems([item({ command: 'npm  test\n-- --run' })], executions)).toEqual([]);
  });

  it('output 行内空白不做规范化：改动了行内容就不是子串', () => {
    expect(unverifiedItems([item({ output: 'Tests 3 passed' })], executions)).toEqual([
      { id: 'E-1', reason: 'output_not_in_result' },
    ]);
  });

  it('命令从未执行过 -> command_not_executed', () => {
    expect(unverifiedItems([item({ id: 'E-2', command: 'npm run e2e' })], executions)).toEqual([
      { id: 'E-2', reason: 'command_not_executed' },
    ]);
  });

  it('输出不在对应命令的结果里（哪怕在别的命令结果里）-> output_not_in_result', () => {
    expect(unverifiedItems([item({ output: '{"ok":true}' })], executions)).toEqual([
      { id: 'E-1', reason: 'output_not_in_result' },
    ]);
  });

  it('output 只取前 5 个非空行比对', () => {
    const output = ['RUN v1', '✓ a.test.js (3)', 'Tests  3 passed', 'Done', 'RUN v1', '编造的第六行'].join('\n');
    expect(unverifiedItems([item({ output })], executions)).toEqual([]);
  });

  it('没有任何执行记录 -> 全部 command_not_executed', () => {
    expect(unverifiedItems([item({}), item({ id: 'E-2' })], [])).toEqual([
      { id: 'E-1', reason: 'command_not_executed' },
      { id: 'E-2', reason: 'command_not_executed' },
    ]);
  });
});

describe('claudeOwnErrorText', () => {
  it('只取出错的 result 事件与 error 事件，不含 tool_result 里的业务输出', () => {
    const stdout = [
      toolUse('t1', 'npm test'),
      toolResult('t1', 'authentication failed for user admin'),
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Invalid API key · Please run /login' }),
      JSON.stringify({ type: 'error', error: { message: 'rate limit reached' } }),
    ].join('\n');
    const text = claudeOwnErrorText(stdout);
    expect(text).toContain('Invalid API key');
    expect(text).toContain('error_during_execution');
    expect(text).toContain('rate limit reached');
    expect(text).not.toContain('authentication failed for user admin');
  });

  it('成功的 result 事件不计入', () => {
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '已完成：quota 统计功能' });
    expect(claudeOwnErrorText(stdout)).toBe('');
  });
});
