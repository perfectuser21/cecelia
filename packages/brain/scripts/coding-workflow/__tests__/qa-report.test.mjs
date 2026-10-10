// lib/qa-report.mjs：evaluator 的 05-qa-report——按 QA 场景逐条测（T-n 对应 Q-n）+ 探索发现（X-n 带严重度/场景）。
import { describe, it, expect } from 'vitest';
import { parseQaReport, judgeQa, unitTestEvidence, productionTouches, trivialAssertions, screenshotProblems } from '../lib/qa-report.mjs';
import { parseEvidence } from '../lib/evidence.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
      // 先把生产地址赋给变量再访问：分段看不出来，按「赋值指向生产 + 有访问动作」判
      { command: 'B=http://localhost:5221; curl -s $B/api/brain/tasks' },
    ];
    expect(productionTouches(runs)).toEqual([
      'echo start && wget -qO- http://127.0.0.1:5221/api/brain/health',
      "node -e \"fetch('http://localhost:5221/api/brain/tasks').then(r=>r.text()).then(console.log)\"",
      'ssh us-vps curl -s 100.79.41.61:5221/api/brain/health',
      'nc -z localhost 5221',
      'B=http://localhost:5221; curl -s $B/api/brain/tasks',
    ]);
  });
});

// 审计 #38（旧 evaluator T5 unverifiable 第三态）+ #19（缺工具 = 写验不了，禁止降级）
describe('CANNOT_VERIFY（验不了）', () => {
  const qaIds = ['Q-1', 'Q-2'];
  const cannot = (id, q, reason = '工具缺失：预览环境没有 ffprobe') =>
    `### ${id}\n对应: ${q}\nverdict: CANNOT_VERIFY\n${reason ? `原因: ${reason}\n` : ''}${F}command\nwhich ffprobe\n${F}\n${F}output\n(空)\n${F}\n`;

  it('T-n 可判 CANNOT_VERIFY（带原因）；没有 FAIL 时整份 verdict CANNOT_VERIFY，列出验不了的条目', () => {
    const r = judgeQa(parseQaReport(`${FM}\n${t('T-1', 'Q-1')}\n${cannot('T-2', 'Q-2')}`), qaIds);
    expect(r).toMatchObject({ reason: null, verdict: 'CANNOT_VERIFY', failed: [] });
    expect(r.cannot_verify).toEqual([expect.objectContaining({ id: 'T-2', reason: '工具缺失：预览环境没有 ffprobe' })]);
  });

  it('有 FAIL 时 FAIL 优先（进修复环），验不了的照样列出', () => {
    const r = judgeQa(parseQaReport(`${FM}\n${t('T-1', 'Q-1', 'FAIL')}\n${cannot('T-2', 'Q-2')}`), qaIds);
    expect(r.verdict).toBe('FAIL');
    expect(r.cannot_verify.map((i) => i.id)).toEqual(['T-2']);
  });

  it('CANNOT_VERIFY 必须写原因', () => {
    expect(parseQaReport(`${FM}\n${cannot('T-1', 'Q-1', '')}`).errors).toEqual(['T-1:reason_missing']);
  });

  it('04 开发自测证据不接受 CANNOT_VERIFY（只有 QA 报告有第三态）', () => {
    const e = parseEvidence(`### E-1\n对应: I-1\nverdict: CANNOT_VERIFY\n${F}command\nx\n${F}\n${F}output\ny\n${F}\n`);
    expect(e.errors).toEqual(['E-1:verdict_invalid']);
  });
});

