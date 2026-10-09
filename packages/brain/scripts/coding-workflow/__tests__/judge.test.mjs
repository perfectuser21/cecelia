// lib/judge.mjs：独立裁判（不同模型）——真人 QA PASS 后、合并前，复核「需求 01 + 合同 02 + QA 报告 05 + PR 改动」，
// 判每条 I-n 是否真被满足；问题分三类：product（代码没做到）/ qa_gap（QA 没真验到）/ contract_gap（合同没覆盖需求）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  judgeFileName, buildJudgePrompt, parseJudge, decideJudge, renderJudgeReport, resolveJudgeConfig, callJudge, DEFAULT_JUDGE_MODEL,
} from '../lib/judge.mjs';

const ok = (extra = {}) => ({
  coverage: [{ intent: 'I-1', satisfied: true, evidence: 'T-1 输出 404 {"error":"task not found"}' }, { intent: 'I-2', satisfied: true, evidence: 'T-2' }],
  issues: [],
  summary: '两条需求都有真实证据',
  ...extra,
});
const issue = (extra = {}) => ({ id: 'J-1', type: 'product', severity: '阻断', covers: ['I-2'], detail: '非法 id 仍返回 500', where: 'routes/tasks.js:40', ...extra });
const ids = { intentIds: ['I-1', 'I-2'] };

describe('judgeFileName', () => {
  it('按轮次：06-judge-r<round>.md', () => {
    expect(judgeFileName(3)).toBe('06-judge-r3.md');
  });
});

describe('buildJudgePrompt', () => {
  it('把需求、合同、QA 报告、PR 改动和 I-n 清单放进提示词；改动过长截断并标注', () => {
    const p = buildJudgePrompt({ intent: 'INTENT-TEXT', spec: 'SPEC-TEXT', qaReport: 'QA-TEXT', diff: 'D'.repeat(200000), intentIds: ['I-1', 'I-2'], round: 2 });
    expect(p.system).toContain('JSON');
    for (const s of ['INTENT-TEXT', 'SPEC-TEXT', 'QA-TEXT', 'I-1,I-2', '第 2 轮']) expect(p.user).toContain(s);
    expect(p.user).toContain('已截断');
    expect(p.user.length).toBeLessThan(150000);
  });
});

describe('parseJudge', () => {
  it('解析 JSON（允许外面包围栏/说明文字）', () => {
    const r = parseJudge(`好的\n\`\`\`json\n${JSON.stringify(ok({ issues: [issue({ severity: '建议', covers: ['I-1'] })] }))}\n\`\`\``, ids);
    expect(r.errors).toEqual([]);
    expect(r.coverage.map((c) => [c.intent, c.satisfied])).toEqual([['I-1', true], ['I-2', true]]);
    expect(r.issues).toEqual([expect.objectContaining({ id: 'J-1', type: 'product', severity: '建议', covers: ['I-1'] })]);
  });

  it('没有 JSON / JSON 坏了 → 报错', () => {
    expect(parseJudge('我觉得没问题', ids).errors).toEqual(['json_missing']);
    expect(parseJudge('{"coverage": [', ids).errors).toEqual(['json_missing']);
    expect(parseJudge('{"coverage": [}', ids).errors).toEqual(['json_invalid']);
  });

  it('每条 I-n 都要有 coverage；不认识的 I-n、satisfied 不是布尔、没有证据都算错', () => {
    const r = parseJudge(JSON.stringify(ok({ coverage: [{ intent: 'I-1', satisfied: 'yes', evidence: '' }, { intent: 'I-9', satisfied: true, evidence: 'x' }] })), ids);
    expect(r.errors).toEqual(['I-1:satisfied_invalid', 'I-1:evidence_missing', 'I-9:coverage_unknown', 'I-2:coverage_missing']);
  });

  it('问题字段校验：类型/严重度/对应 I-n/说明', () => {
    const r = parseJudge(JSON.stringify(ok({ issues: [issue({ type: 'style', severity: '致命', covers: ['Q-1'], detail: '' })] })), ids);
    expect(r.errors).toEqual(['J-1:type_invalid', 'J-1:severity_invalid', 'J-1:covers_invalid', 'J-1:detail_missing']);
  });

  it('判某条 I-n 没满足，却没有对应它的阻断/重要问题 → 报错（不许只说不满足不说为什么）', () => {
    const cov = [{ intent: 'I-1', satisfied: true, evidence: 'x' }, { intent: 'I-2', satisfied: false, evidence: 'T-2 只测了合法 id' }];
    expect(parseJudge(JSON.stringify(ok({ coverage: cov })), ids).errors).toEqual(['I-2:unsatisfied_without_issue']);
    expect(parseJudge(JSON.stringify(ok({ coverage: cov, issues: [issue({ severity: '建议' })] })), ids).errors).toEqual(['I-2:unsatisfied_without_issue']);
    expect(parseJudge(JSON.stringify(ok({ coverage: cov, issues: [issue()] })), ids).errors).toEqual([]);
  });
});

