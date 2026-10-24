import { describe, it, expect } from 'vitest';
import { parseQaReport, trivialAssertions } from '../lib/qa-report.mjs';
import { compileQaReport, compiledLedger } from '../lib/native-evidence.mjs';

// 协议unit：原生执行账是明确的fixture，不声称实际执行过命令。
const fm = '---\ntask_id: 088c3431-57ca-4f2a-8a50-14601518e2a2\nstep: evaluate\nupstream: []\n---\n';
const F = '```', command = 'cat proof.txt';
const run = (item_id, exit_code = 0) => ({ item_id, command, output: 'identical\n', exit_code });
const item = (id, occurrence, verdict = 'PASS', extra = '') => `### ${id}\n对应: Q-1\nverdict: ${verdict}\nnative_occurrence: ${occurrence}\n${extra}${F}command\n${command}\n${F}\n${F}output\nidentical\n${F}\n`;

describe('重复命令的native_occurrence明确绑定协议', () => {
  it.each(['echo PASS', 'printf PASS', 'printf PASS; false || true', 'printf PASS; false; exit 0'])('完整原生封套不豁免原有恒真断言拒绝：%s', script => {
    const raw = `/bin/zsh -lc '${script}'`;
    const commands = [{ item_id: 'wrapped-trivial', command: raw, output: 'PASS\n', exit_code: 0 }];
    const draft = fm + `### T-1\n对应: Q-1\nverdict: PASS\n${F}command\n${script}\n${F}\n${F}output\nPASS\n${F}\n`;
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    expect(parsed.errors).toEqual([]);
    expect(trivialAssertions(parsed.tests)).toEqual(['T-1']);
    const compiled = compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 });
    const reread = parseQaReport(compiled);
    expect(reread.errors).toEqual([]);
    expect(trivialAssertions(reread.tests)).toEqual(['T-1']);
  });

  it.each([
    ['PASS', 0, ''],
    ['FAIL', 7, ''],
    ['CANNOT_VERIFY', 1, '原因: 实际诊断返回失败，目标条件无法验证\n'],
  ])('完整 shell 原生命令编译往返保留 %s 和真实身份', (verdict, exit_code, reason) => {
    const raw = "/bin/zsh -lc 'cat proof.txt'";
    const commands = [{ ...run('shell-command', exit_code), command: raw }];
    const draft = fm + item('T-1', '1', verdict, reason);
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    expect(parsed.errors).toEqual([]);
    const compiled = compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 });
    const reread = parseQaReport(compiled);
    expect(reread.errors).toEqual([]);
    expect(reread.tests[0]).toMatchObject({ command: raw, output: 'identical\n', native_item_id: 'shell-command', exit_code, verdict });
    expect(compiledLedger(compiled).ledger.commands).toEqual(commands);
  });

  it.each([
    "/bin/bash -lc 'cat proof.txt'",
    "/bin/zsh -lc 'cat proof.txt'; true",
    "/bin/zsh -lc 'cat proof.txt' extra",
    '/bin/zsh -lc "cat $DYNAMIC"',
  ])('编译报告不能用另一封套或附加动作冒认原生命令：%s', reported => {
    const raw = "/bin/zsh -lc 'cat proof.txt'";
    const commands = [{ ...run('shell-command'), command: raw }];
    const draft = fm + item('T-1', '1');
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    const compiled = compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 });
    const altered = compiled.replace(JSON.stringify(raw), JSON.stringify(reported));
    expect(parseQaReport(altered).errors).toContain('T-1:native_unverified');
  });

  it('按同命令completed账的1基序号绑定1/2，保留失败和完整有序ledger', () => {
    const commands = [run('first-failed', 1), run('second-success', 0), { item_id: 'unreferenced', command: 'cat absent.txt', output: 'missing\n', exit_code: 1 }];
    const draft = fm + item('T-1', '1', 'FAIL') + item('T-2', '2');
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    expect(parsed.errors).toEqual([]);
    const compiled = compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 });
    const reread = parseQaReport(compiled);
    expect(reread.errors).toEqual([]);
    expect(reread.tests.map(({ native_item_id, exit_code, verdict }) => ({ native_item_id, exit_code, verdict }))).toEqual([
      { native_item_id: 'first-failed', exit_code: 1, verdict: 'FAIL' },
      { native_item_id: 'second-success', exit_code: 0, verdict: 'PASS' },
    ]);
    expect(compiledLedger(compiled).ledger.commands).toEqual(commands);
  });

  it('occurrence1明确选失败项时，不能用exit0字段偷偷改选第二个成功项', () => {
    const commands = [run('first-failed', 1), run('second-success', 0)];
    const draft = fm + item('T-1', '1', 'PASS', 'exit_code: 0\n');
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    expect(() => compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 })).toThrow();
  });

  it.each(['0', '-1', '1.5', '2', '"1"', 'one'])('非法或单命令越界occurrence %s不能当未知字段忽略', occurrence => {
    const commands = [run('only-command')];
    const draft = fm + item('T-1', occurrence);
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    expect(() => compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 })).toThrow();
  });
});
