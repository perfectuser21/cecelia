// lib/qa-report.mjs：evaluator 的 05-qa-report——按 QA 场景逐条测（T-n 对应 Q-n）+ 探索发现（X-n 带严重度/场景）。
import { describe, it, expect } from 'vitest';
import { parseQaReport, judgeQa, unitTestEvidence, productionTouches } from '../lib/qa-report.mjs';

const F = '```';
const FM = '---\ntask_id: t\nstep: evaluate\nupstream: ["02-spec.md#Q-1","02-spec.md#Q-2"]\n---\n# QA 报告\n';
const t = (id, q, verdict = 'PASS', command = 'curl -s http://localhost:5302/api/brain/tasks', output = '[]') =>
  `### ${id}\n对应: ${q}\nverdict: ${verdict}\n${F}command\n${command}\n${F}\n${F}output\n${output}\n${F}\n`;
const x = (id, { verdict = 'FAIL', severity = '阻断', scene = '用户连续 POST 两次建出两条', covers = 'Q-1' } = {}) =>
  `### ${id}\n对应: ${covers}\n${severity ? `严重度: ${severity}\n` : ''}${scene ? `场景: ${scene}\n` : ''}verdict: ${verdict}\n${F}command\ncurl -s -X POST x\n${F}\n${F}output\n{"id":2}\n${F}\n`;

describe('parseQaReport', () => {
  it('分别解析 T-n（对应 Q-n）与 X-n（对应 I-n/Q-n，带严重度与场景）', () => {
    const r = parseQaReport(`${FM}\n${t('T-1', 'Q-1')}\n${t('T-2', 'Q-2', 'FAIL')}\n${x('X-1', { covers: 'I-1' })}`);
    expect(r.errors).toEqual([]);
    expect(r.tests.map((i) => [i.id, i.covers, i.verdict])).toEqual([['T-1', ['Q-1'], 'PASS'], ['T-2', ['Q-2'], 'FAIL']]);
    expect(r.findings).toEqual([expect.objectContaining({ id: 'X-1', covers: ['I-1'], verdict: 'FAIL', severity: '阻断', scene: '用户连续 POST 两次建出两条' })]);
  });

  it('T-n 只能对应 Q-n；X-n 判 FAIL 时必须带严重度与场景', () => {
    const r = parseQaReport(`${FM}\n${t('T-1', 'I-1')}\n${x('X-1', { severity: '', scene: '' })}\n${x('X-2', { verdict: 'PASS', severity: '', scene: '' })}`);
    expect(r.errors).toEqual(['T-1:covers_invalid:I-1', 'X-1:severity_missing', 'X-1:scene_missing']);
  });
});

describe('judgeQa', () => {
  const qaIds = ['Q-1', 'Q-2'];
  it('每个 Q-n 都有 T-n 且全 PASS、没有阻断/重要的 FAIL 发现 → PASS', () => {
    const r = judgeQa(parseQaReport(`${FM}\n${t('T-1', 'Q-1')}\n${t('T-2', 'Q-2')}\n${x('X-1', { severity: '建议' })}`), qaIds);
    expect(r).toMatchObject({ verdict: 'PASS', failed: [], blocking: [] });
  });

  it('有 Q-n 没测 → reason qa_incomplete（报告不合格，不是产品不合格）', () => {
    expect(judgeQa(parseQaReport(`${FM}\n${t('T-1', 'Q-1')}`), qaIds)).toMatchObject({ reason: 'qa_incomplete', missing: ['Q-2'] });
  });

  it('T-n FAIL 或阻断/重要发现 → FAIL，列出失败场景与发现', () => {
    const r = judgeQa(parseQaReport(`${FM}\n${t('T-1', 'Q-1')}\n${t('T-2', 'Q-2', 'FAIL')}\n${x('X-1', { severity: '重要' })}`), qaIds);
    expect(r.verdict).toBe('FAIL');
    expect(r.failed.map((i) => i.id)).toEqual(['T-2']);
    expect(r.blocking.map((i) => i.id)).toEqual(['X-1']);
  });

  it('格式错误 → reason qa_report_invalid', () => {
    expect(judgeQa(parseQaReport(`${FM}\n${t('T-1', 'I-1')}`), qaIds).reason).toBe('qa_report_invalid');
  });
});

describe('unitTestEvidence / productionTouches', () => {
  it('拿单元测试当证据 → 点名条目', () => {
    const items = [
      { id: 'T-1', command: 'cd packages/brain && npx vitest run x.test.mjs' },
      { id: 'T-2', command: 'npm test -- foo' },
      { id: 'T-3', command: 'npm run test' },
      { id: 'T-4', command: 'curl -s http://localhost:5302/api/brain/health' },
    ];
    expect(unitTestEvidence(items)).toEqual(['T-1', 'T-2', 'T-3']);
  });

  it('执行记录里碰过生产 Brain（5221 / us-vps）→ 列出命令', () => {
    const runs = [
      { command: 'curl -s localhost:5302/api/brain/health' },
      { command: 'curl -s http://localhost:5221/api/brain/tasks' },
      { command: 'psql -h 100.79.41.61 -c "select 1"' },
    ];
    expect(productionTouches(runs)).toEqual(['curl -s http://localhost:5221/api/brain/tasks', 'psql -h 100.79.41.61 -c "select 1"']);
  });

  // 金丝雀 3e8414f6（PR #6160）：QA 被判 evaluate_touched_production 致命，但规格的 Q-n 里本就写着 localhost:5221，
  // 只读文件的命令（grep/cat/sed/rg）出现这个数字不是访问生产；真正发出访问的才算
  it('只读文件的命令里出现 5221 不算碰生产；网络/数据库/远程访问才算（含管道、&&、node 内 fetch）', () => {
    const runs = [
      { command: 'grep -n "5221" sprints/s1/02-spec.md' },
      { command: 'cat sprints/s1/02-spec.md | grep 100.79.41.61' },
      { command: 'sed -n 1,40p sprints/s1/02-spec.md; rg 5221 packages/brain/src' },
      { command: 'P=http://localhost:5301; curl -s $P/api/brain/tasks?limit=5221' },
      { command: 'echo start && wget -qO- http://127.0.0.1:5221/api/brain/health' },
      { command: "node -e \"fetch('http://localhost:5221/api/brain/tasks').then(r=>r.text()).then(console.log)\"" },
      { command: 'ssh us-vps curl -s 100.79.41.61:5221/api/brain/health' },
      { command: 'nc -z localhost 5221' },
    ];
    expect(productionTouches(runs)).toEqual([
      'echo start && wget -qO- http://127.0.0.1:5221/api/brain/health',
      "node -e \"fetch('http://localhost:5221/api/brain/tasks').then(r=>r.text()).then(console.log)\"",
      'ssh us-vps curl -s 100.79.41.61:5221/api/brain/health',
      'nc -z localhost 5221',
    ]);
  });
});
