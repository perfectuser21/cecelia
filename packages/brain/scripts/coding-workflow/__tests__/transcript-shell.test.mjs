import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { bashExecutions, unverifiedItems } from '../lib/transcript.mjs';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/codex-shell-evidence.json', import.meta.url), 'utf8'));
const native = (command, output = 'ok', exitCode = 0, type = 'item.completed', id = 'c1') => JSON.stringify({ type, item: { id, type: 'command_execution', command, aggregated_output: output, exit_code: exitCode, status: type === 'item.started' ? 'in_progress' : 'completed' } });
const ev = (command, output = 'ok') => ({ id: 'E-1', command, output });
const denied = [{ id: 'E-1', reason: 'command_not_executed' }];

describe('Codex native shell 包装证据精确核对', () => {
  it.each(fixtures)('真实脱敏事件回放 $evidence.id（引号、here-doc、反斜杠只解一层）', ({ event, evidence }) => {
    expect(unverifiedItems([evidence], bashExecutions(JSON.stringify(event)))).toEqual([]);
  });
  it.each(['bash', 'sh', 'zsh', '/bin/bash', '/usr/bin/zsh', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'])('支持已知shell路径 %s 的单引号包装', (shell) => {
    expect(unverifiedItems([ev('printf "%s" ok')], bashExecutions(native(`${shell} -lc 'printf "%s" ok'`)))).toEqual([]);
  });
  it('双引号解码保留内层转义，单引号拼接也只解一层', () => {
    const command = 'printf "%s\\n" "$HOME"';
    const wrapped = '/bin/bash -lc "' + command.replace(/[\\"$`]/g, '\\$&') + '"';
    expect(unverifiedItems([ev(command)], bashExecutions(native(wrapped)))).toEqual([]);
    expect(unverifiedItems([ev("printf '%s' ok")], bashExecutions(native("sh -c 'printf '\"'\"'%s'\"'\"' ok'")))).toEqual([]);
  });
  it.each([
    'echo "npm test"', 'printf "%s" "npm test"', 'true # npm test',
    'true && npm test', 'npm test; echo extra',
    '/tmp/bash -lc "npm test"', 'env bash -lc "npm test"',
    'bash -ic "npm test"', 'bash -lc "npm test" extra',
    'bash -lc "npm test"; echo extra', 'bash -lc "npm test" && true',
    'bash -lc "npm test $DYNAMIC"', 'bash -lc "npm test $(echo extra)"',
    'bash -lc "npm test `echo extra`"', 'bash -lc "npm test',
  ])('不能从文本、复合段或未知/动态wrapper中冒认执行：%s', (command) => {
    expect(unverifiedItems([ev('npm test')], bashExecutions(native(command)))).toEqual(denied);
  });
  it('内层复合命令必须全文一致，字面量空白不能压扁', () => {
    expect(unverifiedItems([ev('true && npm test')], bashExecutions(native("bash -lc 'true && npm test'")))).toEqual([]);
    expect(unverifiedItems([ev('printf "a b"')], bashExecutions(native("bash -lc 'printf \"a  b\"'")))).toEqual(denied);
  });
  it('只有完成事件可作证；同id起始记录不能把完成的另一命令嫁接到一起', () => {
    expect(unverifiedItems([ev('npm test')], bashExecutions(native('npm test', 'ok', null, 'item.started')))).toEqual(denied);
    const events = [native('npm test', '', null, 'item.started'), native('echo fake', 'ok')].join('\n');
    expect(unverifiedItems([ev('npm test')], bashExecutions(events))).toEqual(denied);
  });
  it('保留完成事件exit_code，输出与退出码归同一execution，失败负例仍能作证', () => {
    const runs = bashExecutions([native("bash -lc 'npm test'", 'failed', 1), native("bash -lc 'npm test'", 'ok', 0, 'item.completed', 'c2')].join('\n'));
    expect(runs.map((r) => ({ result: r.result, exitCode: r.exitCode, completed: r.completed }))).toEqual([
      { result: 'failed', exitCode: 1, completed: true }, { result: 'ok', exitCode: 0, completed: true },
    ]);
    expect(unverifiedItems([ev('npm test', 'failed')], runs)).toEqual([]);
    expect(unverifiedItems([ev('npm test', 'failed\nok')], runs)).toEqual([{ id: 'E-1', reason: 'output_not_in_result' }]);
  });
  it('缺失退出码或动态cd前缀不能补成已执行证据', () => {
    expect(unverifiedItems([ev('npm test')], bashExecutions(native('npm test', 'ok', null)))).toEqual(denied);
    expect(unverifiedItems([ev('cd \"$OUTSIDE\" && npm test')], bashExecutions(native('npm test')), { worktree: '/wt' })).toEqual(denied);
  });
  it('agent_message里即便完整声称命令与输出也不作证', () => {
    const text = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'npm test\nok' } });
    expect(unverifiedItems([ev('npm test')], bashExecutions(text))).toEqual(denied);
  });
});
