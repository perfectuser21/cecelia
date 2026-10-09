// spec_review 活动 v2（合同对抗）：QA 立场评审 ⇄ 开发逐条采纳/驳回并改规格，代码判分，不限轮数按走势收敛。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
const SPEC_MD = `---\ntask_id: ${TASK_ID}\nstep: spec\nupstream: ["01-intent.md#I-1", "01-intent.md#I-2"]\n---\n# spec\n\n### S-1\n对应 I-1：改 foo.js\n\n### S-2\n对应 I-2：改 bar.js\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: 用户发起评审\n期望: 看到评审结论\n\n### Q-2\n对应: I-2\n操作: 用户发起改写\n期望: 看到新规格\n`;
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

  const run = (script, env = {}) => {
    fs.writeFileSync(path.join(tmp, 'script.json'), JSON.stringify(script));
    return runActivityProcess(ENTRY, {
      run_tag: 'rt-1', task_id: TASK_ID, worktree, sprint_dir: 'sprints/s1',
      intent_ids: ['I-1', 'I-2'], intent_sha256: sha256(INTENT_MD),
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
    reviews.push({ scores: 8, prior: [{ id: 'R-5', status: '关闭' }] });
    const r = await run({ reviews });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.gan).toMatchObject({ verdict: 'APPROVED', rounds: 6 });
  });

  it('评分震荡 → 第 3 轮后强制通过（FORCED）+ P1 + 升级给 coding commander', async () => {
    const sc = (v) => ({ 意图对齐: v, 可验证: 6, 场景覆盖: 6, 回归风险: 6, 可执行: 6 });
    const r = await run({ reviews: [
      { scores: sc(8), issues: [blocker('R-1')] },
      { scores: sc(5), prior: [{ id: 'R-1', status: '坚持' }], issues: [blocker('R-2')] },
      { scores: sc(8), prior: [{ id: 'R-1', status: '坚持' }, { id: 'R-2', status: '坚持' }] },
    ] });
    expect(r.result.status).toBe('completed');
    expect(r.result.outputs.gan).toMatchObject({ verdict: 'FORCED', rounds: 3, trend: 'oscillating' });
    expect(r.result.outputs.gan.open_issues.map((i) => i.id)).toEqual(['R-1', 'R-2']);
    expect(r.result.outputs.escalations).toEqual([expect.objectContaining({ type: 'gan_forced', trend: 'oscillating' })]);
    expect(r.stderr).toContain('[coding-gan][P1]');
  });

  it('规格越改越长（评分不动）→ diverging 强制通过', async () => {
    const r = await run({ reviews: [{ scores: 6, issues: [blocker('R-1')] }, { scores: 6, prior: [{ id: 'R-1', status: '坚持' }] }], revise: { grow: 30 } });
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

  it('prompt：QA 立场、只准四类问题、阻断/重要必须带场景与依据、禁止措辞格式类问题', () => {
    const review = fs.readFileSync(path.join(HERE, '../prompts/spec-review.md'), 'utf8');
    for (const s of ['QA', '场景', '依据', '阻断', '重要', '建议', '措辞', '上轮问题', 'PRIOR_OPEN', 'Q-n']) expect(review).toContain(s);
    const revise = fs.readFileSync(path.join(HERE, '../prompts/spec-revise.md'), 'utf8');
    for (const s of ['RESPONSE_PATH', '采纳', '驳回']) expect(revise).toContain(s);
  });
});
