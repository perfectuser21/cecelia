import { describe, it, expect } from 'vitest';
import { parseEvidence, judgeEvidence, OUTPUT_SUMMARY_MAX } from '../lib/evidence.mjs';

const FENCE = '```';
const FM = '---\ntask_id: t-1\nstep: verify\nupstream: ["01-intent.md#I-1","01-intent.md#I-2"]\n---\n# 验收证据\n';

function entry(id, { covers = 'I-1', verdict = 'PASS', command = 'npm test', output = 'ok 1 passed' } = {}) {
  const lines = [`### ${id}`];
  if (covers !== null) lines.push(`对应: ${covers}`);
  if (verdict !== null) lines.push(`verdict: ${verdict}`);
  if (command !== null) lines.push(`${FENCE}command`, command, FENCE);
  if (output !== null) lines.push(`${FENCE}output`, output, FENCE);
  return `${lines.join('\n')}\n`;
}

describe('parseEvidence', () => {
  it('解析合法条目：id/covers/verdict/command/output', () => {
    const r = parseEvidence(`${FM}\n${entry('E-1')}\n${entry('E-2', { covers: 'I-2', verdict: 'FAIL', command: 'curl -s x\necho done', output: 'HTTP 500' })}`);
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual([
      { id: 'E-1', covers: ['I-1'], verdict: 'PASS', command: 'npm test', output: 'ok 1 passed' },
      { id: 'E-2', covers: ['I-2'], verdict: 'FAIL', command: 'curl -s x\necho done', output: 'HTTP 500' },
    ]);
  });

  it('E-n 标题行后可跟说明文字（与 01/02/03 锚点规则一致）', () => {
    const r = parseEvidence(`${FM}\n${entry('E-1').replace('### E-1', '### E-1 安装脚本写入开关')}`);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.id)).toEqual(['E-1']);
  });

  it('对应可用全角冒号、可列多个 I-n、可带列表符号', () => {
    const text = `### E-1\n- 对应：I-1、I-2\n- verdict: PASS\n${FENCE}command\nx\n${FENCE}\n${FENCE}output\ny\n${FENCE}\n`;
    const r = parseEvidence(text);
    expect(r.errors).toEqual([]);
    expect(r.items[0].covers).toEqual(['I-1', 'I-2']);
    expect(r.items[0].verdict).toBe('PASS');
  });

  it('代码块里的 ### 行与 verdict 行不被当成结构', () => {
    const output = '### E-9\nverdict: FAIL\n对应: I-9';
    const r = parseEvidence(entry('E-1', { output }));
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ verdict: 'PASS', covers: ['I-1'], output });
  });

  it.each([
    ['verdict 缺失', { verdict: null }, 'E-1:verdict_missing'],
    ['verdict 非 PASS/FAIL', { verdict: 'OK' }, 'E-1:verdict_invalid'],
    ['command 缺失', { command: null }, 'E-1:command_missing'],
    ['command 为空', { command: '  ' }, 'E-1:command_empty'],
    ['output 缺失', { output: null }, 'E-1:output_missing'],
    ['output 为空', { output: '   ' }, 'E-1:output_empty'],
    ['对应缺失', { covers: null }, 'E-1:covers_missing'],
    ['对应格式非法', { covers: 'S-1' }, 'E-1:covers_invalid:S-1'],
  ])('%s -> %s', (_name, opts, code) => {
    const r = parseEvidence(entry('E-1', opts));
    expect(r.errors).toContain(code);
  });

  it('重复的 E-n -> duplicate', () => {
    const r = parseEvidence(`${entry('E-1')}${entry('E-1')}`);
    expect(r.errors).toContain('E-1:duplicate');
  });

  it('文末仍开着的代码块按闭合到文末处理（真实 claude 2c34f677：最后一条 output 没写闭合 ```）', () => {
    const r = parseEvidence(`${FM}\n${entry('E-1')}\n### E-2\n对应: I-2\nverdict: PASS\n${FENCE}command\nnpm test\n${FENCE}\n${FENCE}output\n Tests  61 passed\n`);
    expect(r.errors).toEqual([]);
    expect(r.items[1]).toMatchObject({ id: 'E-2', command: 'npm test', output: ' Tests  61 passed' });
  });

  it('文末开着的是 command 块：按闭合处理，但缺 output 照报 output_missing', () => {
    const r = parseEvidence(`### E-1\n对应: I-1\nverdict: PASS\n${FENCE}command\nnpm test\n`);
    expect(r.errors).toEqual(['E-1:output_missing']);
  });

  it('文中未闭合的代码块吞掉后面的 E-n：后面的 I-n 判未覆盖（不放宽）', () => {
    const text = `${FM}\n### E-1\n对应: I-1\nverdict: PASS\n${FENCE}command\nnpm test\n\n${entry('E-2', { covers: 'I-2' })}`;
    const parsed = parseEvidence(text);
    expect(parsed.items.map((i) => i.id)).toEqual(['E-1']);
    expect(judgeEvidence(parsed, ['I-1', 'I-2'])).toMatchObject({ reason: 'evidence_incomplete', missing: ['I-2'] });
  });

  it('verdict 不区分大小写、字段行可带 markdown 加粗', () => {
    const r = parseEvidence(`### E-1\n**对应**: I-1\n**verdict**: pass\n${FENCE}command\nnpm test\n${FENCE}\n${FENCE}output\nok\n${FENCE}\n`);
    expect(r.errors).toEqual([]);
    expect(r.items[0]).toMatchObject({ covers: ['I-1'], verdict: 'PASS' });
  });

  it('没有任何 E-n -> items 为空、无格式错误（交给覆盖判定）', () => {
    expect(parseEvidence(`${FM}\n正文\n`)).toEqual({ items: [], errors: [] });
  });

  it('非字符串输入 -> items 为空并报 evidence_not_text', () => {
    expect(parseEvidence(undefined)).toEqual({ items: [], errors: ['evidence_not_text'] });
  });
});