// 审计 #36（旧 evaluator 反作弊红线 + proposer 作弊反例清单）：PASS 的命令不许恒真
describe('trivialAssertions', () => {
  const item = (id, command, verdict = 'PASS') => ({ id, command, verdict });
  it('PASS 条目带 `|| true`、`; exit 0`、`--dry-run`、或只有 echo/printf/true → 列出', () => {
    expect(trivialAssertions([
      item('T-1', 'curl -s http://p/api/brain/x || true'),
      item('T-2', 'curl -s http://p/api/brain/x; exit 0'),
      item('T-3', 'node scripts/publish.mjs --dry-run'),
      item('T-4', 'echo "PASS: 任务已创建"'),
      item('T-5', 'printf ok'),
    ])).toEqual(['T-1', 'T-2', 'T-3', 'T-4', 'T-5']);
  });
  it('正常的请求、带 jq -e 的断言、FAIL 条目不算', () => {
    expect(trivialAssertions([
      item('T-1', 'curl -s http://p/api/brain/x | jq -e \'.status == "ok"\''),
      item('T-2', 'curl -s http://p/x && echo done'),
      item('T-3', 'curl -s http://p/x || true', 'FAIL'),
    ])).toEqual([]);
  });
});

// 审计 #37（旧 evaluator 领域死规则：UI 必须有可见断言/截图）
describe('screenshotProblems', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-shots-'));
  it('报告引用的截图文件不存在 → 列出；存在 → 不列', () => {
    const sprint = dir();
    fs.mkdirSync(path.join(sprint, 'qa-r1'));
    fs.writeFileSync(path.join(sprint, 'qa-r1', 'ok.png'), 'png');
    const text = '### T-1\n截图: qa-r1/ok.png\n### T-2\n截图: qa-r1/missing.png\n';
    expect(screenshotProblems({ reportText: text, items: [], sprintDir: sprint, shotsDir: path.join(sprint, 'qa-r1') }))
      .toEqual(['screenshot_missing:qa-r1/missing.png']);
  });
  // 金丝雀 3（PR #6220 第 1 轮）：截图行在路径后面跟说明文字（全角括号、顿号分隔多张），说明不是路径，不能误报
  it('截图行带说明文字：只取图片路径；路径存在 → 不报，说明文字不当路径', () => {
    const sprint = dir();
    fs.mkdirSync(path.join(sprint, 'qa-r1'));
    for (const f of ['q8-a-default-category.png', 'q8-b-bad-category.png']) fs.writeFileSync(path.join(sprint, 'qa-r1', f), 'png');
    const text = '### T-8\n截图: qa-r1/q8-a-default-category.png（分类留空：弹窗已关，列表首条为 QA-ui-default-qa1791620843608，分类标签 decision）、qa-r1/q8-b-bad-category.png（分类填 product：弹窗仍在）\n';
    expect(screenshotProblems({ reportText: text, items: [], sprintDir: sprint, shotsDir: path.join(sprint, 'qa-r1') })).toEqual([]);
    const missing = '截图: `qa-r1/q9.png`（不存在的那张）\n';
    expect(screenshotProblems({ reportText: missing, items: [], sprintDir: sprint, shotsDir: path.join(sprint, 'qa-r1') })).toEqual(['screenshot_missing:qa-r1/q9.png']);
  });

  it('用了 Playwright 的条目但本轮截图目录没有任何图片 → 列出', () => {
    const sprint = dir();
    const items = [{ id: 'T-1', command: 'node qa-page.mjs http://p/' }, { id: 'T-2', command: 'npx playwright screenshot http://p/ a.png' }];
    const executions = [{ command: 'cat > qa-page.mjs <<EOF\nconst { chromium } = require("playwright");\nEOF' }];
    expect(screenshotProblems({ reportText: '', items, executions, sprintDir: sprint, shotsDir: path.join(sprint, 'qa-r1') }))
      .toEqual(['screenshot_none:T-1', 'screenshot_none:T-2']);
    fs.mkdirSync(path.join(sprint, 'qa-r1'));
    fs.writeFileSync(path.join(sprint, 'qa-r1', 'home.png'), 'png');
    expect(screenshotProblems({ reportText: '', items, executions, sprintDir: sprint, shotsDir: path.join(sprint, 'qa-r1') })).toEqual([]);
  });
});