describe('decideJudge（程序判，不信模型自报的 verdict）', () => {
  const decide = (o) => decideJudge(parseJudge(JSON.stringify(o), ids));
  it('全部满足、只有建议级问题 → PASS', () => {
    expect(decide(ok({ verdict: 'FAIL', issues: [issue({ severity: '建议' })] }))).toEqual({ verdict: 'PASS', failure_class: null, blocking: [], unsatisfied: [] });
  });

  it('有阻断/重要问题 → FAIL；类别优先级 product > qa_gap > contract_gap', () => {
    const qa = issue({ id: 'J-2', type: 'qa_gap', severity: '重要' });
    const contract = issue({ id: 'J-3', type: 'contract_gap', severity: '重要' });
    expect(decide(ok({ verdict: 'PASS', issues: [qa, contract, issue()] }))).toMatchObject({ verdict: 'FAIL', failure_class: 'product_failure' });
    expect(decide(ok({ issues: [contract, qa] }))).toMatchObject({ verdict: 'FAIL', failure_class: 'qa_insufficient' });
    const d = decide(ok({ issues: [contract] }));
    expect(d).toMatchObject({ verdict: 'FAIL', failure_class: 'contract_gap' });
    expect(d.blocking.map((i) => i.id)).toEqual(['J-3']);
  });

  it('I-n 没满足 → FAIL 并列出', () => {
    const cov = [{ intent: 'I-1', satisfied: true, evidence: 'x' }, { intent: 'I-2', satisfied: false, evidence: 'y' }];
    expect(decide(ok({ coverage: cov, issues: [issue()] }))).toMatchObject({ verdict: 'FAIL', unsatisfied: ['I-2'] });
  });
});

describe('renderJudgeReport', () => {
  it('写出裁决、模型、逐条 I-n 覆盖与问题（含类型/严重度/位置）', () => {
    const parsed = parseJudge(JSON.stringify(ok({ issues: [issue()] })), ids);
    const md = renderJudgeReport({ round: 2, model: 'gpt-x', parsed, decision: decideJudge(parsed), qaReport: '05-qa-report-r2.md' });
    for (const s of ['# 独立裁判（第 2 轮）', 'gpt-x', 'FAIL', 'product_failure', '05-qa-report-r2.md', '### I-1', '满足', '### J-1', '阻断', 'routes/tasks.js:40', '非法 id 仍返回 500']) {
      expect(md).toContain(s);
    }
  });
});

describe('resolveJudgeConfig', () => {
  it('环境变量优先；否则读凭据文件；模型默认与 Brain 现役裁判一致', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cfg-'));
    const creds = path.join(dir, 'toapis.env');
    fs.writeFileSync(creds, 'TOAPIS_API_KEY=from-file\nTOAPIS_BASE_URL=https://file.example/v1\n');
    expect(resolveJudgeConfig({ CODING_WF_JUDGE_CREDS: creds })).toEqual({ api: 'https://file.example/v1', key: 'from-file', model: DEFAULT_JUDGE_MODEL });
    expect(resolveJudgeConfig({ CODING_WF_JUDGE_CREDS: creds, TOAPIS_API_KEY: 'k', CODING_WF_JUDGE_API: 'http://a/v1', CODING_WF_JUDGE_MODEL: 'm' }))
      .toEqual({ api: 'http://a/v1', key: 'k', model: 'm' });
    expect(resolveJudgeConfig({ CODING_WF_JUDGE_CREDS: path.join(dir, 'none') }).key).toBe(null);
    expect(DEFAULT_JUDGE_MODEL).toBe('gpt-5.6-sol');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('callJudge', () => {
  it('OpenAI 兼容 chat/completions，带 Bearer，temperature 0；返回内容与用量', async () => {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }], usage: { total_tokens: 9 } }) };
    };
    const r = await callJudge({ system: 'S', user: 'U' }, { api: 'http://a/v1/', key: 'k', model: 'm', fetchFn });
    expect(r).toEqual({ content: '{"a":1}', usage: { total_tokens: 9 } });
    expect(calls[0].url).toBe('http://a/v1/chat/completions');
    expect(calls[0].init.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: 'm', temperature: 0, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] });
  });

  it('没有 key / HTTP 错 / 空内容 → 抛错（由调用方计入连坏）', async () => {
    await expect(callJudge({ system: 's', user: 'u' }, { api: 'a', key: null, model: 'm' })).rejects.toThrow('judge_key_missing');
    const bad = async () => ({ ok: false, status: 502, text: async () => 'upstream' });
    await expect(callJudge({ system: 's', user: 'u' }, { api: 'a', key: 'k', model: 'm', fetchFn: bad })).rejects.toThrow('judge_http_502');
    const empty = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: ' ' } }] }) });
    await expect(callJudge({ system: 's', user: 'u' }, { api: 'a', key: 'k', model: 'm', fetchFn: empty })).rejects.toThrow('judge_empty');
  });
});
