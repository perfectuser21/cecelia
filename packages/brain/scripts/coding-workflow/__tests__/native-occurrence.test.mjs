import { describe, it, expect } from 'vitest';
import { parseQaReport } from '../lib/qa-report.mjs';
import { compileQaReport, compiledLedger } from '../lib/native-evidence.mjs';

// 协议unit：原生执行账是明确的fixture，不声称实际执行过命令。
const fm = '---\ntask_id: 088c3431-57ca-4f2a-8a50-14601518e2a2\nstep: evaluate\nupstream: []\n---\n';
const F = '```', command = 'cat proof.txt';
const run = (item_id, exit_code = 0) => ({ item_id, command, output: 'identical\n', exit_code });
const item = (id, occurrence, verdict = 'PASS', extra = '') => `### ${id}\n对应: Q-1\nverdict: ${verdict}\nnative_occurrence: ${occurrence}\n${extra}${F}command\n${command}\n${F}\n${F}output\nidentical\n${F}\n`;

describe('重复命令的native_occurrence明确绑定协议', () => {
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