describe('judgeEvidence', () => {
  const ids = ['I-1', 'I-2'];
  const judge = (text) => judgeEvidence(parseEvidence(text), ids);

  it('全部 PASS 且覆盖全部 I-n -> reason null，verified_ids 为全部 I-n', () => {
    const r = judge(`${entry('E-1')}${entry('E-2', { covers: 'I-2' })}`);
    expect(r).toEqual({ reason: null, verifiedIds: ['I-1', 'I-2'], summary: [
      { intent: 'I-1', verdict: 'PASS' },
      { intent: 'I-2', verdict: 'PASS' },
    ] });
  });

  it('格式错误 -> evidence_invalid，带 errors', () => {
    const r = judge(`${entry('E-1', { output: '' })}${entry('E-2', { covers: 'I-2' })}`);
    expect(r.reason).toBe('evidence_invalid');
    expect(r.errors).toContain('E-1:output_empty');
  });

  it('对应的 I-n 不存在 -> evidence_invalid covers_unknown', () => {
    const r = judge(`${entry('E-1')}${entry('E-2', { covers: 'I-2, I-9' })}`);
    expect(r.reason).toBe('evidence_invalid');
    expect(r.errors).toContain('E-2:covers_unknown:I-9');
  });

  it('有 I-n 未被覆盖 -> evidence_incomplete，带 missing', () => {
    const r = judge(entry('E-1'));
    expect(r).toMatchObject({ reason: 'evidence_incomplete', missing: ['I-2'] });
  });

  it('任一 FAIL -> verification_failed，failed 列出失败条目，summary 标该 I-n 为 FAIL', () => {
    const r = judge(`${entry('E-1')}${entry('E-2', { covers: 'I-2', verdict: 'FAIL', command: 'curl x', output: 'HTTP 500' })}`);
    expect(r.reason).toBe('verification_failed');
    expect(r.failed).toEqual([{ id: 'E-2', covers: ['I-2'], command: 'curl x', output: 'HTTP 500' }]);
    expect(r.summary).toEqual([{ intent: 'I-1', verdict: 'PASS' }, { intent: 'I-2', verdict: 'FAIL' }]);
  });

  it('失败条目的 output 只保留尾部摘要', () => {
    const long = `${'a'.repeat(OUTPUT_SUMMARY_MAX)}TAIL`;
    const r = judge(`${entry('E-1', { verdict: 'FAIL', output: long })}${entry('E-2', { covers: 'I-2' })}`);
    const out = r.failed[0].output;
    expect(out.length).toBeLessThanOrEqual(OUTPUT_SUMMARY_MAX + 1);
    expect(out.endsWith('TAIL')).toBe(true);
    expect(out.startsWith('…')).toBe(true);
  });
});
