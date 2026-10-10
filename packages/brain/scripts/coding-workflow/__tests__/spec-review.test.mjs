// spec_review 活动 v2（合同对抗）：QA 立场评审 ⇄ 开发逐条采纳/驳回并改规格，代码判分，不限轮数按走势收敛。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { gitPlain } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/spec-review.mjs');
const FAKE = path.join(HERE, 'fixtures/fake-claude-gan.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

const INTENT_MD = `---\ntask_id: ${TASK_ID}\nstep: intent\nupstream: []\n---\n# 验收条目\n\n### I-1\n能评审。\n\n### I-2\n能改写。\n`;
const SPEC_MD = `---\ntask_id: ${TASK_ID}\nstep: spec\nupstream: ["01-intent.md#I-1", "01-intent.md#I-2"]\n---\n# spec\n\n### S-1\n对应 I-1：改 foo.js\n\n### S-2\n对应 I-2：改 bar.js\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: 用户发起评审\n期望: 看到评审结论\n\n### Q-2\n对应: I-2\n操作: 用户发起改写\n期望: 看到新规格\n\n## 未覆盖真实链路\n\n无：只改本仓库内代码，没有外部调用方与第三方\n`;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const blocker = (id, extra = {}) => ({ id, severity: '阻断', ...extra });

describe('spec_review 活动 v2（合同对抗）', () => {
  let worktree;
  let tmp;
  const sprint = () => path.join(worktree, 'sprints/s1');
  const read = (name) => fs.readFileSync(path.join(sprint(), name), 'utf8');

  beforeAll(() => fs.chmodSync(FAKE, 0o755));
  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-v2-'));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-review-v2-state-'));
    gitPlain('init', '-q', worktree);
    fs.mkdirSync(sprint(), { recursive: true });
    fs.writeFileSync(path.join(sprint(), '01-intent.md'), INTENT_MD);
    fs.writeFileSync(path.join(sprint(), '02-spec.md'), SPEC_MD);
  });
  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const run = (script, env = {}, extraInput = {}) => {
    fs.writeFileSync(path.join(tmp, 'script.json'), JSON.stringify(script));
    return runActivityProcess(ENTRY, {
      run_tag: 'rt-1', task_id: TASK_ID, worktree, sprint_dir: 'sprints/s1',
      intent_ids: ['I-1', 'I-2'], intent_sha256: sha256(INTENT_MD), ...extraInput,
    }, {
      CODING_WF_CLAUDE_BIN: FAKE,
      FAKE_GAN_SCRIPT: path.join(tmp, 'script.json'),
      FAKE_GAN_STATE: path.join(tmp, 'state.json'),
      FAKE_GAN_SEEN: path.join(tmp, 'seen.log'),
      ...env,
    });
  };
  const seen = () => fs.readFileSync(path.join(tmp, 'seen.log'), 'utf8');

  it('首轮评分全部 ≥7、无阻断/重要问题 → completed：02-review-r1.md 与 02-review.md 相同，outputs 带 gan 摘要', async () => {
    const r = await run({ reviews: [{ scores: 8, issues: [{ id: 'R-1', severity: '建议', scene: '', basis: '' }], cost: 0.3 }] });
    expect(r.result.status).toBe('completed');
    expect(read('02-review.md')).toBe(read('02-review-r1.md'));
    expect(r.result.outputs).toMatchObject({
      review_file: '02-review.md', review_rounds: 1, spec_sha256: sha256(SPEC_MD),
      gan: { verdict: 'APPROVED', rounds: 1, trend: 'insufficient_data', open_issues: [], cost_usd: 0.3 },
    });
  });

  it('QA 问题可以针对 QA 场景 Q-n（evaluator 的测试计划）', async () => {
    const r = await run({ reviews: [{ scores: 6, issues: [blocker('R-1', { targets: 'Q-1' })] }, { scores: 8, prior: [{ id: 'R-1', status: '关闭' }] }] });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.review_rounds).toBe(2);
  });

  it('开发采纳后关闭 → 第 2 轮通过；留下 02-response-r1.md，规格已改且 spec_sha256 为新哈希', async () => {
    const r = await run({ reviews: [
      { scores: 6, issues: [blocker('R-1')] },
      { scores: 8, prior: [{ id: 'R-1', status: '关闭' }] },
    ] });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.review_rounds).toBe(2);
    expect(read('02-response-r1.md')).toContain('处理: 采纳');
    const spec = read('02-spec.md');
    expect(spec).not.toBe(SPEC_MD);
    expect(r.result.outputs.spec_sha256).toBe(sha256(spec));
  });

  // 审计 P1 #3：有铁律清单时，开发方改写后的合同照样要过铁律对照自检；评审 prompt 拿到清单路径
  it('有铁律清单：改写时删掉了 `## 铁律对照` → retryable spec_invalid（invariants_section_missing）', async () => {
    fs.writeFileSync(path.join(sprint(), '01-invariants.md'), '# 铁律清单\n\n### INV-02d8e749\n不得缩减已拍板设计\n');
    fs.appendFileSync(path.join(sprint(), '02-spec.md'), '\n## 铁律对照\n\n- INV-02d8e749：不适用：本改动只动评审文案\n');
    const r = await run({ reviews: [{ scores: 6, issues: [blocker('R-1')] }], revise: { dropInvariants: true } });
    expect(r.result.reason_code).toBe('spec_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('invariants_section_missing');
    const prompt = fs.readFileSync(path.join(path.dirname(ENTRY), '../prompts/spec-review.md'), 'utf8');
    expect(prompt).toContain('INVARIANTS_PATH: {{INVARIANTS_PATH}}');
    expect(prompt).toContain('违反铁律');
  });

  it('QA 坚持的问题仍算开着：评分再高也不通过，下一轮把仍开着的编号告诉 QA', async () => {
    const r = await run({ reviews: [
      { scores: 6, issues: [blocker('R-1')] },
      { scores: 9, prior: [{ id: 'R-1', status: '坚持', reason: '驳回不成立' }] },
      { scores: 9, prior: [{ id: 'R-1', status: '关闭' }] },
    ], revise: { response: '驳回' } });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.review_rounds).toBe(3);
    expect(seen()).toContain('spec_review PRIOR_OPEN=R-1');
  });

  it('不设轮数上限：分数稳步上升、每轮都有新阻断问题，跑到第 6 轮才通过', async () => {
    const reviews = [3, 4, 5, 6, 6].map((sc, i) => ({ scores: sc, prior: i ? [{ id: `R-${i}`, status: '关闭' }] : [], issues: [blocker(`R-${i + 1}`)] }));
    // 第 4、5 轮同分（6→6）= 打转，第 6 轮评审必须写换思路（审计 #27）
    reviews.push({ scores: 8, prior: [{ id: 'R-5', status: '关闭' }], pivot: true });
    const r = await run({ reviews });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.gan).toMatchObject({ verdict: 'APPROVED', rounds: 6 });
  });

  it('评分震荡 → 第 3 轮后强制通过（FORCED）+ P1 + 升级给 coding commander', async () => {
    const sc = (v) => ({ 意图对齐: v, 可验证: 6, 场景覆盖: 6, 回归风险: 6, 可执行: 6 });
    const r = await run({ reviews: [
      { scores: sc(8), issues: [blocker('R-1')] },
      { scores: sc(5), prior: [{ id: 'R-1', status: '坚持' }], issues: [blocker('R-2')] },
      // 第 2 轮总分下降 → 第 3 轮评审处于打转，要写换思路（审计 #27）
      { scores: sc(8), prior: [{ id: 'R-1', status: '坚持' }, { id: 'R-2', status: '坚持' }], pivot: true },
    ] });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.gan).toMatchObject({ verdict: 'FORCED', rounds: 3, trend: 'oscillating' });
    expect(r.result.outputs.gan.open_issues.map((i) => i.id)).toEqual(['R-1', 'R-2']);
    expect(r.result.outputs.escalations).toEqual([expect.objectContaining({ type: 'gan_forced', trend: 'oscillating' })]);
    expect(r.stderr).toContain('[coding-gan][P1]');
  });

  it('规格越改越长（评分不动）→ diverging 强制通过', async () => {
    const r = await run({ reviews: [{ scores: 6, issues: [blocker('R-1')] }, { scores: 6, prior: [{ id: 'R-1', status: '坚持' }], pivot: true }], revise: { grow: 30 } });
    expect(r.result.outputs.gan).toMatchObject({ verdict: 'FORCED', trend: 'diverging' });
  });

  it('评审格式坏一次 → 重评不计轮；连续 3 次坏 → fatal review_invalid', async () => {
    let r = await run({ reviews: [{ raw: '只有散文' }, { scores: 8 }] });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.review_rounds).toBe(1);
    fs.rmSync(path.join(tmp, 'state.json'), { force: true });
    r = await run({ reviews: [{ raw: '只有散文' }] });
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('review_invalid');
  });

  // 审计 #33：重评时告诉评审上次格式哪里坏了
  it('评审格式坏了 → 重评的 prompt 带 PREV_REVIEW_ERRORS；首评写「无」', async () => {
    const r = await run({ reviews: [{ raw: '只有散文' }, { scores: 8 }] });
    expect(r.result.status).toBe('completed');
    const lines = seen().trim().split('\n').filter((l) => l.startsWith('spec_review'));
    expect(lines[0]).toContain('PREV_REVIEW_ERRORS=无');
    expect(lines[1]).toMatch(/PREV_REVIEW_ERRORS=.*scores_missing|PREV_REVIEW_ERRORS=.*score/);
  });

  // 审计 #33：活动被重试时（上次改写把规格改坏了），评审与改写都拿到当前 02 的程序校验问题
  it('当前 02 程序校验不过 → 评审与改写 prompt 的 SPEC_ERRORS 列出问题；合格时写「无」', async () => {
    let r = await run({ reviews: [{ scores: 8 }] });
    expect(seen()).toContain('SPEC_ERRORS=无');
    fs.rmSync(path.join(tmp, 'seen.log'));
    fs.rmSync(path.join(tmp, 'state.json'));
    fs.writeFileSync(path.join(sprint(), '02-spec.md'), SPEC_MD.replace(/\n## QA 场景[\s\S]*$/, '\n'));
    r = await run({ reviews: [{ scores: 6, issues: [blocker('R-1')] }] });
    expect(seen()).toMatch(/spec_review .*SPEC_ERRORS=.*qa_missing/);
    expect(seen()).toMatch(/spec_revise .*SPEC_ERRORS=.*qa_missing/);
  });

  // 审计 #27：总分连续两轮不涨 = 原地打转，要求评审写 `## 换思路`，改写方必须回应
  it('总分不涨 → 下一轮 STUCK=是，评审必须写 `## 换思路`（没写算格式不合格）', async () => {
    let r = await run({ reviews: [
      { scores: 6, issues: [blocker('R-1')] },
      { scores: 6, prior: [{ id: 'R-1', status: '坚持' }] },
      { scores: 8, prior: [{ id: 'R-1', status: '关闭' }], pivot: true },
    ] });
    expect(r.result.status, r.stderr).toBe('completed');
    const lines = seen().trim().split('\n');
    expect(lines.filter((l) => l.startsWith('spec_review')).map((l) => /STUCK=(\S+)/.exec(l)[1])).toEqual(['否', '否', '是']);
    expect(lines.filter((l) => l.startsWith('spec_revise')).at(-1)).toContain('STUCK=是');
    fs.rmSync(path.join(tmp, 'state.json'));
    fs.writeFileSync(path.join(sprint(), '02-spec.md'), SPEC_MD);
    r = await run({ reviews: [
      { scores: 6, issues: [blocker('R-1')] },
      { scores: 6, prior: [{ id: 'R-1', status: '坚持' }] },
      { scores: 8, prior: [{ id: 'R-1', status: '关闭' }] },
    ] });
    expect(r.result).toMatchObject({ failure_class: 'fatal', reason_code: 'review_invalid' });
    expect(JSON.stringify(r.result.evidence)).toContain('pivot_missing');
    for (const name of ['spec-review', 'spec-revise']) {
      const p = fs.readFileSync(path.join(path.dirname(ENTRY), `../prompts/${name}.md`), 'utf8');
      expect(p).toContain('STUCK: {{STUCK}}');
      expect(p).toContain('## 换思路');
    }
  });

  // 审计 #14（旧 reviewer 9.4/9.6）：合同对抗结束时判定点写进 Brain decisions（category=judgment）并回读计数；重跑不重复写
  describe('判定点写库', () => {
    let server;
    let decisions;
    let brainUrl;
    beforeEach(async () => {
      decisions = [];
      server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          if (req.method === 'POST' && req.url === '/api/brain/strategic-decisions') {
            const row = { id: `d-${decisions.length + 1}`, ...JSON.parse(raw) };
            decisions.push(row);
            res.statusCode = 201;
            return res.end(JSON.stringify({ success: true, data: row }));
          }
          if (req.method === 'GET' && req.url.startsWith('/api/brain/strategic-decisions?')) {
            return res.end(JSON.stringify({ success: true, data: decisions.filter((d) => d.category === 'judgment') }));
          }
          res.statusCode = 404;
          return res.end('{}');
        });
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      brainUrl = `http://127.0.0.1:${server.address().port}`;
      fs.appendFileSync(path.join(sprint(), '02-spec.md'), '\n## 判定点\n\n- 部署成功判定｜候选: 看 HTTP 200、看 git_sha｜所选: 看 git_sha｜依据: 200 只说明活着｜误判后果: 旧版本被当新版本验收\n');
    });
    afterEach(() => new Promise((r) => server.close(r)));

    it('APPROVED → 判定点 POST 到 Brain（category judgment），回读计数写进 outputs.gan.judgments_written；重跑不重复写', async () => {
      let r = await run({ reviews: [{ scores: 8 }] }, {}, { brain_url: brainUrl });
      expect(r.result.status, r.stderr).toBe('completed');
      expect(decisions).toEqual([expect.objectContaining({
        category: 'judgment', topic: '判定点[11111111#1]: 部署成功判定',
        decision: '所选方法: 看 git_sha｜候选: 看 HTTP 200、看 git_sha', reason: '依据: 200 只说明活着｜误判后果: 旧版本被当新版本验收｜来源: coding workflow 合同对抗',
      })]);
      expect(r.result.outputs.gan.judgments_written).toBe(1);
      fs.rmSync(path.join(tmp, 'state.json'));
      r = await run({ reviews: [{ scores: 8 }] }, {}, { brain_url: brainUrl });
      expect(decisions).toHaveLength(1);
      expect(r.result.outputs.gan.judgments_written).toBe(1);
    });

    it('Brain 写不进去 → 合同照常通过，judgments_written 0 并升级 judgments_write_failed（P1），不静默', async () => {
      const r = await run({ reviews: [{ scores: 8 }] }, {}, { brain_url: 'http://127.0.0.1:1' });
      expect(r.result.status, r.stderr).toBe('completed');
      expect(r.result.outputs.gan.judgments_written).toBe(0);
      expect(r.result.outputs.escalations).toEqual([expect.objectContaining({ type: 'judgments_write_failed' })]);
      expect(r.stderr).toContain('[coding-gan][P1]');
    });
  });

  // 审计 #16（旧 reviewer 9.7）：开发方用「后续再做」驳回却没给 Brain 任务 ID → QA 必须坚持，关掉算格式不合格
  it('驳回理由是「后续再做」且没带任务 ID → 下一轮 UNTRACKED_DEFERRALS 点名；QA 关掉它 → 格式不合格', async () => {
    let r = await run({ reviews: [
      { scores: 6, issues: [blocker('R-1')] },
      { scores: 8, prior: [{ id: 'R-1', status: '坚持', reason: '没有登记任务' }] },
      { scores: 9, prior: [{ id: 'R-1', status: '关闭' }] },
    ], revise: { response: '驳回', note: '这个后续再做' } });
    expect(seen()).toMatch(/spec_review .*UNTRACKED_DEFERRALS=R-1/);
    expect(r.result.status, r.stderr).toBe('completed');
    fs.rmSync(path.join(tmp, 'state.json'));
    fs.rmSync(path.join(tmp, 'seen.log'));
    fs.writeFileSync(path.join(sprint(), '02-spec.md'), SPEC_MD);
    r = await run({ reviews: [
      { scores: 6, issues: [blocker('R-1')] },
      { scores: 8, prior: [{ id: 'R-1', status: '关闭' }] },
    ], revise: { response: '驳回', note: '这个后续再做' } });
    expect(r.result).toMatchObject({ failure_class: 'fatal', reason_code: 'review_invalid' });
    expect(JSON.stringify(r.result.evidence)).toContain('deferral_closed_without_task:R-1');
  });

  it('累计花费超过上限 → fatal gan_budget_exceeded（带已花费与仍开着的问题），不会无声放行', async () => {
    const r = await run({ reviews: [{ scores: 5, issues: [blocker('R-1')], cost: 15 }], revise: { cost: 15 } }, { CODING_WF_GAN_BUDGET_USD: '20' });
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('gan_budget_exceeded');
    expect(JSON.stringify(r.result.evidence)).toContain('R-1');
  });

  it('防线：会话改 01 → chain_tampered；越界写 → spec_review_out_of_scope_write', async () => {
    let r = await run({ reviews: [{ scores: 8, tamper: true }] });
    expect(r.result.reason_code).toBe('chain_tampered');
    fs.writeFileSync(path.join(sprint(), '01-intent.md'), INTENT_MD);
    fs.rmSync(path.join(tmp, 'state.json'), { force: true });
    r = await run({ reviews: [{ scores: 8, outside: true }] });
    expect(r.result.reason_code).toBe('spec_review_out_of_scope_write');
  });

  // 审计 #39 漏迁的一半（金丝雀 3：需求只要修 category，规格顺手加 made_by/priority 校验，合同对抗没拦）
  it('prompt：偷换需求包含「扩大」——超出 I-n 的改动（顺手修存量、改无关调用方、需求外的校验）必须提阻断/重要', () => {
    const p = fs.readFileSync(path.join(path.dirname(ENTRY), '../prompts/spec-review.md'), 'utf8');
    for (const s of ['扩大', '顺手修', '无关的调用方', 'I-n 之外']) expect(p).toContain(s);
    const spec = fs.readFileSync(path.join(path.dirname(ENTRY), '../prompts/spec.md'), 'utf8');
    for (const s of ['不顺手修', '另立任务']) expect(spec).toContain(s);
  });

  it('prompt：QA 立场、只准四类问题、阻断/重要必须带场景与依据、禁止措辞格式类问题', () => {
    const review = fs.readFileSync(path.join(HERE, '../prompts/spec-review.md'), 'utf8');
    for (const s of ['QA', '场景', '依据', '阻断', '重要', '建议', '措辞', '上轮问题', 'PRIOR_OPEN', 'Q-n']) expect(review).toContain(s);
    const revise = fs.readFileSync(path.join(HERE, '../prompts/spec-revise.md'), 'utf8');
    for (const s of ['RESPONSE_PATH', '采纳', '驳回']) expect(revise).toContain(s);
  });
});
